import base64
from concurrent.futures import ThreadPoolExecutor
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.services.openapi_parser import OpenAPIParseError, parse_openapi_content


class LiveConnectorError(ValueError):
    """Raised when connecting to or scanning a live target API fails."""


@dataclass
class LiveAuthConfig:
    auth_type: str = "none"  # none | bearer | api_key_header | api_key_query | basic | custom_headers
    auth_token: str = ""
    auth_header_name: str = "X-API-Key"
    auth_query_param: str = "api_key"
    basic_username: str = ""
    basic_password: str = ""
    custom_headers_json: str = ""


@dataclass
class LiveScanResult:
    resolved_base_url: str
    openapi_bytes: bytes
    openapi_filename: str
    routes_bytes: bytes
    routes_filename: str
    logs_bytes: Optional[bytes]
    logs_filename: str
    auth_summary: str
    probed_count: int = 0
    discovered_routes_count: int = 0
    logs_captured_count: int = 0
    notes: List[str] = field(default_factory=list)


HttpRequester = Callable[[str, str, Dict[str, str], float], Tuple[int, bytes]]

DEFAULT_SHADOW_CANDIDATES: List[Tuple[str, str]] = [
    ("GET", "/api/v1/legacy/accounts"),
    ("POST", "/api/v1/auth/token-exchange"),
    ("GET", "/api/v1/catalog/pricing-matrix"),
    ("GET", "/api/internal/debug/env-config"),
    ("POST", "/api/internal/cache/flush"),
    ("DELETE", "/api/v1/legacy/sessions/purge-expired"),
]

SPECLESS_DISCOVERY_CANDIDATES: List[Tuple[str, str]] = [
    ("GET", "/"),
    ("GET", "/health"),
    ("GET", "/status"),
    ("GET", "/version"),
    ("GET", "/latest"),
    ("GET", "/currencies"),
    ("GET", "/users"),
    ("GET", "/posts"),
    ("GET", "/todos"),
    ("GET", "/products"),
    ("GET", "/items"),
    ("GET", "/api"),
    ("GET", "/api/v1"),
    ("GET", "/api/v2"),
]

COMMON_OPENAPI_PATHS: List[str] = [
    "/openapi.json",
    "/swagger.json",
    "/api/openapi.json",
    "/api/v1/openapi.json",
    "/v3/api-docs",
    "/docs/openapi.json",
]

IMPLEMENTED_STATUS_CODES = {
    200,
    201,
    202,
    204,
    301,
    302,
    307,
    308,
    400,
    401,
    403,
    405,
    409,
    415,
    422,
    429,
}


def build_auth_headers_and_params(
    auth: LiveAuthConfig,
) -> Tuple[Dict[str, str], Dict[str, str], str]:
    headers: Dict[str, str] = {
        "Accept": "application/json, application/yaml, text/plain, */*",
        "User-Agent": "API-Graveyard-Autopsy-Scanner/1.2",
    }
    query_params: Dict[str, str] = {}
    atype = (auth.auth_type or "none").strip().lower()

    if atype == "none" or not atype:
        return headers, query_params, "No Authentication"

    if atype == "bearer":
        token = (auth.auth_token or "").strip()
        if not token:
            raise LiveConnectorError("Bearer token authentication selected, but token is empty.")
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        headers["Authorization"] = f"Bearer {token}"
        return headers, query_params, "Bearer Token (Authorization header, redacted)"

    if atype == "api_key_header":
        header_name = (auth.auth_header_name or "X-API-Key").strip() or "X-API-Key"
        key_val = (auth.auth_token or "").strip()
        if not key_val:
            raise LiveConnectorError(f"API Key header '{header_name}' selected, but key value is empty.")
        headers[header_name] = key_val
        return headers, query_params, f"API Key Header '{header_name}' (redacted)"

    if atype == "api_key_query":
        param_name = (auth.auth_query_param or "api_key").strip() or "api_key"
        key_val = (auth.auth_token or "").strip()
        if not key_val:
            raise LiveConnectorError(f"API Key query parameter '{param_name}' selected, but key value is empty.")
        query_params[param_name] = key_val
        return headers, query_params, f"API Key Query Param '?{param_name}=[REDACTED]'"

    if atype == "basic":
        user = (auth.basic_username or "").strip()
        pwd = auth.basic_password or ""
        if not user and not pwd:
            raise LiveConnectorError("HTTP Basic Auth selected, but username and password are empty.")
        raw_cred = f"{user}:{pwd}".encode("utf-8")
        b64_cred = base64.b64encode(raw_cred).decode("ascii")
        headers["Authorization"] = f"Basic {b64_cred}"
        return headers, query_params, f"HTTP Basic Auth (user '{user}', password redacted)"

    if atype == "custom_headers":
        raw_json = (auth.custom_headers_json or "").strip()
        if not raw_json:
            raise LiveConnectorError("Custom Headers authentication selected, but headers JSON is empty.")
        try:
            parsed = json.loads(raw_json)
            if not isinstance(parsed, dict):
                raise LiveConnectorError("Custom headers must be a JSON object of {\"Header-Name\": \"value\"}.")
            custom_keys: List[str] = []
            for k, v in parsed.items():
                k_clean = str(k).strip()
                if k_clean:
                    headers[k_clean] = str(v)
                    custom_keys.append(k_clean)
            return headers, query_params, f"Custom Headers ({', '.join(custom_keys)}, values redacted)"
        except json.JSONDecodeError as exc:
            raise LiveConnectorError(f"Invalid JSON in custom headers: {exc}") from exc

    raise LiveConnectorError(f"Unsupported authentication type '{auth.auth_type}'.")


def _extract_origin_and_path(url: str) -> Tuple[str, str]:
    parsed = urllib.parse.urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    path = (parsed.path or "").rstrip("/")
    return origin, path


def resolve_candidate_base_urls(raw_url: str) -> List[str]:
    cleaned = (raw_url or "").strip().rstrip("/")
    if not cleaned:
        raise LiveConnectorError("Target API Base URL is required.")

    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise LiveConnectorError(
            f"Invalid Target API Base URL '{raw_url}'. Must start with http:// or https:// (e.g., http://target-api:8090)."
        )

    clean_no_query = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "", ""))
    candidates: List[str] = [clean_no_query]
    hostname = (parsed.hostname or "").lower()
    port = parsed.port

    if hostname in ("localhost", "127.0.0.1"):
        if port == 8090:
            alt_target = f"{parsed.scheme}://target-api:8090"
            if alt_target not in candidates:
                candidates.append(alt_target)
        host_internal = f"{parsed.scheme}://host.docker.internal" + (f":{port}" if port else "")
        if host_internal not in candidates:
            candidates.append(host_internal)
    elif hostname == "target-api":
        local_alt = f"{parsed.scheme}://127.0.0.1" + (f":{port}" if port else ":8090")
        if local_alt not in candidates:
            candidates.append(local_alt)

    return candidates


def _default_urllib_requester(
    method: str,
    url: str,
    headers: Dict[str, str],
    timeout: float = 4.5,
) -> Tuple[int, bytes]:
    body_data: Optional[bytes] = None
    req_headers = dict(headers)
    if method.upper() in ("POST", "PUT", "PATCH"):
        body_data = b"{}"
        req_headers.setdefault("Content-Type", "application/json")

    req = urllib.request.Request(
        url=url,
        data=body_data,
        headers=req_headers,
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode() or 200, resp.read()
    except urllib.error.HTTPError as http_err:
        err_body = http_err.read() if http_err.fp else b""
        return http_err.code, err_body
    except urllib.error.URLError as url_err:
        raise ConnectionError(f"Failed to connect to {url}: {url_err.reason}") from url_err
    except TimeoutError as time_err:
        raise ConnectionError(f"Timed out connecting to {url}") from time_err


def _append_url_path_and_params(
    base_url: str,
    path: str,
    query_params: Dict[str, str],
) -> str:
    if not path or path == "/":
        full_url = base_url.rstrip("/") + "/"
    else:
        clean_path = path if path.startswith("/") else f"/{path}"
        full_url = f"{base_url.rstrip('/')}{clean_path}"
    if not query_params:
        return full_url
    parsed = urllib.parse.urlparse(full_url)
    existing_qs = dict(urllib.parse.parse_qsl(parsed.query))
    existing_qs.update(query_params)
    encoded_qs = urllib.parse.urlencode(existing_qs)
    return urllib.parse.urlunparse(parsed._replace(query=encoded_qs))


def _materialize_probe_path(template_path: str) -> str:
    return re.sub(r"\{[^/{}]+\}", "autopsy-probe-1", template_path)


def parse_extra_probe_paths(raw_extra: Optional[str]) -> List[Tuple[str, str]]:
    if not raw_extra or not raw_extra.strip():
        return []
    results: List[Tuple[str, str]] = []
    tokens = re.split(r"[\r\n,]+", raw_extra.strip())
    for tok in tokens:
        item = tok.strip()
        if not item:
            continue
        parts = item.split(None, 1)
        if len(parts) == 2 and parts[0].upper() in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
            method = parts[0].upper()
            path = parts[1].strip()
        else:
            method = "GET"
            path = item
        if not path.startswith("/"):
            path = f"/{path}"
        results.append((method, path))
    return results


def _extract_candidate_paths_from_json_body(body: bytes, origin_url: str) -> List[str]:
    """Extract relative API paths or same-origin URLs embedded inside a JSON response."""
    discovered: List[str] = []
    if not body:
        return discovered
    try:
        data = json.loads(body.decode("utf-8-sig"))
    except Exception:
        return discovered

    def _visit(val: Any) -> None:
        if len(discovered) >= 10:
            return
        if isinstance(val, str):
            s = val.strip()
            if s.startswith("/") and len(s) > 1 and not s.startswith("//") and " " not in s:
                path_only = s.split("?")[0]
                if path_only not in discovered:
                    discovered.append(path_only)
            elif s.startswith(origin_url):
                rel = s[len(origin_url):].split("?")[0]
                if rel.startswith("/") and len(rel) > 1 and rel not in discovered:
                    discovered.append(rel)
        elif isinstance(val, dict):
            for k, v in val.items():
                _visit(k)
                _visit(v)
        elif isinstance(val, list):
            for item in val[:15]:
                _visit(item)

    _visit(data)
    return discovered


def collect_live_api_sources(
    target_base_url: str,
    openapi_path: str = "/openapi.json",
    auth_config: Optional[LiveAuthConfig] = None,
    probe_endpoints: bool = True,
    include_shadow_wordlist: bool = True,
    extra_probe_paths: Optional[str] = None,
    openapi_override_bytes: Optional[bytes] = None,
    openapi_override_filename: str = "openapi.json",
    logs_override_bytes: Optional[bytes] = None,
    logs_override_filename: str = "access-logs.csv",
    timeout_seconds: float = 4.5,
    requester: Optional[HttpRequester] = None,
) -> LiveScanResult:
    auth = auth_config or LiveAuthConfig()
    headers, query_params, auth_summary = build_auth_headers_and_params(auth)
    http_req = requester or _default_urllib_requester
    candidates = resolve_candidate_base_urls(target_base_url)

    resolved_base: Optional[str] = None
    last_conn_err: Optional[str] = None
    initial_user_url_response: Optional[Tuple[int, bytes]] = None
    cached_first_oa_response: Optional[Tuple[str, str, int, bytes]] = None

    probe_check_path = (openapi_path or "/openapi.json").strip() or "/openapi.json"
    for cand in candidates:
        test_url = _append_url_path_and_params(cand, probe_check_path, query_params)
        try:
            st, bd = http_req("GET", test_url, headers, timeout_seconds)
            resolved_base = cand
            cached_first_oa_response = (cand, probe_check_path, st, bd)
            break
        except Exception as exc:
            last_conn_err = str(exc)
            try:
                direct_url = _append_url_path_and_params(cand, "", query_params)
                st, bd = http_req("GET", direct_url, headers, timeout_seconds)
                resolved_base = cand
                initial_user_url_response = (st, bd)
                break
            except Exception as root_exc:
                last_conn_err = str(root_exc)

    if resolved_base is None:
        raise LiveConnectorError(
            f"Could not reach target API at '{target_base_url}'. "
            f"Ensure the target server is running and accessible. Details: {last_conn_err or 'Connection refused'}"
        )

    origin_url, user_supplied_path = _extract_origin_and_path(resolved_base)
    notes: List[str] = [f"Connected to {resolved_base} using {auth_summary}."]

    final_openapi_bytes: Optional[bytes] = openapi_override_bytes
    final_openapi_filename = openapi_override_filename
    is_specless_mode = False

    if final_openapi_bytes is not None:
        parse_openapi_content(final_openapi_bytes, filename=final_openapi_filename)
        notes.append(f"Used uploaded OpenAPI file '{final_openapi_filename}'.")
    else:
        last_oa_error: Optional[str] = None

        # 1. Check cached response from the reachability probe first (avoids duplicate request!)
        if cached_first_oa_response is not None:
            c_base, c_path, c_status, c_body = cached_first_oa_response
            if c_status == 200 and c_body and c_body.strip():
                try:
                    parse_openapi_content(c_body, filename=c_path.split("/")[-1] or "openapi.json")
                    final_openapi_bytes = c_body
                    final_openapi_filename = f"live:{c_path}"
                    resolved_base = c_base
                    notes.append(f"Fetched live OpenAPI spec from {c_base}{c_path} (HTTP 200).")
                except OpenAPIParseError as parse_err:
                    last_oa_error = str(parse_err)
            elif c_status in (401, 403):
                last_oa_error = f"HTTP {c_status} (Auth Required) at {c_path}"
            else:
                last_oa_error = f"HTTP {c_status} at {c_path}"

        # 2. If not found on first check, probe candidate OpenAPI paths concurrently
        if final_openapi_bytes is None:
            oa_candidates: List[Tuple[str, str]] = []
            search_paths = [probe_check_path] + [p for p in COMMON_OPENAPI_PATHS if p != probe_check_path]
            # Check origin root first for standard OpenAPI paths, plus resolved_base if different
            roots_to_try = [origin_url] if origin_url == resolved_base else [resolved_base, origin_url]
            for b_root in roots_to_try:
                for oa_p in search_paths:
                    if cached_first_oa_response and b_root == cached_first_oa_response[0] and oa_p == cached_first_oa_response[1]:
                        continue
                    if (b_root, oa_p) not in oa_candidates:
                        oa_candidates.append((b_root, oa_p))

            def _try_fetch_oa(item: Tuple[str, str]) -> Tuple[str, str, Optional[bytes], Optional[str]]:
                b_root, oa_p = item
                oa_url = _append_url_path_and_params(b_root, oa_p, query_params)
                try:
                    st_code, body = http_req("GET", oa_url, headers, timeout_seconds)
                    if st_code == 200 and body and body.strip():
                        parse_openapi_content(body, filename=oa_p.split("/")[-1] or "openapi.json")
                        return b_root, oa_p, body, None
                    return b_root, oa_p, None, f"HTTP {st_code} at {oa_p}"
                except Exception as exc:
                    return b_root, oa_p, None, str(exc)

            with ThreadPoolExecutor(max_workers=6) as oa_pool:
                for b_root, oa_p, valid_body, err_str in oa_pool.map(_try_fetch_oa, oa_candidates):
                    if valid_body is not None and final_openapi_bytes is None:
                        final_openapi_bytes = valid_body
                        final_openapi_filename = f"live:{oa_p}"
                        resolved_base = b_root
                        notes.append(f"Fetched live OpenAPI spec from {b_root}{oa_p} (HTTP 200).")
                        break
                    elif err_str:
                        last_oa_error = err_str

        if final_openapi_bytes is None:
            # Enter Spec-less Live Discovery Mode instead of failing!
            is_specless_mode = True
            resolved_base = origin_url
            synthesized_spec = {
                "openapi": "3.0.3",
                "info": {
                    "title": f"Unpublished OpenAPI Baseline ({origin_url})",
                    "version": "0.0.0-undocumented",
                    "description": (
                        f"Target API '{origin_url}' does not publish a public OpenAPI specification "
                        f"(last check: {last_oa_error or 'HTTP 404'}). "
                        "Autopsy ran in Spec-less Live Discovery Mode: all active routes discovered via HTTP probing "
                        "are evaluated against this empty OpenAPI baseline as undocumented API surface."
                    ),
                },
                "paths": {},
            }
            final_openapi_bytes = json.dumps(synthesized_spec, indent=2).encode("utf-8")
            final_openapi_filename = f"no-public-openapi ({origin_url})"
            notes.append(
                f"No public OpenAPI specification found on {origin_url} ({last_oa_error or 'HTTP 404'}). "
                "Switched to Spec-less Live Discovery Mode."
            )

    parsed_oa = parse_openapi_content(final_openapi_bytes, filename=final_openapi_filename)

    discovered_routes: List[Dict[str, Any]] = []
    seen_route_keys: set[Tuple[str, str, str]] = set()
    synthesized_probe_logs: List[Dict[str, Any]] = []

    introspect_routes_url = _append_url_path_and_params(resolved_base, "/_autopsy/routes", query_params)
    try:
        r_status, r_body = http_req("GET", introspect_routes_url, headers, timeout_seconds)
        if r_status == 200 and r_body:
            r_json = json.loads(r_body.decode("utf-8-sig"))
            raw_list = r_json.get("routes") if isinstance(r_json, dict) else (r_json if isinstance(r_json, list) else None)
            if isinstance(raw_list, list):
                for item in raw_list:
                    if isinstance(item, dict) and item.get("method") and item.get("path"):
                        m = str(item["method"]).upper().strip()
                        p = str(item["path"]).strip()
                        sf = str(item.get("source_file") or "live-introspection")
                        key = (m, p, sf)
                        if key not in seen_route_keys:
                            seen_route_keys.add(key)
                            discovered_routes.append(
                                {
                                    "method": m,
                                    "path": p,
                                    "framework": str(item.get("framework") or "live-api"),
                                    "source_file": sf,
                                    "line_number": item.get("line_number"),
                                }
                            )
                notes.append(f"Retrieved {len(discovered_routes)} route entries via /_autopsy/routes introspection.")
    except Exception:
        pass

    probed_count = 0
    if probe_endpoints or is_specless_mode:
        probe_targets: List[Tuple[str, str]] = []
        seen_targets: set[Tuple[str, str]] = set()
        explicit_targets: set[Tuple[str, str]] = set()

        def _add_probe(m: str, p: str, is_explicit: bool = False) -> None:
            clean_p = p if p.startswith("/") else f"/{p}"
            pair = (m.upper(), clean_p)
            if is_explicit:
                explicit_targets.add(pair)
            if pair not in seen_targets:
                seen_targets.add(pair)
                probe_targets.append(pair)

        if user_supplied_path and user_supplied_path != "/":
            _add_probe("GET", user_supplied_path, is_explicit=True)

        for ep in parsed_oa.endpoints:
            _add_probe(ep.method.upper(), ep.original_path, is_explicit=True)

        for m, p in parse_extra_probe_paths(extra_probe_paths):
            _add_probe(m, p, is_explicit=True)

        if is_specless_mode:
            for m, p in SPECLESS_DISCOVERY_CANDIDATES:
                _add_probe(m, p, is_explicit=False)

        if include_shadow_wordlist:
            for m, p in DEFAULT_SHADOW_CANDIDATES:
                _add_probe(m, p, is_explicit=False)

        probe_headers = dict(headers)
        probe_headers["X-Autopsy-Log-Ignore"] = "true"

        canary_signature: Optional[Tuple[int, int]] = None
        if is_specless_mode:
            canary_url = _append_url_path_and_params(resolved_base, "/_autopsy_canary_nonexistent_9f8a7b", query_params)
            try:
                c_status, c_body = http_req("GET", canary_url, probe_headers, timeout_seconds)
                if c_status in IMPLEMENTED_STATUS_CODES:
                    canary_signature = (c_status, len(c_body or b""))
            except Exception:
                pass

        already_implemented_pairs = {(r["method"], r["path"]) for r in discovered_routes}
        now_ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        def _probe_single_target(item: Tuple[str, str]) -> Optional[Tuple[str, str, str, int, bytes]]:
            method, template_path = item
            concrete_path = _materialize_probe_path(template_path)
            probe_url = _append_url_path_and_params(resolved_base, concrete_path, query_params)
            try:
                p_status, p_body = http_req(method, probe_url, probe_headers, timeout_seconds)
                return method, template_path, concrete_path, p_status, p_body
            except Exception:
                return None

        # Execute probes concurrently in a thread pool so internet APIs finish in ~1.5s instead of 40s
        with ThreadPoolExecutor(max_workers=8) as probe_pool:
            probe_results = list(probe_pool.map(_probe_single_target, probe_targets))

        extra_discovered_links: List[Tuple[str, str]] = []
        for res_item in probe_results:
            if res_item is None:
                continue
            method, template_path, concrete_path, p_status, p_body = res_item
            probed_count += 1

            if is_specless_mode and p_status == 200 and p_body and (method, template_path) in explicit_targets:
                for linked_path in _extract_candidate_paths_from_json_body(p_body, origin_url):
                    clean_lp = linked_path if linked_path.startswith("/") else f"/{linked_path}"
                    if ("GET", clean_lp) not in seen_targets:
                        seen_targets.add(("GET", clean_lp))
                        extra_discovered_links.append(("GET", clean_lp))

            if p_status in IMPLEMENTED_STATUS_CODES:
                if (
                    canary_signature is not None
                    and (method, template_path) not in explicit_targets
                    and p_status == canary_signature[0]
                    and abs(len(p_body or b"") - canary_signature[1]) <= 16
                ):
                    continue

                if (method, template_path) not in already_implemented_pairs:
                    already_implemented_pairs.add((method, template_path))
                    source_note = (
                        f"HTTP {p_status} on {concrete_path} (No public OpenAPI spec on server)"
                        if is_specless_mode
                        else f"HTTP {p_status} on {concrete_path}"
                    )
                    discovered_routes.append(
                        {
                            "method": method,
                            "path": template_path,
                            "framework": "live-http-probe",
                            "source_file": source_note,
                            "line_number": None,
                        }
                    )

                if is_specless_mode:
                    synthesized_probe_logs.append(
                        {
                            "timestamp": now_ts,
                            "method": method,
                            "path": concrete_path,
                            "status_code": p_status,
                        }
                    )

        if extra_discovered_links:
            with ThreadPoolExecutor(max_workers=6) as link_pool:
                for res_item in link_pool.map(_probe_single_target, extra_discovered_links):
                    if res_item is None:
                        continue
                    method, template_path, concrete_path, p_status, p_body = res_item
                    probed_count += 1
                    if p_status in IMPLEMENTED_STATUS_CODES:
                        if (
                            canary_signature is not None
                            and p_status == canary_signature[0]
                            and abs(len(p_body or b"") - canary_signature[1]) <= 16
                        ):
                            continue
                        if (method, template_path) not in already_implemented_pairs:
                            already_implemented_pairs.add((method, template_path))
                            discovered_routes.append(
                                {
                                    "method": method,
                                    "path": template_path,
                                    "framework": "live-http-probe",
                                    "source_file": f"HTTP {p_status} on {concrete_path} (No public OpenAPI spec on server)",
                                    "line_number": None,
                                }
                            )
                            synthesized_probe_logs.append(
                                {
                                    "timestamp": now_ts,
                                    "method": method,
                                    "path": concrete_path,
                                    "status_code": p_status,
                                }
                            )

        if is_specless_mode and not discovered_routes and initial_user_url_response is not None:
            st, _ = initial_user_url_response
            fallback_path = user_supplied_path or "/"
            discovered_routes.append(
                {
                    "method": "GET",
                    "path": fallback_path,
                    "framework": "live-http-probe",
                    "source_file": f"HTTP {st} on {fallback_path} (No public OpenAPI spec on server)",
                    "line_number": None,
                }
            )
            synthesized_probe_logs.append(
                {
                    "timestamp": now_ts,
                    "method": "GET",
                    "path": fallback_path,
                    "status_code": st,
                }
            )

        notes.append(
            f"Actively probed {probed_count} endpoint(s) against {resolved_base}; "
            f"discovered {len(discovered_routes)} live route(s)."
        )

    routes_bytes = json.dumps({"routes": discovered_routes}, indent=2).encode("utf-8")

    final_logs_bytes: Optional[bytes] = logs_override_bytes
    final_logs_filename = logs_override_filename
    logs_captured_count = 0

    if final_logs_bytes is None:
        if not is_specless_mode:
            introspect_logs_url = _append_url_path_and_params(resolved_base, "/_autopsy/logs", query_params)
            try:
                l_status, l_body = http_req("GET", introspect_logs_url, headers, timeout_seconds)
                if l_status == 200 and l_body:
                    l_json = json.loads(l_body.decode("utf-8-sig"))
                    raw_logs = l_json.get("logs") if isinstance(l_json, dict) else (l_json if isinstance(l_json, list) else None)
                    if isinstance(raw_logs, list) and len(raw_logs) > 0:
                        logs_captured_count = len(raw_logs)
                        final_logs_bytes = json.dumps({"logs": raw_logs}, indent=2).encode("utf-8")
                        final_logs_filename = "live:/_autopsy/logs"
                        notes.append(f"Ingested {logs_captured_count} runtime access log entries from /_autopsy/logs.")
            except Exception:
                pass

        if final_logs_bytes is None and is_specless_mode and synthesized_probe_logs:
            logs_captured_count = len(synthesized_probe_logs)
            final_logs_bytes = json.dumps({"logs": synthesized_probe_logs}, indent=2).encode("utf-8")
            final_logs_filename = f"live-http-probes ({resolved_base})"
            notes.append(f"Recorded {logs_captured_count} live HTTP probe response(s) as runtime observations.")
    else:
        notes.append(f"Attached uploaded traffic logs '{final_logs_filename}'.")

    return LiveScanResult(
        resolved_base_url=resolved_base,
        openapi_bytes=final_openapi_bytes,
        openapi_filename=final_openapi_filename,
        routes_bytes=routes_bytes,
        routes_filename=f"live-routes ({resolved_base})",
        logs_bytes=final_logs_bytes,
        logs_filename=final_logs_filename,
        auth_summary=auth_summary,
        probed_count=probed_count,
        discovered_routes_count=len(discovered_routes),
        logs_captured_count=logs_captured_count,
        notes=notes,
    )


def trigger_live_traffic_burst(
    target_base_url: str = "http://target-api:8090",
    auth_config: Optional[LiveAuthConfig] = None,
    timeout_seconds: float = 8.0,
    requester: Optional[HttpRequester] = None,
) -> Dict[str, Any]:
    auth = auth_config or LiveAuthConfig()
    headers, query_params, _ = build_auth_headers_and_params(auth)
    http_req = requester or _default_urllib_requester
    candidates = resolve_candidate_base_urls(target_base_url)

    last_err: Optional[str] = None
    for cand in candidates:
        sim_url = _append_url_path_and_params(cand, "/_autopsy/simulate-traffic", query_params)
        try:
            status_code, body = http_req("POST", sim_url, headers, timeout_seconds)
            if status_code == 200 and body:
                data = json.loads(body.decode("utf-8-sig"))
                if isinstance(data, dict):
                    data["resolved_base_url"] = cand
                    return data
        except Exception as exc:
            last_err = str(exc)

    raise LiveConnectorError(
        f"Could not trigger traffic simulation on '{target_base_url}'. "
        f"Ensure the Target Zombie API container is running. Details: {last_err or 'Endpoint not available'}"
    )

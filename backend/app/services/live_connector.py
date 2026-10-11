import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
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

COMMON_OPENAPI_PATHS: List[str] = [
    "/openapi.json",
    "/swagger.json",
    "/api/openapi.json",
    "/api/v1/openapi.json",
    "/api/v2/openapi.json",
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


def resolve_candidate_base_urls(raw_url: str) -> List[str]:
    cleaned = (raw_url or "").strip().rstrip("/")
    if not cleaned:
        raise LiveConnectorError("Target API Base URL is required.")

    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise LiveConnectorError(
            f"Invalid Target API Base URL '{raw_url}'. Must start with http:// or https:// (e.g., http://target-api:8090)."
        )

    candidates: List[str] = [cleaned]
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
    timeout: float = 8.0,
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
    timeout_seconds: float = 8.0,
    requester: Optional[HttpRequester] = None,
) -> LiveScanResult:
    auth = auth_config or LiveAuthConfig()
    headers, query_params, auth_summary = build_auth_headers_and_params(auth)
    http_req = requester or _default_urllib_requester
    candidates = resolve_candidate_base_urls(target_base_url)

    resolved_base: Optional[str] = None
    last_conn_err: Optional[str] = None

    probe_check_path = (openapi_path or "/openapi.json").strip() or "/openapi.json"
    for cand in candidates:
        test_url = _append_url_path_and_params(cand, probe_check_path, query_params)
        try:
            http_req("GET", test_url, headers, timeout_seconds)
            resolved_base = cand
            break
        except Exception as exc:
            last_conn_err = str(exc)
            try:
                root_url = _append_url_path_and_params(cand, "/", query_params)
                http_req("GET", root_url, headers, timeout_seconds)
                resolved_base = cand
                break
            except Exception as root_exc:
                last_conn_err = str(root_exc)

    if resolved_base is None:
        raise LiveConnectorError(
            f"Could not reach target API at '{target_base_url}'. "
            f"Ensure the target server is running and accessible. Details: {last_conn_err or 'Connection refused'}"
        )

    notes: List[str] = [f"Connected to {resolved_base} using {auth_summary}."]

    final_openapi_bytes: Optional[bytes] = openapi_override_bytes
    final_openapi_filename = openapi_override_filename

    if final_openapi_bytes is not None:
        parse_openapi_content(final_openapi_bytes, filename=final_openapi_filename)
        notes.append(f"Used uploaded OpenAPI file '{final_openapi_filename}'.")
    else:
        search_paths = [probe_check_path] + [p for p in COMMON_OPENAPI_PATHS if p != probe_check_path]
        last_oa_error: Optional[str] = None
        for oa_path in search_paths:
            oa_url = _append_url_path_and_params(resolved_base, oa_path, query_params)
            try:
                status_code, body = http_req("GET", oa_url, headers, timeout_seconds)
                if status_code == 200 and body and body.strip():
                    parse_openapi_content(body, filename=oa_path.split("/")[-1] or "openapi.json")
                    final_openapi_bytes = body
                    final_openapi_filename = f"live:{oa_path}"
                    notes.append(f"Fetched live OpenAPI spec from {oa_path} (HTTP 200).")
                    break
                elif status_code in (401, 403):
                    last_oa_error = (
                        f"Target API returned HTTP {status_code} (Unauthorized/Forbidden) for {oa_path}. "
                        "Provide valid authentication credentials or upload the OpenAPI spec file."
                    )
                else:
                    last_oa_error = f"HTTP {status_code} at {oa_path}"
            except OpenAPIParseError as parse_err:
                last_oa_error = str(parse_err)
            except Exception as req_err:
                last_oa_error = str(req_err)

        if final_openapi_bytes is None:
            raise LiveConnectorError(
                f"Failed to discover a valid OpenAPI 3.x specification from '{resolved_base}'. "
                f"Last attempt: {last_oa_error or 'No spec found'}. "
                "Tip: Specify the custom OpenAPI path or attach your OpenAPI file in the scanner."
            )

    parsed_oa = parse_openapi_content(final_openapi_bytes, filename=final_openapi_filename)

    discovered_routes: List[Dict[str, Any]] = []
    seen_route_keys: set[Tuple[str, str, str]] = set()

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
    if probe_endpoints:
        probe_targets: List[Tuple[str, str]] = []
        seen_targets: set[Tuple[str, str]] = set()

        for ep in parsed_oa.endpoints:
            t_key = (ep.method.upper(), ep.original_path)
            if t_key not in seen_targets:
                seen_targets.add(t_key)
                probe_targets.append(t_key)

        if include_shadow_wordlist:
            for m, p in DEFAULT_SHADOW_CANDIDATES:
                if (m, p) not in seen_targets:
                    seen_targets.add((m, p))
                    probe_targets.append((m, p))

        for m, p in parse_extra_probe_paths(extra_probe_paths):
            if (m, p) not in seen_targets:
                seen_targets.add((m, p))
                probe_targets.append((m, p))

        probe_headers = dict(headers)
        probe_headers["X-Autopsy-Log-Ignore"] = "true"

        already_implemented_pairs = {(r["method"], r["path"]) for r in discovered_routes}

        for method, template_path in probe_targets:
            concrete_path = _materialize_probe_path(template_path)
            probe_url = _append_url_path_and_params(resolved_base, concrete_path, query_params)
            try:
                p_status, _ = http_req(method, probe_url, probe_headers, timeout_seconds)
                probed_count += 1
                if p_status in IMPLEMENTED_STATUS_CODES:
                    if (method, template_path) not in already_implemented_pairs:
                        already_implemented_pairs.add((method, template_path))
                        discovered_routes.append(
                            {
                                "method": method,
                                "path": template_path,
                                "framework": "live-http-probe",
                                "source_file": f"HTTP {p_status} on {concrete_path}",
                                "line_number": None,
                            }
                        )
            except Exception:
                continue

        notes.append(f"Actively probed {probed_count} endpoint(s) against {resolved_base}.")

    routes_bytes = json.dumps({"routes": discovered_routes}, indent=2).encode("utf-8")

    final_logs_bytes: Optional[bytes] = logs_override_bytes
    final_logs_filename = logs_override_filename
    logs_captured_count = 0

    if final_logs_bytes is None:
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


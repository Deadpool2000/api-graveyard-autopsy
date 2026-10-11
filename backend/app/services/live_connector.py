import base64
from concurrent.futures import ThreadPoolExecutor
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]

from app.services.normalizer import is_likely_parameter_value, normalize_template_path
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
    ("GET", "/orders"),
    ("GET", "/accounts"),
    ("GET", "/all"),
    ("GET", "/random"),
    ("GET", "/categories"),
    ("GET", "/groups"),
    ("GET", "/search"),
    ("GET", "/list"),
    ("GET", "/info"),
    ("GET", "/ping"),
    ("GET", "/breeds"),
    ("GET", "/facts"),
    ("GET", "/quotes"),
    ("GET", "/jokes"),
    ("GET", "/characters"),
    ("GET", "/episodes"),
    ("GET", "/locations"),
    ("GET", "/countries"),
    ("GET", "/rates"),
    ("GET", "/coins"),
    ("GET", "/comments"),
    ("GET", "/albums"),
    ("GET", "/photos"),
    ("GET", "/tags"),
    ("GET", "/api"),
    ("GET", "/api/v1"),
    ("GET", "/api/v2"),
    ("GET", "/v1"),
    ("GET", "/v2"),
    ("GET", "/api/all"),
    ("GET", "/api/random"),
    ("GET", "/api/categories"),
    ("GET", "/api/groups"),
    ("GET", "/api/search"),
    ("GET", "/api/users"),
    ("GET", "/api/products"),
    ("GET", "/api/health"),
    ("GET", "/api/status"),
    ("GET", "/api/v1/users"),
    ("GET", "/api/v1/health"),
]

PREFIX_SUBRESOURCE_CANDIDATES: List[str] = [
    "users",
    "orders",
    "accounts",
    "products",
    "items",
    "posts",
    "todos",
    "currencies",
    "latest",
    "health",
    "status",
    "version",
    "config",
    "all",
    "random",
    "categories",
    "groups",
    "search",
    "list",
    "info",
    "ping",
    "docs",
    "breeds",
    "facts",
    "quotes",
    "jokes",
    "memes",
    "characters",
    "episodes",
    "locations",
    "books",
    "movies",
    "countries",
    "cities",
    "weather",
    "rates",
    "coins",
    "markets",
    "tickers",
    "comments",
    "albums",
    "photos",
    "tags",
    "articles",
    "events",
    "repos",
    "me",
    "profile",
    "settings",
    "metrics",
]

COMMON_OPENAPI_PATHS: List[str] = [
    "/openapi.json",
    "/swagger.json",
    "/api/openapi.json",
    "/api/swagger.json",
    "/api/v1/openapi.json",
    "/api/v2/openapi.json",
    "/api/v3/openapi.json",
    "/v1/openapi.json",
    "/v2/openapi.json",
    "/v3/api-docs",
    "/v2/api-docs",
    "/api-docs",
    "/api-json",
    "/docs/json",
    "/swagger/v1/swagger.json",
    "/swagger/doc.json",
    "/docs/openapi.json",
    "/openapi.yaml",
    "/swagger.yaml",
]

IMPLEMENTED_STATUS_CODES = {
    200,
    201,
    202,
    204,
    400,
    401,
    403,
    405,
    409,
    415,
    422,
    429,
}

TRANSIENT_RETRY_STATUS_CODES = {429, 502, 503, 504}

STATIC_ASSET_EXTENSIONS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".css",
    ".js",
    ".mjs",
    ".map",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".pdf",
    ".zip",
)

COLLECTION_WRAPPER_KEYS = (
    "data",
    "items",
    "results",
    "records",
    "rows",
    "entries",
    "users",
    "orders",
    "accounts",
    "products",
    "posts",
    "todos",
    "currencies",
)

ITEM_ID_KEYS = (
    "id",
    "_id",
    "uuid",
    "user_id",
    "order_id",
    "account_id",
    "product_id",
    "item_id",
    "post_id",
    "todo_id",
    "code",
)

HYPERMEDIA_LINK_KEYS = {
    "href",
    "url",
    "uri",
    "path",
    "endpoint",
    "self",
    "next",
    "collection",
    "documentation_url",
    "openapi_url",
    "swagger_url",
}

_DYNAMIC_TS_OR_UUID_RE = re.compile(
    r"(?:\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b"
    r"|\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b)"
)
_HTML_HREF_RE = re.compile(r"""href=["']([^"'#?\s>]+)["']""", re.IGNORECASE)
_HTML_CODE_PATH_RE = re.compile(r"""<code>\s*(?:GET|POST|PUT|DELETE|PATCH)?\s*(/[a-zA-Z0-9_\-\./{}]+)\s*</code>""", re.IGNORECASE)

_shared_httpx_client: Optional[Any] = None


def _get_shared_httpx_client() -> Optional[Any]:
    global _shared_httpx_client
    if httpx is None:
        return None
    if _shared_httpx_client is None:
        try:
            _shared_httpx_client = httpx.Client(
                follow_redirects=False,
                verify=True,
                limits=httpx.Limits(max_keepalive_connections=24, max_connections=32),
            )
        except Exception:
            return None
    return _shared_httpx_client


def build_auth_headers_and_params(
    auth: LiveAuthConfig,
) -> Tuple[Dict[str, str], Dict[str, str], str]:
    headers: Dict[str, str] = {
        "Accept": "application/json, application/yaml, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; API-Graveyard-Autopsy/1.2)",
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
    timeout: float = 6.0,
) -> Tuple[int, bytes]:
    body_data: Optional[bytes] = None
    req_headers = dict(headers)
    if method.upper() in ("POST", "PUT", "PATCH"):
        body_data = b"{}"
        req_headers.setdefault("Content-Type", "application/json")

    # Prefer persistent HTTP/1.1 keep-alive connection pool via httpx when available
    # so concurrent probes reuse TLS sockets instead of triggering rate-limits or handshake timeouts.
    client = _get_shared_httpx_client()
    if client is not None:
        current_url = url
        for _ in range(4):
            try:
                resp = client.request(
                    method=method.upper(),
                    url=current_url,
                    content=body_data,
                    headers=req_headers,
                    timeout=timeout,
                )
                if resp.status_code in (301, 302, 303, 307, 308):
                    loc = resp.headers.get("location") or resp.headers.get("Location")
                    if loc:
                        current_url = urllib.parse.urljoin(current_url, loc)
                        continue
                return resp.status_code, resp.content
            except Exception as exc:
                raise ConnectionError(f"Failed to connect to {current_url}: {exc}") from exc
        return 404, b""

    current_url = url
    for _ in range(4):
        req = urllib.request.Request(
            url=current_url,
            data=body_data,
            headers=req_headers,
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.getcode() or 200, resp.read()
        except urllib.error.HTTPError as http_err:
            if http_err.code in (301, 302, 303, 307, 308) and http_err.headers:
                loc = http_err.headers.get("Location")
                if loc:
                    current_url = urllib.parse.urljoin(current_url, loc)
                    continue
            err_body = http_err.read() if http_err.fp else b""
            return http_err.code, err_body
        except urllib.error.URLError as url_err:
            raise ConnectionError(f"Failed to connect to {current_url}: {url_err.reason}") from url_err
        except TimeoutError as time_err:
            raise ConnectionError(f"Timed out connecting to {current_url}") from time_err
    return 404, b""


def _request_with_retry(
    http_req: HttpRequester,
    method: str,
    url: str,
    headers: Dict[str, str],
    timeout: float,
    max_attempts: int = 3,
    backoff_seconds: float = 0.12,
) -> Tuple[int, bytes]:
    """Execute an HTTP request with automatic retry on transient connection/timeout/5xx/429 errors."""
    last_exc: Optional[Exception] = None
    last_result: Optional[Tuple[int, bytes]] = None
    for attempt in range(max_attempts):
        try:
            status_code, body = http_req(method, url, headers, timeout)
            last_result = (status_code, body)
            if status_code not in TRANSIENT_RETRY_STATUS_CODES or attempt == max_attempts - 1:
                return status_code, body
        except Exception as exc:
            last_exc = exc
            if attempt == max_attempts - 1:
                break
        if backoff_seconds > 0:
            time.sleep(backoff_seconds * (attempt + 1))

    if last_result is not None:
        return last_result
    if last_exc is not None:
        raise last_exc
    return 404, b""


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


def _materialize_probe_path(template_path: str, sample_value: str = "autopsy-probe-1") -> str:
    return re.sub(r"\{[^/{}]+\}|:[a-zA-Z0-9_\-]+|<[^/{}>]+>", sample_value, template_path)


def _canonicalize_discovered_path(raw_path: str, is_concrete: bool) -> Tuple[str, str]:
    """
    Convert a path into (template_path, canonical_norm_path).
    For concrete paths discovered during deep crawling (e.g. '/users/42' or '/orders/ord-5501'),
    coerces concrete entity ID segments into '{param}' so multiple concrete links to the same
    parameterized endpoint are deduplicated and probed only once.
    """
    clean = (raw_path or "/").split("?")[0].split("#")[0].strip()
    if not clean.startswith("/"):
        clean = f"/{clean}"
    clean = re.sub(r"/+", "/", clean)
    if len(clean) > 1 and clean.endswith("/"):
        clean = clean.rstrip("/")

    if not is_concrete:
        norm_p, _, _, _ = normalize_template_path(clean)
        return clean, norm_p

    if clean == "/":
        return "/", "/"

    segments = [seg for seg in clean.split("/") if seg]
    tmpl_segments: List[str] = []
    for seg in segments:
        if is_likely_parameter_value(seg):
            tmpl_segments.append("{param}")
        else:
            tmpl_segments.append(seg)
    tmpl_path = "/" + "/".join(tmpl_segments)
    norm_p, _, _, _ = normalize_template_path(tmpl_path)
    return tmpl_path, norm_p


def _compute_body_fingerprint(body: bytes, concrete_path: str) -> Tuple[int, Tuple[str, ...]]:
    """
    Compute a normalized fingerprint (normalized_length, top_level_json_keys) for canary comparison.
    Strips echoed request paths, ISO timestamps, and UUIDs so catch-all responses are matched
    deterministically even when the server echoes the URL or current timestamp.
    """
    if not body:
        return 0, ()
    text = body.decode("utf-8", errors="replace").strip()
    top_keys: Tuple[str, ...] = ()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            top_keys = tuple(sorted(str(k) for k in parsed.keys()))
        elif isinstance(parsed, list):
            top_keys = ("__list__",)
    except Exception:
        pass

    clean_p = concrete_path if concrete_path.startswith("/") else f"/{concrete_path}"
    norm_text = text.replace(clean_p, "{PATH}")
    if len(clean_p) > 1:
        norm_text = norm_text.replace(clean_p.lstrip("/"), "{PATH}")
    norm_text = _DYNAMIC_TS_OR_UUID_RE.sub("{DYNAMIC}", norm_text)
    return len(norm_text), top_keys


def _matches_canary(
    status_code: int,
    body: bytes,
    concrete_path: str,
    canary_sig: Optional[Tuple[int, int, Tuple[str, ...]]],
) -> bool:
    if canary_sig is None:
        return False
    c_status, c_norm_len, c_keys = canary_sig
    if status_code != c_status:
        return False
    norm_len, top_keys = _compute_body_fingerprint(body, concrete_path)
    if c_keys != top_keys:
        return False
    return abs(norm_len - c_norm_len) <= 24


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


def _is_valid_api_candidate_path(path_str: str) -> bool:
    if not path_str or not path_str.startswith("/") or path_str.startswith("//"):
        return False
    if " " in path_str or "\n" in path_str or "\t" in path_str:
        return False
    lower = path_str.lower()
    if any(lower.endswith(ext) for ext in STATIC_ASSET_EXTENSIONS):
        return False
    if lower.startswith("/_autopsy"):
        return False
    return len(path_str) > 1


def _slugify_taxonomy_value(raw_val: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", raw_val.strip().lower()).strip("-")
    return cleaned[:48]


def _extract_parameterized_subroutes_from_json_body(
    body: bytes,
    current_path: str = "/",
) -> List[Tuple[str, str]]:
    """
    Infer parameterized sub-routes (template_path, concrete_probe_path) from structured JSON responses:
    - When an endpoint like '/api/random', '/api/all', or '/products' returns objects with
      'category' or 'group' fields, synthesizes '/.../category/{category}' and '/.../group/{group}'.
    - When a taxonomy list endpoint like '/api/categories', '/api/groups', or '/products/categories'
      returns an array of category/group names, synthesizes sibling filter routes.
    - When an endpoint under a prefix returns objects with a 'name' field, synthesizes
      '{prefix}/similar/{name}' with a concrete word sample.
    """
    if not body:
        return []
    clean_curr = (current_path or "/").rstrip("/")
    if not clean_curr or clean_curr == "/" or "{param}" in clean_curr:
        return []
    lower_curr = clean_curr.lower()
    if any(seg in lower_curr for seg in ("/category/", "/group/", "/similar/")):
        return []

    try:
        text = body.decode("utf-8-sig", errors="replace").strip()
        data = json.loads(text)
    except Exception:
        return []

    results: List[Tuple[str, str]] = []
    parts = [s for s in clean_curr.split("/") if s]
    parent_prefix = "/" + "/".join(parts[:-1]) if len(parts) > 1 else ""
    last_seg = parts[-1].lower() if parts else ""

    # 1. Taxonomy array endpoint (e.g. GET /api/categories or GET /products/categories -> ["electronics", ...])
    if isinstance(data, list) and data and all(isinstance(x, str) for x in data[:5]):
        sample_slug = ""
        for item_str in data[:10]:
            slug = _slugify_taxonomy_value(item_str)
            if slug and "-" not in slug:
                sample_slug = slug
                break
        if not sample_slug:
            sample_slug = _slugify_taxonomy_value(data[0])

        if sample_slug:
            if last_seg == "categories":
                base_p = parent_prefix or ""
                if base_p:
                    results.append((f"{base_p}/category/{{category}}", f"{base_p}/category/{sample_slug}"))
                    results.append((f"{base_p}/all/category/{{category}}", f"{base_p}/all/category/{sample_slug}"))
                    results.append((f"{base_p}/random/category/{{category}}", f"{base_p}/random/category/{sample_slug}"))
            elif last_seg == "groups":
                base_p = parent_prefix or ""
                if base_p:
                    results.append((f"{base_p}/group/{{group}}", f"{base_p}/group/{sample_slug}"))
                    results.append((f"{base_p}/all/group/{{group}}", f"{base_p}/all/group/{sample_slug}"))
                    results.append((f"{base_p}/random/group/{{group}}", f"{base_p}/random/group/{sample_slug}"))

    # 2. Object or list of objects containing 'category', 'group', or 'name'
    sample_objs: List[Dict[str, Any]] = []
    if isinstance(data, dict):
        sample_objs.append(data)
        for wk in (last_seg, *COLLECTION_WRAPPER_KEYS):
            cand_list = data.get(wk)
            if isinstance(cand_list, list):
                sample_objs.extend([r for r in cand_list[:5] if isinstance(r, dict)])
                break
    elif isinstance(data, list):
        sample_objs.extend([r for r in data[:5] if isinstance(r, dict)])

    found_cat = False
    found_grp = False
    found_name = False
    for obj in sample_objs:
        if not found_cat and isinstance(obj.get("category"), str) and obj["category"].strip():
            c_slug = _slugify_taxonomy_value(obj["category"])
            if c_slug:
                results.append((f"{clean_curr}/category/{{category}}", f"{clean_curr}/category/{c_slug}"))
                if parent_prefix and last_seg in ("all", "random"):
                    sib = "random" if last_seg == "all" else "all"
                    results.append((f"{parent_prefix}/{sib}/category/{{category}}", f"{parent_prefix}/{sib}/category/{c_slug}"))
                found_cat = True

        if not found_grp and isinstance(obj.get("group"), str) and obj["group"].strip():
            g_slug = _slugify_taxonomy_value(obj["group"])
            if g_slug:
                results.append((f"{clean_curr}/group/{{group}}", f"{clean_curr}/group/{g_slug}"))
                if parent_prefix and last_seg in ("all", "random"):
                    sib = "random" if last_seg == "all" else "all"
                    results.append((f"{parent_prefix}/{sib}/group/{{group}}", f"{parent_prefix}/{sib}/group/{g_slug}"))
                found_grp = True

        if not found_name and isinstance(obj.get("name"), str) and obj["name"].strip():
            raw_name = obj["name"].strip()
            first_word = re.sub(r"[^a-zA-Z0-9]+", "", raw_name.split(",")[0].split()[0]).lower()
            if first_word and len(first_word) >= 2:
                target_prefix = parent_prefix if parent_prefix else ""
                results.append((f"{target_prefix}/similar/{{name}}", f"{target_prefix}/similar/{first_word}"))
                found_name = True

    return results


def _extract_candidate_paths_from_json_body(
    body: bytes,
    origin_url: str,
    current_path: str = "/",
) -> List[str]:
    """
    Deeply extract candidate API paths from a JSON or HTML response body:
    1. Relative paths ('/api/v1/users') and same-origin URLs anywhere in nested JSON.
    2. Hypermedia/HATEOAS link fields ('href', 'url', 'uri', 'path', 'endpoint', '_links').
    3. Collection-to-detail route inference: if a collection endpoint (e.g. '/users') returns
       objects with an ID field ('id', 'user_id', 'order_id', etc.), synthesizes '/users/{sample_id}'.
    4. HTML href links and inline <code>/api/...</code> paths if the endpoint returned an HTML page.
    """
    discovered_set: Set[str] = set()
    if not body:
        return []

    try:
        text = body.decode("utf-8-sig", errors="replace").strip()
    except Exception:
        return []

    if not text:
        return []

    base_dir = current_path.rstrip("/") or ""

    # Check HTML links and <code> blocks if response looks like HTML
    if text.startswith("<") or "<a " in text.lower() or "<code>" in text.lower():
        for match in _HTML_HREF_RE.findall(text):
            clean_m = match.split("?")[0].split("#")[0].strip()
            if clean_m.startswith(origin_url):
                clean_m = clean_m[len(origin_url):] or "/"
            elif not clean_m.startswith(("http://", "https://", "mailto:", "javascript:", "#")) and not clean_m.startswith("/"):
                clean_m = f"{base_dir}/{clean_m.lstrip('./')}".replace("//", "/")
            if _is_valid_api_candidate_path(clean_m):
                discovered_set.add(clean_m)
        for code_match in _HTML_CODE_PATH_RE.findall(text):
            clean_c = code_match.split("?")[0].split("#")[0].strip()
            if _is_valid_api_candidate_path(clean_c):
                discovered_set.add(clean_c)

    try:
        data = json.loads(text)
    except Exception:
        return sorted(discovered_set)

    def _add_candidate(raw_val: str, allow_relative_to_current: bool = False) -> None:
        if len(discovered_set) >= 60:
            return
        s = raw_val.strip()
        if not s or " " in s:
            return
        if s.startswith(origin_url):
            rel = s[len(origin_url):].split("?")[0].split("#")[0]
            if _is_valid_api_candidate_path(rel):
                discovered_set.add(rel)
        elif s.startswith("/") and not s.startswith("//"):
            path_only = s.split("?")[0].split("#")[0]
            if _is_valid_api_candidate_path(path_only):
                discovered_set.add(path_only)
        elif (
            allow_relative_to_current
            and not s.startswith(("http://", "https://", "mailto:", "javascript:", "#"))
            and re.match(r"^[a-zA-Z0-9_\-\./]+$", s)
        ):
            rel_joined = f"{base_dir}/{s.lstrip('./')}".replace("//", "/")
            path_only = rel_joined.split("?")[0].split("#")[0]
            if _is_valid_api_candidate_path(path_only):
                discovered_set.add(path_only)

    def _visit(val: Any, depth: int = 0) -> None:
        if depth > 8 or len(discovered_set) >= 60:
            return
        if isinstance(val, str):
            _add_candidate(val, allow_relative_to_current=False)
        elif isinstance(val, dict):
            for k, v in val.items():
                k_str = str(k).strip()
                k_lower = k_str.lower()
                _add_candidate(k_str, allow_relative_to_current=False)
                if k_lower in HYPERMEDIA_LINK_KEYS and isinstance(v, str):
                    _add_candidate(v, allow_relative_to_current=True)
                else:
                    _visit(v, depth + 1)
        elif isinstance(val, list):
            for item in val[:60]:
                _visit(item, depth + 1)

    _visit(data)

    # Collection -> Item Detail inference (e.g., GET /users returning [{"id": 1, ...}] -> probe /users/1)
    clean_curr = (current_path or "/").rstrip("/")
    if clean_curr and clean_curr != "/":
        last_seg = clean_curr.split("/")[-1]
        if not is_likely_parameter_value(last_seg) and "{param}" not in clean_curr:
            items_list: Optional[List[Any]] = None
            if isinstance(data, list) and len(data) > 0:
                items_list = data
            elif isinstance(data, dict):
                for wk in (last_seg.lower(), *COLLECTION_WRAPPER_KEYS):
                    cand_list = data.get(wk)
                    if isinstance(cand_list, list) and len(cand_list) > 0:
                        items_list = cand_list
                        break

            if items_list:
                for row_obj in items_list[:5]:
                    if isinstance(row_obj, dict):
                        sample_id: Optional[str] = None
                        for id_key in ITEM_ID_KEYS:
                            raw_id = row_obj.get(id_key)
                            if isinstance(raw_id, (int, str)) and str(raw_id).strip():
                                id_str = str(raw_id).strip()
                                if "/" not in id_str and " " not in id_str and len(id_str) <= 64:
                                    sample_id = id_str
                                    break
                        if sample_id is not None:
                            detail_path = f"{clean_curr}/{sample_id}"
                            if _is_valid_api_candidate_path(detail_path):
                                discovered_set.add(detail_path)
                            break

    return sorted(discovered_set)


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
    timeout_seconds: float = 6.0,
    requester: Optional[HttpRequester] = None,
) -> LiveScanResult:
    auth = auth_config or LiveAuthConfig()
    base_headers, query_params, auth_summary = build_auth_headers_and_params(auth)
    # Mark all scanner requests with X-Autopsy-Log-Ignore so target servers never pollute live traffic logs
    scan_headers = dict(base_headers)
    scan_headers["X-Autopsy-Log-Ignore"] = "true"

    http_req = requester or _default_urllib_requester
    retry_backoff = 0.0 if requester is not None else 0.12
    candidates = resolve_candidate_base_urls(target_base_url)

    resolved_base: Optional[str] = None
    last_conn_err: Optional[str] = None
    initial_user_url_response: Optional[Tuple[int, bytes]] = None
    cached_first_oa_response: Optional[Tuple[str, str, int, bytes]] = None

    probe_check_path = (openapi_path or "/openapi.json").strip() or "/openapi.json"
    for cand in candidates:
        test_url = _append_url_path_and_params(cand, probe_check_path, query_params)
        try:
            st, bd = _request_with_retry(
                http_req,
                "GET",
                test_url,
                scan_headers,
                timeout_seconds,
                max_attempts=2,
                backoff_seconds=retry_backoff,
            )
            resolved_base = cand
            cached_first_oa_response = (cand, probe_check_path, st, bd)
            break
        except Exception as exc:
            last_conn_err = str(exc)
            try:
                direct_url = _append_url_path_and_params(cand, "", query_params)
                st, bd = _request_with_retry(
                    http_req,
                    "GET",
                    direct_url,
                    scan_headers,
                    timeout_seconds,
                    max_attempts=2,
                    backoff_seconds=retry_backoff,
                )
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

        # 2. If not found on first check, probe candidate OpenAPI paths deterministically with retries
        if final_openapi_bytes is None:
            oa_candidates: List[Tuple[str, str]] = []
            search_paths = [probe_check_path] + [p for p in COMMON_OPENAPI_PATHS if p != probe_check_path]
            roots_to_try = [origin_url] if origin_url == resolved_base else [resolved_base, origin_url]
            for b_root in roots_to_try:
                for oa_p in search_paths:
                    if (
                        cached_first_oa_response
                        and b_root == cached_first_oa_response[0]
                        and oa_p == cached_first_oa_response[1]
                        and cached_first_oa_response[2] not in TRANSIENT_RETRY_STATUS_CODES
                    ):
                        continue
                    if (b_root, oa_p) not in oa_candidates:
                        oa_candidates.append((b_root, oa_p))

            def _try_fetch_oa(item: Tuple[str, str]) -> Tuple[str, str, Optional[bytes], Optional[str]]:
                b_root, oa_p = item
                oa_url = _append_url_path_and_params(b_root, oa_p, query_params)
                try:
                    st_code, body = _request_with_retry(
                        http_req,
                        "GET",
                        oa_url,
                        scan_headers,
                        timeout_seconds,
                        max_attempts=2,
                        backoff_seconds=retry_backoff,
                    )
                    if st_code == 200 and body and body.strip():
                        parse_openapi_content(body, filename=oa_p.split("/")[-1] or "openapi.json")
                        return b_root, oa_p, body, None
                    return b_root, oa_p, None, f"HTTP {st_code} at {oa_p}"
                except Exception as exc:
                    return b_root, oa_p, None, str(exc)

            with ThreadPoolExecutor(max_workers=8) as oa_pool:
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
                        "Autopsy ran in Spec-less Live Discovery Mode: all active routes discovered via deep HTTP probing "
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
        r_status, r_body = _request_with_retry(
            http_req,
            "GET",
            introspect_routes_url,
            scan_headers,
            timeout_seconds,
            max_attempts=2,
            backoff_seconds=retry_backoff,
        )
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
        # Track canonical (method, normalized_path) so we never probe or register duplicate concrete routes
        queued_canonical_targets: Set[Tuple[str, str]] = set()
        explicit_canonical_targets: Set[Tuple[str, str]] = set()
        openapi_canonical_targets: Set[Tuple[str, str]] = set()
        # Each queue item is (method, template_path, concrete_path)
        current_hop_queue: List[Tuple[str, str, str]] = []
        expanded_prefixes: Set[str] = set()

        def _enqueue_target(
            method: str,
            raw_path: str,
            is_concrete: bool = False,
            is_explicit: bool = False,
            is_openapi: bool = False,
            concrete_override: Optional[str] = None,
        ) -> None:
            m_up = method.upper().strip()
            tmpl_p, canon_p = _canonicalize_discovered_path(raw_path, is_concrete=is_concrete)
            if concrete_override:
                concrete_p = concrete_override.split("?")[0].split("#")[0].strip()
            else:
                concrete_p = (
                    raw_path.split("?")[0].split("#")[0].strip()
                    if is_concrete
                    else _materialize_probe_path(tmpl_p)
                )
            if not concrete_p.startswith("/"):
                concrete_p = f"/{concrete_p}"

            canon_key = (m_up, canon_p)
            if is_explicit:
                explicit_canonical_targets.add(canon_key)
            if is_openapi:
                openapi_canonical_targets.add(canon_key)
            if canon_key not in queued_canonical_targets:
                queued_canonical_targets.add(canon_key)
                current_hop_queue.append((m_up, tmpl_p, concrete_p))

        # 1. Seed user-supplied path and any parent prefix segments (e.g. /api/v1/users -> /api/v1/users, /api/v1, /api)
        if user_supplied_path and user_supplied_path != "/":
            _enqueue_target("GET", user_supplied_path, is_concrete=False, is_explicit=True)
            path_parts = [seg for seg in user_supplied_path.split("/") if seg]
            for i in range(len(path_parts) - 1, 0, -1):
                parent_prefix = "/" + "/".join(path_parts[:i])
                _enqueue_target("GET", parent_prefix, is_concrete=False, is_explicit=True)
        elif is_specless_mode:
            _enqueue_target("GET", "/", is_concrete=False, is_explicit=True)

        # 2. Seed all documented OpenAPI endpoints
        for ep in parsed_oa.endpoints:
            _enqueue_target(
                ep.method.upper(),
                ep.original_path,
                is_concrete=False,
                is_explicit=True,
                is_openapi=True,
            )

        # 3. Seed user's extra probe paths (both at root and under user-supplied prefix if applicable)
        for m, p in parse_extra_probe_paths(extra_probe_paths):
            _enqueue_target(m, p, is_concrete=False, is_explicit=True)
            if user_supplied_path and user_supplied_path != "/":
                clean_prefix = user_supplied_path.rstrip("/")
                if not p.startswith(f"{clean_prefix}/") and p != clean_prefix:
                    _enqueue_target(m, f"{clean_prefix}{p}", is_concrete=False, is_explicit=True)

        # 4. Seed Spec-less discovery candidates (both at root and under user-supplied prefix if applicable)
        if is_specless_mode:
            for m, p in SPECLESS_DISCOVERY_CANDIDATES:
                _enqueue_target(m, p, is_concrete=False, is_explicit=False)
            if user_supplied_path and user_supplied_path != "/":
                clean_prefix = user_supplied_path.rstrip("/")
                expanded_prefixes.add(clean_prefix)
                for sub_res in PREFIX_SUBRESOURCE_CANDIDATES:
                    _enqueue_target("GET", f"{clean_prefix}/{sub_res}", is_concrete=False, is_explicit=False)

        # 5. Seed shadow / legacy v1 wordlist
        if include_shadow_wordlist:
            for m, p in DEFAULT_SHADOW_CANDIDATES:
                _enqueue_target(m, p, is_concrete=False, is_explicit=False)

        # Establish normalized canary signature to filter out catch-all 200 OK fallbacks (e.g. SPA routers)
        canary_signature: Optional[Tuple[int, int, Tuple[str, ...]]] = None
        canary_path = "/_autopsy_canary_nonexistent_9f8a7b"
        canary_url = _append_url_path_and_params(resolved_base, canary_path, query_params)
        try:
            c_status, c_body = _request_with_retry(
                http_req,
                "GET",
                canary_url,
                scan_headers,
                timeout_seconds,
                max_attempts=2,
                backoff_seconds=retry_backoff,
            )
            if c_status in IMPLEMENTED_STATUS_CODES:
                c_norm_len, c_keys = _compute_body_fingerprint(c_body or b"", canary_path)
                canary_signature = (c_status, c_norm_len, c_keys)
        except Exception:
            pass

        # Track already implemented canonical (method, normalized_path) pairs
        already_implemented_canonical: Set[Tuple[str, str]] = {
            (r["method"].upper(), normalize_template_path(r["path"])[0]) for r in discovered_routes
        }
        now_ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        def _probe_single_target(
            item: Tuple[str, str, str]
        ) -> Optional[Tuple[str, str, str, int, bytes]]:
            method, template_path, concrete_path = item
            probe_url = _append_url_path_and_params(resolved_base, concrete_path, query_params)
            try:
                p_status, p_body = _request_with_retry(
                    http_req,
                    method,
                    probe_url,
                    scan_headers,
                    timeout_seconds,
                    max_attempts=2,
                    backoff_seconds=retry_backoff,
                )
                canon_key = (method, normalize_template_path(template_path)[0])
                # Fallback for integer-typed OpenAPI path parameters (e.g. /users/{id} where 'autopsy-probe-1' 404s)
                if (
                    p_status == 404
                    and canon_key in openapi_canonical_targets
                    and "autopsy-probe-1" in concrete_path
                ):
                    int_concrete = concrete_path.replace("autopsy-probe-1", "1")
                    int_url = _append_url_path_and_params(resolved_base, int_concrete, query_params)
                    alt_status, alt_body = _request_with_retry(
                        http_req,
                        method,
                        int_url,
                        scan_headers,
                        timeout_seconds,
                        max_attempts=2,
                        backoff_seconds=retry_backoff,
                    )
                    if alt_status in IMPLEMENTED_STATUS_CODES:
                        return method, template_path, int_concrete, alt_status, alt_body
                return method, template_path, concrete_path, p_status, p_body
            except Exception:
                return None

        max_crawl_depth = 3
        max_total_probes = 160
        crawl_hops_executed = 0

        for hop in range(max_crawl_depth):
            if not current_hop_queue or probed_count >= max_total_probes:
                break

            remaining_budget = max_total_probes - probed_count
            batch_to_probe = current_hop_queue[:remaining_budget]
            current_hop_queue = []
            crawl_hops_executed = hop + 1

            with ThreadPoolExecutor(max_workers=8) as probe_pool:
                probe_results = list(probe_pool.map(_probe_single_target, batch_to_probe))

            next_hop_candidates: List[Tuple[str, bool, Optional[str]]] = []

            for res_item in probe_results:
                if res_item is None:
                    continue
                method, template_path, concrete_path, p_status, p_body = res_item
                probed_count += 1
                canon_norm = normalize_template_path(template_path)[0]
                canon_key = (method, canon_norm)

                is_catchall = (
                    canon_key not in explicit_canonical_targets
                    and _matches_canary(p_status, p_body or b"", concrete_path, canary_signature)
                )
                if is_catchall:
                    continue

                # Deeply extract links, hypermedia paths, collection item detail routes, and taxonomy subroutes from 200 OK bodies
                if p_status == 200 and p_body and hop < max_crawl_depth - 1:
                    for linked_path in _extract_candidate_paths_from_json_body(
                        p_body, origin_url, current_path=concrete_path
                    ):
                        next_hop_candidates.append((linked_path, True, None))
                    for tmpl_sub, conc_sub in _extract_parameterized_subroutes_from_json_body(
                        p_body, current_path=concrete_path
                    ):
                        next_hop_candidates.append((tmpl_sub, False, conc_sub))

                if p_status in IMPLEMENTED_STATUS_CODES:
                    if canon_key not in already_implemented_canonical:
                        already_implemented_canonical.add(canon_key)
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

                    # If an API version prefix (like /api, /api/v1, /api/v2, /v1, /v2) is active in Spec-less mode,
                    # expand common REST sub-resources under that prefix for the next hop
                    if is_specless_mode and hop < max_crawl_depth - 1:
                        prefix_candidate: Optional[str] = None
                        if canon_norm in ("/api", "/api/v1", "/api/v2", "/v1", "/v2"):
                            prefix_candidate = canon_norm
                        else:
                            parts = [s for s in canon_norm.split("/") if s]
                            if len(parts) >= 2 and parts[0] == "api" and parts[1].startswith("v"):
                                prefix_candidate = f"/{parts[0]}/{parts[1]}"
                            elif len(parts) >= 1 and parts[0] in ("v1", "v2", "v3", "api"):
                                prefix_candidate = f"/{parts[0]}"

                        if prefix_candidate and prefix_candidate not in expanded_prefixes:
                            expanded_prefixes.add(prefix_candidate)
                            for sub_res in PREFIX_SUBRESOURCE_CANDIDATES:
                                next_hop_candidates.append((f"{prefix_candidate}/{sub_res}", False, None))

            # Sort and enqueue next hop candidates deterministically
            for cand_path, is_conc, conc_ovr in sorted(
                set(next_hop_candidates), key=lambda x: (x[0], x[1], x[2] or "")
            ):
                _enqueue_target(
                    "GET",
                    cand_path,
                    is_concrete=is_conc,
                    is_explicit=False,
                    concrete_override=conc_ovr,
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

        # Sort discovered probe routes and synthesized logs deterministically so repeated scans are 100% consistent
        discovered_routes.sort(
            key=lambda r: (
                0 if r.get("framework") != "live-http-probe" else 1,
                str(r.get("path") or ""),
                str(r.get("method") or ""),
                str(r.get("source_file") or ""),
                int(r.get("line_number") or 0),
            )
        )
        synthesized_probe_logs.sort(key=lambda l: (str(l.get("path") or ""), str(l.get("method") or "")))

        notes.append(
            f"Actively probed {probed_count} endpoint(s) across {crawl_hops_executed} discovery hop(s) "
            f"against {resolved_base}; discovered {len(discovered_routes)} live route(s)."
        )

    routes_bytes = json.dumps({"routes": discovered_routes}, indent=2).encode("utf-8")

    final_logs_bytes: Optional[bytes] = logs_override_bytes
    final_logs_filename = logs_override_filename
    logs_captured_count = 0

    if final_logs_bytes is None:
        if not is_specless_mode:
            introspect_logs_url = _append_url_path_and_params(resolved_base, "/_autopsy/logs", query_params)
            try:
                l_status, l_body = _request_with_retry(
                    http_req,
                    "GET",
                    introspect_logs_url,
                    scan_headers,
                    timeout_seconds,
                    max_attempts=2,
                    backoff_seconds=retry_backoff,
                )
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

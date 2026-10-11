import re
from typing import Dict, List, Set, Tuple
from urllib.parse import urlsplit

VALID_HTTP_METHODS: Set[str] = {
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD",
    "TRACE",
}

# Static route keywords that must NOT be coerced into {param} (FR-4: /users/me != /users/{id})
RESERVED_STATIC_SEGMENTS: Set[str] = {
    "me",
    "self",
    "current",
    "profile",
    "health",
    "healthz",
    "ready",
    "status",
    "export",
    "import",
    "search",
    "config",
    "settings",
    "list",
    "all",
    "new",
    "create",
    "edit",
    "update",
    "delete",
    "purge",
    "admin",
    "internal",
    "debug",
    "debug-config",
    "login",
    "logout",
    "register",
    "metrics",
    "flush",
    "warm",
    "cleanup",
    "docs",
    "openapi.json",
    "version",
    "ping",
    "count",
    "summary",
    "batch",
    "bulk",
}

SENSITIVE_QUERY_RE = re.compile(
    r"(?i)((?:access_token|api_key|apikey|token|secret|password|passwd|auth|authorization|session_id|client_secret|key)\s*=\s*)([^&\s]+)"
)
BEARER_RE = re.compile(r"(?i)(bearer\s+)[a-zA-Z0-9_\-\.~+/]+=*")
JWT_RE = re.compile(r"\beyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\b")

BRACE_PARAM_RE = re.compile(r"^\{([a-zA-Z0-9_\-\.]+)\}$")
COLON_PARAM_RE = re.compile(r"^:([a-zA-Z0-9_\-]+)$")
ANGLE_PARAM_RE = re.compile(r"^<(?:[a-zA-Z0-9_]+:)?([a-zA-Z0-9_\-]+)>$")

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
INTEGER_RE = re.compile(r"^\d+$")
HEX_ID_RE = re.compile(r"^[0-9a-fA-F]{10,}$")
PREFIXED_ID_RE = re.compile(r"^[a-zA-Z]{2,8}[-_]\d+[a-zA-Z0-9\-_]*$")
ALNUM_DIGITS_ID_RE = re.compile(r"^(?=.*\d)[a-zA-Z0-9\-_]{6,}$")


def redact_sensitive_text(value: str) -> Tuple[str, bool]:
    """Redact tokens, secrets, and authorization values from strings."""
    if not value:
        return "", False
    redacted = value
    changed = False

    if SENSITIVE_QUERY_RE.search(redacted):
        redacted = SENSITIVE_QUERY_RE.sub(r"\1[REDACTED]", redacted)
        changed = True
    if BEARER_RE.search(redacted):
        redacted = BEARER_RE.sub(r"\1[REDACTED]", redacted)
        changed = True
    if JWT_RE.search(redacted):
        redacted = JWT_RE.sub("[REDACTED_JWT]", redacted)
        changed = True

    return redacted, changed


def normalize_method(raw_method: str) -> Tuple[str, bool]:
    """Normalize HTTP method to uppercase and check validity."""
    if not raw_method or not isinstance(raw_method, str):
        return "UNKNOWN", False
    cleaned = raw_method.strip().upper()
    return cleaned, cleaned in VALID_HTTP_METHODS


def is_likely_parameter_value(segment: str) -> bool:
    """Return True if a concrete URL segment looks like an entity identifier."""
    if not segment:
        return False
    lower = segment.lower()
    if lower in RESERVED_STATIC_SEGMENTS:
        return False
    if lower.startswith("v") and lower[1:].isdigit():
        # API version segments like v0, v1, v2 are static
        return False
    if INTEGER_RE.match(segment):
        return True
    if UUID_RE.match(segment):
        return True
    if HEX_ID_RE.match(segment):
        return True
    if PREFIXED_ID_RE.match(segment):
        return True
    if ALNUM_DIGITS_ID_RE.match(segment):
        return True
    return False


def _clean_structural_path(raw_path: str) -> Tuple[str, str, List[str]]:
    """Sanitize path, strip query/fragment, normalize slashes, and collect warnings."""
    warnings: List[str] = []
    if not raw_path or not isinstance(raw_path, str):
        return "/", "/", ["Empty or missing path value"]

    redacted_raw, was_redacted = redact_sensitive_text(raw_path.strip())
    if was_redacted:
        warnings.append(f"Redacted sensitive token/parameter in path '{redacted_raw}'")

    parsed = urlsplit(redacted_raw)
    path_only = parsed.path.strip()

    if not path_only:
        return "/", redacted_raw, warnings + ["Path was empty after stripping query/fragment"]

    if not path_only.startswith("/"):
        warnings.append(f"Relative path '{redacted_raw}' did not start with '/'; normalized with leading '/'")
        path_only = "/" + path_only

    if " " in path_only:
        warnings.append(f"Path '{redacted_raw}' contains whitespace characters")
        path_only = path_only.replace(" ", "")

    # Collapse multiple consecutive slashes
    path_only = re.sub(r"/+", "/", path_only)

    # Remove trailing slash except for root "/"
    if len(path_only) > 1 and path_only.endswith("/"):
        path_only = path_only.rstrip("/")

    return path_only, redacted_raw, warnings


def normalize_template_path(raw_path: str) -> Tuple[str, str, List[str], List[str]]:
    """
    Normalize a route template path from OpenAPI or route inventory.
    Returns (normalized_path, sanitized_original_path, parameter_names, warnings).
    """
    path_only, redacted_raw, warnings = _clean_structural_path(raw_path)
    if path_only == "/":
        return "/", redacted_raw, [], warnings

    segments = [seg for seg in path_only.split("/") if seg]
    norm_segments: List[str] = []
    param_names: List[str] = []

    for seg in segments:
        m_brace = BRACE_PARAM_RE.match(seg)
        m_colon = COLON_PARAM_RE.match(seg)
        m_angle = ANGLE_PARAM_RE.match(seg)
        if m_brace:
            param_names.append(m_brace.group(1))
            norm_segments.append("{param}")
        elif m_colon:
            param_names.append(m_colon.group(1))
            norm_segments.append("{param}")
        elif m_angle:
            param_names.append(m_angle.group(1))
            norm_segments.append("{param}")
        else:
            norm_segments.append(seg)

    normalized = "/" + "/".join(norm_segments)
    return normalized, redacted_raw, param_names, warnings


def match_or_normalize_log_path(
    raw_path: str,
    method: str,
    known_templates_by_method: Dict[str, Set[str]],
    known_static_by_method: Dict[str, Set[str]],
) -> Tuple[str, str, List[str]]:
    """
    Conservatively match a concrete log path to known route templates or normalize standalone IDs.
    Ensures static routes like /users/me are NEVER merged into /users/{param}.
    Returns (normalized_path, sanitized_original_path, warnings).
    """
    path_only, redacted_raw, warnings = _clean_structural_path(raw_path)
    if path_only == "/":
        return "/", redacted_raw, warnings

    # 1. Exact static route match takes highest priority (e.g. /api/v1/users/me)
    static_for_method = known_static_by_method.get(method, set())
    if path_only in static_for_method:
        return path_only, redacted_raw, warnings

    segments = [seg for seg in path_only.split("/") if seg]

    # Check if path itself already contains template braces
    if any(BRACE_PARAM_RE.match(s) or COLON_PARAM_RE.match(s) for s in segments):
        norm_path, _, _, tmpl_warnings = normalize_template_path(path_only)
        return norm_path, redacted_raw, warnings + tmpl_warnings

    # 2. Match against known parameterized templates for this HTTP method
    templates_for_method = known_templates_by_method.get(method, set())
    matching_templates: List[Tuple[int, str]] = []

    for tmpl in sorted(templates_for_method):
        tmpl_segments = [s for s in tmpl.split("/") if s]
        if len(tmpl_segments) != len(segments):
            continue

        is_match = True
        static_match_count = 0
        for seg, t_seg in zip(segments, tmpl_segments):
            if t_seg == "{param}":
                # Never coerce a reserved static word like 'me' into {param}
                if seg.lower() in RESERVED_STATIC_SEGMENTS:
                    is_match = False
                    break
                # Also if the concrete path with this segment static exists in known_static, do not match
            else:
                if seg != t_seg:
                    is_match = False
                    break
                static_match_count += 1

        if is_match:
            matching_templates.append((static_match_count, tmpl))

    if len(matching_templates) == 1:
        return matching_templates[0][1], redacted_raw, warnings
    elif len(matching_templates) > 1:
        # Check if multiple templates have the exact same specificity (ambiguous match per FR-4)
        matching_templates.sort(key=lambda x: x[0], reverse=True)
        top_specificity = matching_templates[0][0]
        tied = [t for s, t in matching_templates if s == top_specificity]
        if len(tied) > 1:
            warnings.append(
                f"Ambiguous route template match for '{method} {redacted_raw}': matches multiple templates {tied}; preserved without silent merging"
            )
        else:
            return matching_templates[0][1], redacted_raw, warnings

    # 3. Standalone path normalization: mask obvious IDs (integers, UUIDs, prefixed IDs)
    norm_segments: List[str] = []
    for seg in segments:
        if is_likely_parameter_value(seg):
            norm_segments.append("{param}")
        else:
            norm_segments.append(seg)

    normalized = "/" + "/".join(norm_segments)
    return normalized, redacted_raw, warnings


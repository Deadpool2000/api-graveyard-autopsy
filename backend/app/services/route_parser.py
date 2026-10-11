import csv
import io
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from app.services.normalizer import normalize_method, normalize_template_path


@dataclass
class ParsedRouteEntry:
    method: str
    normalized_path: str
    original_path: str
    param_names: List[str] = field(default_factory=list)
    framework: str = ""
    source_file: str = ""
    line_number: Optional[int] = None
    warnings: List[str] = field(default_factory=list)


@dataclass
class RouteParseResult:
    routes: List[ParsedRouteEntry]
    warnings: List[str]
    format_detected: str


class RouteParseError(ValueError):
    """Raised when the route inventory file cannot be parsed."""


def parse_routes_content(content: bytes, filename: str = "routes.csv") -> RouteParseResult:
    """
    Parse backend route inventory in CSV or JSON format (FR-2).
    Minimum fields: method, path.
    Optional fields: framework, source_file, line_number.
    """
    if not content or not content.strip():
        raise RouteParseError("Uploaded route inventory file is empty.")

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise RouteParseError("Route inventory file must be valid UTF-8 text.") from exc

    stripped = text.strip()
    is_json = filename.lower().endswith(".json") or stripped.startswith("[") or stripped.startswith("{")

    raw_rows: List[Dict[str, Any]] = []
    format_detected = "csv"

    if is_json:
        try:
            parsed_json = json.loads(stripped)
            format_detected = "json"
            if isinstance(parsed_json, list):
                raw_rows = [r for r in parsed_json if isinstance(r, dict)]
            elif isinstance(parsed_json, dict) and isinstance(parsed_json.get("routes"), list):
                raw_rows = [r for r in parsed_json["routes"] if isinstance(r, dict)]
            else:
                raise RouteParseError(
                    f"JSON route inventory '{filename}' must be an array of route objects or an object with a 'routes' array."
                )
        except json.JSONDecodeError as exc:
            if filename.lower().endswith(".json"):
                raise RouteParseError(f"Malformed JSON in route inventory '{filename}': {exc}") from exc
            is_json = False

    if not is_json:
        format_detected = "csv"
        reader = csv.DictReader(io.StringIO(stripped))
        if not reader.fieldnames:
            raise RouteParseError(f"CSV route inventory '{filename}' is missing header columns.")
        normalized_headers = {h.strip().lower() for h in reader.fieldnames if h}
        if not {"method", "path"}.issubset(normalized_headers):
            raise RouteParseError(
                f"CSV route inventory '{filename}' must include at least 'method' and 'path' columns (found: {sorted(normalized_headers)})."
            )
        for row in reader:
            cleaned_row = {(k.strip().lower() if k else ""): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
            raw_rows.append(cleaned_row)

    routes: List[ParsedRouteEntry] = []
    warnings: List[str] = []
    seen_routes: Dict[Tuple[str, str], List[str]] = {}

    for idx, row in enumerate(raw_rows, start=1):
        lower_row = {str(k).strip().lower(): v for k, v in row.items()}
        raw_method = str(lower_row.get("method") or "").strip()
        raw_path = str(lower_row.get("path") or "").strip()

        if not raw_method and not raw_path:
            continue

        norm_method, method_ok = normalize_method(raw_method)
        if not method_ok:
            warnings.append(
                f"Route row #{idx}: invalid or unsupported HTTP method '{raw_method}' for path '{raw_path}'."
            )
            continue

        if not raw_path:
            warnings.append(f"Route row #{idx}: missing path for method '{norm_method}'.")
            continue

        norm_path, sanitized_orig, param_names, path_warnings = normalize_template_path(raw_path)
        framework = str(lower_row.get("framework") or "").strip()
        source_file = str(lower_row.get("source_file") or "").strip()
        raw_line = lower_row.get("line_number")
        line_number: Optional[int] = None
        if raw_line not in (None, ""):
            try:
                line_number = int(str(raw_line).strip())
            except ValueError:
                path_warnings.append(f"Route row #{idx}: non-integer line_number '{raw_line}'.")

        loc_label = f"{source_file}:{line_number}" if source_file and line_number else (source_file or f"row #{idx}")
        route_key = (norm_method, norm_path)
        row_warnings = list(path_warnings)

        if route_key in seen_routes:
            prev_locs = ", ".join(seen_routes[route_key])
            dup_msg = (
                f"Duplicate/conflicting route entry for {norm_method} {norm_path} at {loc_label} "
                f"(previously defined at {prev_locs})."
            )
            row_warnings.append(dup_msg)
            warnings.append(dup_msg)
        seen_routes.setdefault(route_key, []).append(loc_label)

        routes.append(
            ParsedRouteEntry(
                method=norm_method,
                normalized_path=norm_path,
                original_path=sanitized_orig,
                param_names=param_names,
                framework=framework,
                source_file=source_file,
                line_number=line_number,
                warnings=row_warnings,
            )
        )

    return RouteParseResult(
        routes=routes,
        warnings=warnings,
        format_detected=format_detected,
    )


import csv
import io
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from app.services.normalizer import match_or_normalize_log_path, normalize_method


@dataclass
class AggregatedLogEndpoint:
    method: str
    normalized_path: str
    original_paths: Set[str] = field(default_factory=set)
    request_count: int = 0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    status_code_counts: Dict[str, int] = field(default_factory=dict)
    latencies_ms: List[float] = field(default_factory=list)
    environments: Set[str] = field(default_factory=set)
    warnings: List[str] = field(default_factory=list)


@dataclass
class LogParseResult:
    endpoints: Dict[Tuple[str, str], AggregatedLogEndpoint]
    warnings: List[str]
    format_detected: str
    total_valid_requests: int
    total_rows_processed: int
    log_start: Optional[str] = None
    log_end: Optional[str] = None
    observation_window_days: Optional[float] = None


class LogParseError(ValueError):
    """Raised when the request log file cannot be parsed."""


def _parse_iso_timestamp(raw_ts: str) -> Optional[datetime]:
    """Parse common ISO-8601 timestamp formats into timezone-aware UTC datetime."""
    if not raw_ts or not isinstance(raw_ts, str):
        return None
    cleaned = raw_ts.strip()
    if not cleaned:
        return None
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%b/%Y:%H:%M:%S %z", "%Y/%m/%d %H:%M:%S"):
            try:
                dt = datetime.strptime(raw_ts.strip(), fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                else:
                    dt = dt.astimezone(timezone.utc)
                return dt
            except ValueError:
                continue
    return None


def parse_logs_content(
    content: bytes,
    filename: str = "access-logs.csv",
    known_templates_by_method: Optional[Dict[str, Set[str]]] = None,
    known_static_by_method: Optional[Dict[str, Set[str]]] = None,
) -> LogParseResult:
    """
    Parse request logs in CSV or JSON format (FR-3).
    Minimum fields: timestamp, method, path, status_code.
    Optional fields: request_id, latency_ms, environment.
    """
    if not content or not content.strip():
        raise LogParseError("Uploaded request log file is empty.")

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise LogParseError("Request log file must be valid UTF-8 text.") from exc

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
            elif isinstance(parsed_json, dict) and isinstance(parsed_json.get("logs"), list):
                raw_rows = [r for r in parsed_json["logs"] if isinstance(r, dict)]
            else:
                raise LogParseError(
                    f"JSON log file '{filename}' must be an array of log objects or an object with a 'logs' array."
                )
        except json.JSONDecodeError as exc:
            if filename.lower().endswith(".json"):
                raise LogParseError(f"Malformed JSON in request log file '{filename}': {exc}") from exc
            is_json = False

    if not is_json:
        format_detected = "csv"
        reader = csv.DictReader(io.StringIO(stripped))
        if not reader.fieldnames:
            raise LogParseError(f"CSV log file '{filename}' is missing header columns.")
        normalized_headers = {h.strip().lower() for h in reader.fieldnames if h}
        required_cols = {"timestamp", "method", "path", "status_code"}
        if not required_cols.issubset(normalized_headers):
            raise LogParseError(
                f"CSV log file '{filename}' must include columns {sorted(required_cols)} (found: {sorted(normalized_headers)})."
            )
        for row in reader:
            cleaned_row = {(k.strip().lower() if k else ""): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
            raw_rows.append(cleaned_row)

    known_templates = known_templates_by_method or {}
    known_static = known_static_by_method or {}

    endpoints: Dict[Tuple[str, str], AggregatedLogEndpoint] = {}
    warnings: List[str] = []
    global_min_ts: Optional[datetime] = None
    global_max_ts: Optional[datetime] = None
    total_valid_requests = 0

    for idx, row in enumerate(raw_rows, start=1):
        lower_row = {str(k).strip().lower(): v for k, v in row.items()}
        raw_ts = str(lower_row.get("timestamp") or "").strip()
        raw_method = str(lower_row.get("method") or "").strip()
        raw_path = str(lower_row.get("path") or "").strip()
        raw_status = str(lower_row.get("status_code") or "").strip()

        if not raw_ts and not raw_method and not raw_path:
            continue

        norm_method, method_ok = normalize_method(raw_method)
        if not method_ok:
            warnings.append(
                f"Log row #{idx}: invalid HTTP method '{raw_method}' for path '{raw_path}'; row skipped."
            )
            continue

        if not raw_path:
            warnings.append(f"Log row #{idx}: missing path for method '{norm_method}'; row skipped.")
            continue

        norm_path, sanitized_orig, path_warnings = match_or_normalize_log_path(
            raw_path=raw_path,
            method=norm_method,
            known_templates_by_method=known_templates,
            known_static_by_method=known_static,
        )

        parsed_ts = _parse_iso_timestamp(raw_ts)
        row_warnings = list(path_warnings)
        if parsed_ts is None:
            ts_warn = f"Log row #{idx} ({norm_method} {norm_path}): missing or unparseable timestamp '{raw_ts}'."
            row_warnings.append(ts_warn)
            warnings.append(ts_warn)
        else:
            if global_min_ts is None or parsed_ts < global_min_ts:
                global_min_ts = parsed_ts
            if global_max_ts is None or parsed_ts > global_max_ts:
                global_max_ts = parsed_ts

        for pw in path_warnings:
            warnings.append(f"Log row #{idx}: {pw}")

        status_label = raw_status if raw_status.isdigit() else "unknown"
        if not raw_status.isdigit():
            s_warn = f"Log row #{idx} ({norm_method} {norm_path}): invalid status_code '{raw_status}'."
            row_warnings.append(s_warn)
            warnings.append(s_warn)

        key = (norm_method, norm_path)
        if key not in endpoints:
            endpoints[key] = AggregatedLogEndpoint(
                method=norm_method,
                normalized_path=norm_path,
            )

        agg = endpoints[key]
        agg.request_count += 1
        total_valid_requests += 1
        if len(agg.original_paths) < 10:
            agg.original_paths.add(sanitized_orig)
        agg.status_code_counts[status_label] = agg.status_code_counts.get(status_label, 0) + 1

        if parsed_ts is not None:
            if agg.first_seen is None or parsed_ts < agg.first_seen:
                agg.first_seen = parsed_ts
            if agg.last_seen is None or parsed_ts > agg.last_seen:
                agg.last_seen = parsed_ts

        raw_latency = lower_row.get("latency_ms")
        if raw_latency not in (None, ""):
            try:
                lat_val = float(str(raw_latency).strip())
                if lat_val >= 0:
                    agg.latencies_ms.append(lat_val)
            except ValueError:
                pass

        raw_env = str(lower_row.get("environment") or "").strip()
        if raw_env:
            agg.environments.add(raw_env)

        for rw in row_warnings:
            if rw not in agg.warnings:
                agg.warnings.append(rw)

    log_start_iso = global_min_ts.isoformat().replace("+00:00", "Z") if global_min_ts else None
    log_end_iso = global_max_ts.isoformat().replace("+00:00", "Z") if global_max_ts else None
    window_days: Optional[float] = None
    if global_min_ts and global_max_ts:
        delta_sec = max(0.0, (global_max_ts - global_min_ts).total_seconds())
        window_days = round(delta_sec / 86400.0, 2)

    return LogParseResult(
        endpoints=endpoints,
        warnings=warnings,
        format_detected=format_detected,
        total_valid_requests=total_valid_requests,
        total_rows_processed=len(raw_rows),
        log_start=log_start_iso,
        log_end=log_end_iso,
        observation_window_days=window_days,
    )


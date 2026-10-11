from datetime import datetime, timezone
from typing import List, Optional

from app.config import get_settings
from app.schemas.models import AnalysisRecord, SourceFileMetadata
from app.services.comparator import build_known_route_maps, compare_and_score_sources
from app.services.log_parser import LogParseError, LogParseResult, parse_logs_content
from app.services.normalizer import redact_sensitive_text
from app.services.openapi_parser import OpenAPIParseError, OpenAPIParseResult, parse_openapi_content
from app.services.route_parser import RouteParseError, RouteParseResult, parse_routes_content
from app.store import store


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def execute_analysis_pipeline(
    analysis_id: str,
    openapi_bytes: Optional[bytes] = None,
    openapi_filename: str = "openapi.json",
    routes_bytes: Optional[bytes] = None,
    routes_filename: str = "routes.csv",
    logs_bytes: Optional[bytes] = None,
    logs_filename: str = "access-logs.csv",
) -> Optional[AnalysisRecord]:
    """
    Run the deterministic analysis pipeline across supplied sources:
    parsing -> normalizing -> comparing -> scoring -> exporting -> completed.
    """
    analysis = store.get_analysis(analysis_id)
    if analysis is None:
        return None
    if analysis.status == "completed":
        return analysis

    # Load raw inputs from store if not passed directly (e.g., when invoked by separate worker container)
    if openapi_bytes is None and routes_bytes is None and logs_bytes is None:
        raw_inputs = store.get_raw_inputs(analysis_id)
        if raw_inputs:
            if raw_inputs.get("openapi_b64"):
                openapi_bytes = raw_inputs["openapi_b64"].encode("utf-8")
                openapi_filename = raw_inputs.get("openapi_filename") or "openapi.json"
            if raw_inputs.get("routes_b64"):
                routes_bytes = raw_inputs["routes_b64"].encode("utf-8")
                routes_filename = raw_inputs.get("routes_filename") or "routes.csv"
            if raw_inputs.get("logs_b64"):
                logs_bytes = raw_inputs["logs_b64"].encode("utf-8")
                logs_filename = raw_inputs.get("logs_filename") or "access-logs.csv"

    try:
        # Stage 1: Parsing
        analysis.status = "processing"
        analysis.stage = "parsing"
        analysis.progress_percent = 20
        store.save_analysis(analysis)

        openapi_res: Optional[OpenAPIParseResult] = None
        routes_res: Optional[RouteParseResult] = None
        logs_res: Optional[LogParseResult] = None
        source_meta: List[SourceFileMetadata] = []

        if openapi_bytes is not None:
            openapi_res = parse_openapi_content(openapi_bytes, filename=openapi_filename)
            source_meta.append(
                SourceFileMetadata(
                    source_type="openapi",
                    filename=openapi_filename,
                    size_bytes=len(openapi_bytes),
                    format=openapi_res.format_detected,
                    record_count=len(openapi_res.endpoints),
                )
            )

        if routes_bytes is not None:
            routes_res = parse_routes_content(routes_bytes, filename=routes_filename)
            source_meta.append(
                SourceFileMetadata(
                    source_type="routes",
                    filename=routes_filename,
                    size_bytes=len(routes_bytes),
                    format=routes_res.format_detected,
                    record_count=len(routes_res.routes),
                )
            )

        # Stage 2: Normalizing & building route template maps
        analysis.stage = "normalizing"
        analysis.progress_percent = 45
        store.save_analysis(analysis)

        known_templates, known_static = build_known_route_maps(openapi_res, routes_res)

        if logs_bytes is not None:
            logs_res = parse_logs_content(
                logs_bytes,
                filename=logs_filename,
                known_templates_by_method=known_templates,
                known_static_by_method=known_static,
            )
            source_meta.append(
                SourceFileMetadata(
                    source_type="logs",
                    filename=logs_filename,
                    size_bytes=len(logs_bytes),
                    format=logs_res.format_detected,
                    record_count=logs_res.total_rows_processed,
                )
            )

        # Stage 3: Comparing & Scoring
        analysis.stage = "comparing"
        analysis.progress_percent = 70
        store.save_analysis(analysis)

        settings = get_settings()
        endpoints, findings, summary = compare_and_score_sources(
            analysis_id=analysis.id,
            openapi_result=openapi_res,
            routes_result=routes_res,
            logs_result=logs_res,
            settings=settings,
        )

        analysis.stage = "scoring"
        analysis.progress_percent = 85
        analysis.source_metadata = source_meta
        analysis.log_start = logs_res.log_start if logs_res else None
        analysis.log_end = logs_res.log_end if logs_res else None
        analysis.endpoints = endpoints
        analysis.findings = findings
        analysis.summary = summary
        store.save_analysis(analysis)

        # Stage 4: Exporting / Finalizing
        analysis.stage = "exporting"
        analysis.progress_percent = 95
        store.save_analysis(analysis)

        analysis.status = "completed"
        analysis.stage = "completed"
        analysis.progress_percent = 100
        analysis.completed_at = _now_iso()
        store.save_analysis(analysis)
        store.delete_raw_inputs(analysis_id)
        return analysis

    except (OpenAPIParseError, RouteParseError, LogParseError) as parse_exc:
        sanitized_err, _ = redact_sensitive_text(str(parse_exc))
        analysis.status = "failed"
        analysis.stage = "failed"
        analysis.error_code = "VALIDATION_PARSE_ERROR"
        analysis.error_message = sanitized_err
        analysis.completed_at = _now_iso()
        store.save_analysis(analysis)
        store.delete_raw_inputs(analysis_id)
        return analysis
    except Exception as exc:
        sanitized_err, _ = redact_sensitive_text(str(exc))
        analysis.status = "failed"
        analysis.stage = "failed"
        analysis.error_code = "INTERNAL_ANALYSIS_ERROR"
        analysis.error_message = f"Analysis failed unexpectedly: {sanitized_err}"
        analysis.completed_at = _now_iso()
        store.save_analysis(analysis)
        store.delete_raw_inputs(analysis_id)
        return analysis


import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse, Response

from app.config import get_settings
from app.schemas.models import AnalysisPublicResponse, AnalysisRecord, Finding
from app.services.live_connector import (
    LiveAuthConfig,
    LiveConnectorError,
    collect_live_api_sources,
    trigger_live_traffic_burst,
)
from app.services.log_parser import LogParseError, parse_logs_content
from app.services.openapi_parser import OpenAPIParseError, parse_openapi_content
from app.services.pipeline import execute_analysis_pipeline
from app.services.report import generate_json_report, generate_markdown_report
from app.services.route_parser import RouteParseError, parse_routes_content
from app.store import store

router = APIRouter(prefix="/api/v1/analyses", tags=["analyses"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _build_ai_status() -> Dict[str, object]:
    settings = get_settings()
    return {
        "enabled": settings.gemini_enabled,
        "configured": settings.is_gemini_configured,
        "provider": "gemini" if settings.is_gemini_configured else "deterministic-fallback",
        "model": settings.gemini_model if settings.is_gemini_configured else None,
        "message": (
            f"Google Gemini ({settings.gemini_model}) is configured and ready for user-triggered investigations."
            if settings.is_gemini_configured
            else "Gemini API key not configured in .env — using deterministic evidence templates as fallback."
        ),
    }


def _to_public_response(record: AnalysisRecord) -> AnalysisPublicResponse:
    return AnalysisPublicResponse(
        id=record.id,
        name=record.name,
        is_demo=record.is_demo,
        status=record.status,
        stage=record.stage,
        progress_percent=record.progress_percent,
        created_at=record.created_at,
        completed_at=record.completed_at,
        source_metadata=record.source_metadata,
        log_start=record.log_start,
        log_end=record.log_end,
        summary=record.summary,
        error_code=record.error_code,
        error_message=record.error_message,
        executive_summary=record.executive_summary,
        investigation_plan=record.investigation_plan,
        suggested_questions=record.suggested_questions,
        ai_status=_build_ai_status(),
    )


def _fallback_background_runner(
    analysis_id: str,
    openapi_bytes: Optional[bytes],
    openapi_filename: str,
    routes_bytes: Optional[bytes],
    routes_filename: str,
    logs_bytes: Optional[bytes],
    logs_filename: str,
) -> None:
    """
    Give the dedicated Redis worker container a brief window to pick up the job;
    if running without the worker container (e.g. in tests) or if still queued, process in-process.
    """
    if store.is_redis_connected():
        time.sleep(0.25)
    current = store.get_analysis(analysis_id)
    if current and current.status == "completed":
        return
    if store.acquire_job_lock(analysis_id, owner="api-fallback"):
        execute_analysis_pipeline(
            analysis_id=analysis_id,
            openapi_bytes=openapi_bytes,
            openapi_filename=openapi_filename,
            routes_bytes=routes_bytes,
            routes_filename=routes_filename,
            logs_bytes=logs_bytes,
            logs_filename=logs_filename,
        )


@router.get("")
def list_saved_analyses(
    limit: int = Query(default=30, ge=1, le=100),
) -> Dict[str, object]:
    """
    List saved historical analysis reports from the persistent SQLite database (newest first).
    """
    records = store.list_analyses(limit=limit)
    items: List[Dict[str, object]] = []
    for rec in records:
        pub = _to_public_response(rec).model_dump()
        pub["analysis_id"] = rec.id
        items.append(pub)
    return {
        "total_count": len(items),
        "sqlite_connected": store.is_sqlite_connected(),
        "analyses": items,
    }


@router.post("/demo", status_code=status.HTTP_201_CREATED)
def create_demo_analysis() -> Dict[str, object]:
    """
    Create and execute an analysis using the built-in synthetic demo dataset (FR-9).
    Works offline without external credentials.
    """
    settings = get_settings()
    sample_dir = settings.sample_data_dir

    openapi_path = sample_dir / "openapi.json"
    routes_path = sample_dir / "routes.csv"
    logs_path = sample_dir / "access-logs.csv"

    if not openapi_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Sample dataset file not found at {openapi_path}",
        )

    openapi_bytes = openapi_path.read_bytes()
    routes_bytes = routes_path.read_bytes() if routes_path.is_file() else None
    logs_bytes = logs_path.read_bytes() if logs_path.is_file() else None

    analysis_id = str(uuid.uuid4())
    record = AnalysisRecord(
        id=analysis_id,
        name="Acme Commerce & Platform API (Synthetic Demo)",
        is_demo=True,
        status="queued",
        stage="queued",
        progress_percent=5,
        created_at=_now_iso(),
    )
    store.save_analysis(record)

    completed = execute_analysis_pipeline(
        analysis_id=analysis_id,
        openapi_bytes=openapi_bytes,
        openapi_filename="openapi.json",
        routes_bytes=routes_bytes,
        routes_filename="routes.csv",
        logs_bytes=logs_bytes,
        logs_filename="access-logs.csv",
    )
    final_record = completed or record
    pub = _to_public_response(final_record).model_dump()
    pub["analysis_id"] = final_record.id
    return pub


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_analysis(
    background_tasks: BackgroundTasks,
    openapi_file: Optional[UploadFile] = File(default=None),
    routes_file: Optional[UploadFile] = File(default=None),
    logs_file: Optional[UploadFile] = File(default=None),
    analysis_name: Optional[str] = Form(default=None),
) -> Dict[str, object]:
    """
    Create a new analysis job from uploaded OpenAPI, route inventory, and/or request log files.
    Validates file sizes and formats before queueing.
    """
    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    openapi_bytes: Optional[bytes] = None
    openapi_filename = "openapi.json"
    routes_bytes: Optional[bytes] = None
    routes_filename = "routes.csv"
    logs_bytes: Optional[bytes] = None
    logs_filename = "access-logs.csv"

    if openapi_file is not None and openapi_file.filename:
        openapi_filename = openapi_file.filename
        openapi_bytes = await openapi_file.read()
        if len(openapi_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"OpenAPI file exceeds the {settings.max_upload_size_mb} MB upload limit.",
            )
        try:
            parse_openapi_content(openapi_bytes, filename=openapi_filename)
        except OpenAPIParseError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

    if routes_file is not None and routes_file.filename:
        routes_filename = routes_file.filename
        routes_bytes = await routes_file.read()
        if len(routes_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Route inventory file exceeds the {settings.max_upload_size_mb} MB upload limit.",
            )
        try:
            parse_routes_content(routes_bytes, filename=routes_filename)
        except RouteParseError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

    if logs_file is not None and logs_file.filename:
        logs_filename = logs_file.filename
        logs_bytes = await logs_file.read()
        if len(logs_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Request logs file exceeds the {settings.max_upload_size_mb} MB upload limit.",
            )
        try:
            parse_logs_content(logs_bytes, filename=logs_filename)
        except LogParseError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

    if openapi_bytes is None and routes_bytes is None and logs_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one valid input file (openapi_file, routes_file, or logs_file) is required.",
        )

    analysis_id = str(uuid.uuid4())
    clean_name = (analysis_name or "").strip()[:120] or f"API Autopsy ({openapi_filename})"

    record = AnalysisRecord(
        id=analysis_id,
        name=clean_name,
        is_demo=False,
        status="queued",
        stage="queued",
        progress_percent=10,
        created_at=_now_iso(),
    )
    store.save_analysis(record)
    store.save_raw_inputs(
        analysis_id=analysis_id,
        openapi_bytes=openapi_bytes,
        openapi_filename=openapi_filename,
        routes_bytes=routes_bytes,
        routes_filename=routes_filename,
        logs_bytes=logs_bytes,
        logs_filename=logs_filename,
    )

    enqueued = store.enqueue_job(analysis_id)
    if not enqueued:
        execute_analysis_pipeline(
            analysis_id=analysis_id,
            openapi_bytes=openapi_bytes,
            openapi_filename=openapi_filename,
            routes_bytes=routes_bytes,
            routes_filename=routes_filename,
            logs_bytes=logs_bytes,
            logs_filename=logs_filename,
        )
    else:
        background_tasks.add_task(
            _fallback_background_runner,
            analysis_id,
            openapi_bytes,
            openapi_filename,
            routes_bytes,
            routes_filename,
            logs_bytes,
            logs_filename,
        )

    latest = store.get_analysis(analysis_id) or record
    pub = _to_public_response(latest).model_dump()
    pub["analysis_id"] = analysis_id
    return pub


@router.post("/live", status_code=status.HTTP_202_ACCEPTED)
async def create_live_analysis(
    background_tasks: BackgroundTasks,
    target_base_url: str = Form(...),
    openapi_path: str = Form(default="/openapi.json"),
    analysis_name: Optional[str] = Form(default=None),
    auth_type: str = Form(default="none"),
    auth_token: str = Form(default=""),
    auth_header_name: str = Form(default="X-API-Key"),
    auth_query_param: str = Form(default="api_key"),
    basic_username: str = Form(default=""),
    basic_password: str = Form(default=""),
    custom_headers_json: str = Form(default=""),
    probe_endpoints: bool = Form(default=True),
    include_shadow_wordlist: bool = Form(default=True),
    extra_probe_paths: Optional[str] = Form(default=None),
    openapi_file: Optional[UploadFile] = File(default=None),
    logs_file: Optional[UploadFile] = File(default=None),
) -> Dict[str, object]:
    """
    Scan a live running API (either the built-in Zombie API container or an external API)
    with optional authentication, active non-destructive route probing, and hybrid file overrides.
    Credentials are used strictly in-memory and never persisted.
    """
    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    openapi_override_bytes: Optional[bytes] = None
    openapi_override_filename = "openapi.json"
    if openapi_file is not None and openapi_file.filename:
        openapi_override_filename = openapi_file.filename
        openapi_override_bytes = await openapi_file.read()
        if len(openapi_override_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"OpenAPI file exceeds the {settings.max_upload_size_mb} MB upload limit.",
            )

    logs_override_bytes: Optional[bytes] = None
    logs_override_filename = "access-logs.csv"
    if logs_file is not None and logs_file.filename:
        logs_override_filename = logs_file.filename
        logs_override_bytes = await logs_file.read()
        if len(logs_override_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Request logs file exceeds the {settings.max_upload_size_mb} MB upload limit.",
            )
        try:
            parse_logs_content(logs_override_bytes, filename=logs_override_filename)
        except LogParseError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

    auth_cfg = LiveAuthConfig(
        auth_type=auth_type,
        auth_token=auth_token,
        auth_header_name=auth_header_name,
        auth_query_param=auth_query_param,
        basic_username=basic_username,
        basic_password=basic_password,
        custom_headers_json=custom_headers_json,
    )

    try:
        scan_result = collect_live_api_sources(
            target_base_url=target_base_url,
            openapi_path=openapi_path,
            auth_config=auth_cfg,
            probe_endpoints=probe_endpoints,
            include_shadow_wordlist=include_shadow_wordlist,
            extra_probe_paths=extra_probe_paths,
            openapi_override_bytes=openapi_override_bytes,
            openapi_override_filename=openapi_override_filename,
            logs_override_bytes=logs_override_bytes,
            logs_override_filename=logs_override_filename,
        )
    except (LiveConnectorError, OpenAPIParseError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    analysis_id = str(uuid.uuid4())
    clean_name = (analysis_name or "").strip()[:120] or f"Live API Scan ({scan_result.resolved_base_url})"

    record = AnalysisRecord(
        id=analysis_id,
        name=clean_name,
        is_demo=False,
        status="queued",
        stage="queued",
        progress_percent=15,
        created_at=_now_iso(),
    )
    store.save_analysis(record)
    store.save_raw_inputs(
        analysis_id=analysis_id,
        openapi_bytes=scan_result.openapi_bytes,
        openapi_filename=scan_result.openapi_filename,
        routes_bytes=scan_result.routes_bytes,
        routes_filename=scan_result.routes_filename,
        logs_bytes=scan_result.logs_bytes,
        logs_filename=scan_result.logs_filename,
    )

    enqueued = store.enqueue_job(analysis_id)
    if not enqueued:
        execute_analysis_pipeline(
            analysis_id=analysis_id,
            openapi_bytes=scan_result.openapi_bytes,
            openapi_filename=scan_result.openapi_filename,
            routes_bytes=scan_result.routes_bytes,
            routes_filename=scan_result.routes_filename,
            logs_bytes=scan_result.logs_bytes,
            logs_filename=scan_result.logs_filename,
        )
    else:
        background_tasks.add_task(
            _fallback_background_runner,
            analysis_id,
            scan_result.openapi_bytes,
            scan_result.openapi_filename,
            scan_result.routes_bytes,
            scan_result.routes_filename,
            scan_result.logs_bytes,
            scan_result.logs_filename,
        )

    latest = store.get_analysis(analysis_id) or record
    pub = _to_public_response(latest).model_dump()
    pub["analysis_id"] = analysis_id
    pub["live_scan_info"] = {
        "resolved_base_url": scan_result.resolved_base_url,
        "auth_summary": scan_result.auth_summary,
        "probed_count": scan_result.probed_count,
        "discovered_routes_count": scan_result.discovered_routes_count,
        "logs_captured_count": scan_result.logs_captured_count,
        "notes": scan_result.notes,
    }
    return pub


@router.post("/live/simulate-traffic")
def simulate_live_traffic(
    target_base_url: str = Form(default="http://target-api:8090"),
) -> Dict[str, object]:
    """
    Trigger a simulated burst of runtime traffic on the Target Zombie API container.
    """
    try:
        return trigger_live_traffic_burst(target_base_url=target_base_url)
    except LiveConnectorError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/{analysis_id}")
def get_analysis_status(analysis_id: str) -> Dict[str, object]:
    """Return status, stage, summary, and metadata for an analysis."""
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")
    pub = _to_public_response(record).model_dump()
    pub["analysis_id"] = record.id
    return pub


@router.delete("/{analysis_id}")
def delete_saved_analysis(analysis_id: str) -> Dict[str, object]:
    """Delete a saved analysis report from the SQLite history database and Redis cache."""
    deleted = store.delete_analysis(analysis_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")
    return {"status": "deleted", "analysis_id": analysis_id}


@router.get("/{analysis_id}/findings")
def list_analysis_findings(
    analysis_id: str,
    category: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    method: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    min_score: int = Query(default=0, ge=0, le=100),
    max_score: int = Query(default=100, ge=0, le=100),
) -> Dict[str, object]:
    """Return filtered findings for an analysis (FR-7)."""
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")

    filtered: List[Finding] = []
    for f in record.findings:
        if category and category.lower() != "all" and f.category.lower() != category.strip().lower():
            continue
        if severity and severity.lower() != "all" and f.severity.lower() != severity.strip().lower():
            continue
        if method and method.lower() != "all" and f.method.upper() != method.strip().upper():
            continue
        if f.review_priority_score < min_score or f.review_priority_score > max_score:
            continue
        if search:
            q = search.strip().lower()
            haystack = f"{f.id} {f.method} {f.path} {f.category} {' '.join(f.evidence)}".lower()
            if q not in haystack:
                continue
        filtered.append(f)

    return {
        "analysis_id": record.id,
        "total_count": len(record.findings),
        "filtered_count": len(filtered),
        "findings": [f.model_dump() for f in filtered],
    }


@router.get("/{analysis_id}/report")
def export_analysis_report(
    analysis_id: str,
    format: str = Query(default="markdown", description="Export format: markdown or json"),
) -> Response:
    """Export analysis report as Markdown or JSON (FR-8)."""
    record = store.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")

    fmt = format.strip().lower()
    if fmt in ("markdown", "md"):
        md_content = generate_markdown_report(record)
        return PlainTextResponse(
            content=md_content,
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="api-autopsy-{record.id[:8]}.md"'
            },
        )
    elif fmt == "json":
        json_content = generate_json_report(record)
        return Response(
            content=json_content,
            media_type="application/json; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="api-autopsy-{record.id[:8]}.json"'
            },
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported report format. Allowed values: 'markdown' or 'json'.",
        )

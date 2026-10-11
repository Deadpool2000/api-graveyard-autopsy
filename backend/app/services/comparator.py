from typing import Dict, List, Optional, Set, Tuple

from app.config import Settings, get_settings
from app.schemas.models import (
    AnalysisSummary,
    EndpointObservation,
    Finding,
    FindingCategory,
    LatencySummary,
)
from app.services.log_parser import LogParseResult
from app.services.openapi_parser import OpenAPIParseResult
from app.services.route_parser import RouteParseResult
from app.services.scorer import compute_finding_score


def build_known_route_maps(
    openapi_result: Optional[OpenAPIParseResult],
    routes_result: Optional[RouteParseResult],
) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
    """
    Extract known parameterized templates and static paths by HTTP method from OpenAPI and route inventory.
    Used so log paths match declared/implemented routes conservatively without merging static routes like /users/me.
    """
    templates_by_method: Dict[str, Set[str]] = {}
    static_by_method: Dict[str, Set[str]] = {}

    if openapi_result:
        for ep in openapi_result.endpoints:
            if "{param}" in ep.normalized_path:
                templates_by_method.setdefault(ep.method, set()).add(ep.normalized_path)
            else:
                static_by_method.setdefault(ep.method, set()).add(ep.normalized_path)

    if routes_result:
        for rt in routes_result.routes:
            if "{param}" in rt.normalized_path:
                templates_by_method.setdefault(rt.method, set()).add(rt.normalized_path)
            else:
                static_by_method.setdefault(rt.method, set()).add(rt.normalized_path)

    return templates_by_method, static_by_method


def _build_evidence_and_checks(
    category: FindingCategory,
    obs: EndpointObservation,
    sources_supplied: List[str],
    log_start: Optional[str],
    log_end: Optional[str],
    observation_window_days: Optional[float],
) -> Tuple[List[str], List[str], List[str]]:
    """Generate deterministic evidence lines, explicit limitations, and human verification steps."""
    evidence: List[str] = []
    limitations: List[str] = []
    checks: List[str] = []

    # Source presence evidence
    if "openapi" in obs.sources_present:
        orig_oa = ", ".join(obs.original_paths.get("openapi", [obs.normalized_path]))
        owner = (obs.openapi_metadata or {}).get("owner", "")
        owner_note = f" (owner: {owner})" if owner else ""
        evidence.append(f"Declared in OpenAPI specification as `{obs.method} {orig_oa}`{owner_note}.")
    elif "openapi" in sources_supplied:
        evidence.append("Absent from the uploaded OpenAPI specification.")

    if "routes" in obs.sources_present:
        orig_rt = ", ".join(obs.original_paths.get("routes", [obs.normalized_path]))
        locs = [
            f"{m.get('source_file')}:{m.get('line_number')}"
            if m.get("source_file") and m.get("line_number")
            else m.get("source_file", "")
            for m in obs.route_metadata
            if m.get("source_file")
        ]
        loc_note = f" in {', '.join(locs)}" if locs else ""
        evidence.append(f"Present in backend route inventory as `{obs.method} {orig_rt}`{loc_note}.")
    elif "routes" in sources_supplied:
        evidence.append("Absent from the uploaded backend route inventory.")

    if "logs" in obs.sources_present:
        orig_lg = ", ".join(obs.original_paths.get("logs", [obs.normalized_path])[:3])
        status_summary = ", ".join(f"{k}: {v}" for k, v in sorted(obs.status_code_counts.items()))
        seen_range = (
            f" between {obs.first_seen} and {obs.last_seen}"
            if obs.first_seen and obs.last_seen
            else ""
        )
        evidence.append(
            f"Observed {obs.request_count} request(s) in logs (sample path: `{orig_lg}`; status codes: {status_summary or 'N/A'}){seen_range}."
        )
    elif "logs" in sources_supplied:
        if observation_window_days is not None and log_start and log_end:
            evidence.append(
                f"Not observed in the uploaded request logs (0 matching requests across {observation_window_days:.1f} days from {log_start} to {log_end})."
            )
        else:
            evidence.append("Not observed in the uploaded request log sample (0 matching requests).")

    for w in obs.data_quality_warnings:
        evidence.append(f"Data-quality observation: {w}")

    # Limitations (Crucial guardrail: "not observed" != "dead")
    if category in ("Implemented but not observed", "Documented but not observed"):
        limitations.append(
            "Absence from the uploaded request logs does NOT prove this endpoint is unused or safe to delete."
        )
        limitations.append(
            "Quiet endpoints may serve seasonal workflows (e.g., quarterly/annual exports), cron jobs, disaster recovery, webhook callbacks, or unlogged internal gateways."
        )
    if "logs" not in sources_supplied:
        limitations.append("No request logs were uploaded; runtime traffic cannot be evaluated.")
    elif observation_window_days is None or observation_window_days < 7.0:
        limitations.append(
            "Log observation window is short or contains unparseable timestamps, reducing confidence in traffic coverage."
        )
    if "routes" not in sources_supplied:
        limitations.append("No backend route inventory was uploaded; code implementation presence could not be verified.")
    limitations.append(
        "Static analysis of uploaded metadata cannot verify external client SDKs, partner integrations, or authentication rules."
    )

    # Recommended human checks
    if category == "Documented but not implemented":
        checks = [
            "Verify whether the endpoint was recently removed or renamed in backend code without updating OpenAPI.",
            "Check if the route is served by a separate microservice, API gateway, or serverless function not included in this route inventory.",
            "Search client SDKs and API consumers for references to this path before removing it from documentation.",
            "If deprecated, publish a formal deprecation notice or restore the route handler if still contractually required.",
        ]
    elif category == "Implemented but undocumented":
        checks = [
            "Inspect the route handler source file to confirm whether the endpoint is intended for public/internal use or is leftover debug/legacy code.",
            "Verify authentication, authorization, and rate-limiting middleware on this undocumented route.",
            "If the endpoint is active and legitimate, add it to the OpenAPI specification with an owner and schema.",
            "If it is a candidate for retirement, check internal callers and schedule a monitored deprecation window.",
        ]
    elif category == "Observed but undocumented":
        checks = [
            "Investigate where traffic to this undocumented path is routed (e.g., legacy router, proxy fallback, or shadow endpoint).",
            "Inspect caller user-agents, client IPs, or service identities in upstream gateway logs.",
            "Assess security posture and access controls immediately if the endpoint exposes internal state or admin actions.",
            "Document the endpoint in OpenAPI if still supported, or coordinate consumer migration if legacy.",
        ]
    elif category in ("Implemented but not observed", "Documented but not observed"):
        checks = [
            "Confirm that uploaded logs cover all production environments, API gateways, and internal service meshes.",
            "Check scheduled jobs, admin portals, webhook triggers, and quarterly/annual batch workflows.",
            "Search client repositories and internal service calls for references to this endpoint.",
            "Confirm endpoint ownership and business purpose with the owning team.",
            "Deprecate only after owner approval, deprecation headers, and a monitored transition window.",
        ]
    else:
        checks = [
            "Review duplicate or conflicting route registrations in the backend router configuration.",
            "Fix malformed log timestamps or invalid HTTP methods in the log ingestion pipeline.",
            "Ensure sensitive tokens are never passed in URL query strings.",
        ]

    return evidence, limitations, checks


def compare_and_score_sources(
    analysis_id: str,
    openapi_result: Optional[OpenAPIParseResult],
    routes_result: Optional[RouteParseResult],
    logs_result: Optional[LogParseResult],
    settings: Optional[Settings] = None,
) -> Tuple[List[EndpointObservation], List[Finding], AnalysisSummary]:
    """
    Combine normalized endpoints across OpenAPI, route inventory, and logs,
    then deterministically generate and score all P0 findings.
    """
    cfg = settings or get_settings()

    sources_supplied: List[str] = []
    if openapi_result is not None:
        sources_supplied.append("openapi")
    if routes_result is not None:
        sources_supplied.append("routes")
    if logs_result is not None:
        sources_supplied.append("logs")

    all_sources = ["openapi", "routes", "logs"]
    sources_missing = [s for s in all_sources if s not in sources_supplied]

    possible_comparisons: List[str] = []
    if "openapi" in sources_supplied and "routes" in sources_supplied:
        possible_comparisons.append("OpenAPI vs Route Inventory (Contract vs Implementation)")
    if "openapi" in sources_supplied and "logs" in sources_supplied:
        possible_comparisons.append("OpenAPI vs Request Logs (Contract vs Observed Traffic)")
    if "routes" in sources_supplied and "logs" in sources_supplied:
        possible_comparisons.append("Route Inventory vs Request Logs (Implementation vs Observed Traffic)")

    obs_map: Dict[Tuple[str, str], EndpointObservation] = {}

    def get_or_create_obs(method: str, norm_path: str) -> EndpointObservation:
        key = (method, norm_path)
        if key not in obs_map:
            obs_map[key] = EndpointObservation(
                method=method,
                normalized_path=norm_path,
                original_paths={},
                sources_present=[],
            )
        return obs_map[key]

    # 1. Populate OpenAPI endpoints
    openapi_unique: Set[Tuple[str, str]] = set()
    if openapi_result:
        for ep in openapi_result.endpoints:
            openapi_unique.add((ep.method, ep.normalized_path))
            obs = get_or_create_obs(ep.method, ep.normalized_path)
            if "openapi" not in obs.sources_present:
                obs.sources_present.append("openapi")
            oa_paths = obs.original_paths.setdefault("openapi", [])
            if ep.original_path not in oa_paths:
                oa_paths.append(ep.original_path)
            obs.openapi_metadata = {
                "summary": ep.summary,
                "description": ep.description,
                "owner": ep.owner,
                "operation_id": ep.operation_id,
                "deprecated": str(ep.deprecated).lower(),
                "has_metadata_fields": str(ep.has_metadata_fields).lower(),
            }
            for w in ep.warnings:
                if w not in obs.data_quality_warnings:
                    obs.data_quality_warnings.append(w)

    # 2. Populate Route Inventory endpoints
    routes_unique: Set[Tuple[str, str]] = set()
    if routes_result:
        for rt in routes_result.routes:
            routes_unique.add((rt.method, rt.normalized_path))
            obs = get_or_create_obs(rt.method, rt.normalized_path)
            if "routes" not in obs.sources_present:
                obs.sources_present.append("routes")
            rt_paths = obs.original_paths.setdefault("routes", [])
            if rt.original_path not in rt_paths:
                rt_paths.append(rt.original_path)
            obs.route_metadata.append(
                {
                    "framework": rt.framework,
                    "source_file": rt.source_file,
                    "line_number": str(rt.line_number) if rt.line_number is not None else "",
                }
            )
            for w in rt.warnings:
                if w not in obs.data_quality_warnings:
                    obs.data_quality_warnings.append(w)

    # 3. Populate Request Log endpoints
    logs_unique: Set[Tuple[str, str]] = set()
    if logs_result:
        for key, agg in logs_result.endpoints.items():
            logs_unique.add(key)
            obs = get_or_create_obs(agg.method, agg.normalized_path)
            if "logs" not in obs.sources_present:
                obs.sources_present.append("logs")
            obs.original_paths["logs"] = sorted(agg.original_paths)
            obs.request_count = agg.request_count
            obs.first_seen = (
                agg.first_seen.isoformat().replace("+00:00", "Z") if agg.first_seen else None
            )
            obs.last_seen = (
                agg.last_seen.isoformat().replace("+00:00", "Z") if agg.last_seen else None
            )
            obs.status_code_counts = dict(agg.status_code_counts)
            if agg.latencies_ms:
                obs.latency_summary = LatencySummary(
                    min_ms=round(min(agg.latencies_ms), 2),
                    max_ms=round(max(agg.latencies_ms), 2),
                    avg_ms=round(sum(agg.latencies_ms) / len(agg.latencies_ms), 2),
                )
            for w in agg.warnings:
                if w not in obs.data_quality_warnings:
                    obs.data_quality_warnings.append(w)

    window_days = logs_result.observation_window_days if logs_result else None
    log_start = logs_result.log_start if logs_result else None
    log_end = logs_result.log_end if logs_result else None

    findings: List[Finding] = []
    finding_counter = 1

    def add_finding(category: FindingCategory, obs: EndpointObservation) -> None:
        nonlocal finding_counter
        score, score_reasons, severity = compute_finding_score(
            category=category,
            observation=obs,
            sources_supplied=sources_supplied,
            observation_window_days=window_days,
            settings=cfg,
        )
        evidence, limitations, checks = _build_evidence_and_checks(
            category=category,
            obs=obs,
            sources_supplied=sources_supplied,
            log_start=log_start,
            log_end=log_end,
            observation_window_days=window_days,
        )
        missing_for_ep = [s for s in sources_supplied if s not in obs.sources_present]
        fid = f"FND-{finding_counter:03d}"
        finding_counter += 1

        findings.append(
            Finding(
                id=fid,
                analysis_id=analysis_id,
                method=obs.method,
                path=obs.normalized_path,
                original_paths=obs.original_paths,
                category=category,
                severity=severity,
                review_priority_score=score,
                score_reasons=score_reasons,
                sources_present=list(obs.sources_present),
                sources_missing=missing_for_ep,
                request_count=obs.request_count,
                first_seen=obs.first_seen,
                last_seen=obs.last_seen,
                status_code_counts=obs.status_code_counts,
                evidence=evidence,
                limitations=limitations,
                recommended_checks=checks,
            )
        )

    # Evaluate deterministic rules across all observed/declared endpoints
    for key in sorted(obs_map.keys()):
        obs = obs_map[key]
        in_oa = "openapi" in obs.sources_present
        in_rt = "routes" in obs.sources_present
        in_lg = "logs" in obs.sources_present

        # Rule 1: Documented but not implemented (In OpenAPI, absent from supplied routes)
        if in_oa and "routes" in sources_supplied and not in_rt:
            add_finding("Documented but not implemented", obs)

        # Rule 2: Implemented but undocumented (In routes, absent from OpenAPI)
        if in_rt and "openapi" in sources_supplied and not in_oa:
            add_finding("Implemented but undocumented", obs)

        # Rule 3: Observed but undocumented (In logs, absent from OpenAPI)
        if in_lg and "openapi" in sources_supplied and not in_oa:
            add_finding("Observed but undocumented", obs)

        # Rule 4: Implemented but not observed (In routes, absent from supplied logs)
        if in_rt and "logs" in sources_supplied and not in_lg:
            add_finding("Implemented but not observed", obs)

        # Rule 5: Documented but not observed (In OpenAPI, absent from supplied logs)
        if in_oa and "logs" in sources_supplied and not in_lg:
            add_finding("Documented but not observed", obs)

        # Rule 6: Endpoint-level Data-quality issue
        if obs.data_quality_warnings:
            add_finding("Data-quality issue", obs)

    # Also check global parser warnings not tied to a valid endpoint (e.g., invalid HTTP verb rows)
    unattached_warnings: List[str] = []
    attached_warnings: Set[str] = set()
    for obs in obs_map.values():
        attached_warnings.update(obs.data_quality_warnings)

    for src_res in (openapi_result, routes_result, logs_result):
        if src_res:
            for w in src_res.warnings:
                if w not in attached_warnings and w not in unattached_warnings:
                    unattached_warnings.append(w)

    if unattached_warnings:
        dq_obs = EndpointObservation(
            method="N/A",
            normalized_path="/[unparseable-or-invalid-records]",
            original_paths={},
            sources_present=list(sources_supplied),
            data_quality_warnings=unattached_warnings,
        )
        add_finding("Data-quality issue", dq_obs)

    # Sort findings by review_priority_score descending, then severity, then path
    severity_rank = {"High": 0, "Medium": 1, "Review": 2, "Informational": 3}
    findings.sort(
        key=lambda f: (-f.review_priority_score, severity_rank.get(f.severity, 9), f.path, f.method)
    )

    # Re-number finding IDs sequentially after priority sort so FND-001 is highest priority
    for idx, f in enumerate(findings, start=1):
        f.id = f"FND-{idx:03d}"

    by_category: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    for f in findings:
        by_category[f.category] = by_category.get(f.category, 0) + 1
        by_severity[f.severity] = by_severity.get(f.severity, 0) + 1

    if "logs" not in sources_supplied:
        window_note = "No request log file uploaded; runtime observation window unavailable."
    elif window_days is not None:
        window_note = f"Observed traffic covers {window_days:.1f} days ({log_start} to {log_end})."
    else:
        window_note = "Log file uploaded, but valid timestamp range could not be determined."

    summary = AnalysisSummary(
        sources_supplied=sources_supplied,
        sources_missing=sources_missing,
        possible_comparisons=possible_comparisons,
        openapi_endpoint_count=len(openapi_unique),
        routes_endpoint_count=len(routes_unique),
        logs_endpoint_count=len(logs_unique),
        total_unique_endpoints=len(obs_map),
        total_log_requests=logs_result.total_valid_requests if logs_result else 0,
        total_findings=len(findings),
        findings_by_category=by_category,
        findings_by_severity=by_severity,
        observation_window_days=window_days,
        observation_window_note=window_note,
    )

    sorted_endpoints = [obs_map[k] for k in sorted(obs_map.keys())]
    return sorted_endpoints, findings, summary


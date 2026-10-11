from typing import List, Optional, Tuple

from app.config import Settings, get_settings
from app.schemas.models import EndpointObservation, FindingCategory, SeverityLevel


CATEGORY_SEVERITY: dict[FindingCategory, SeverityLevel] = {
    "Documented but not implemented": "High",
    "Implemented but undocumented": "Medium",
    "Observed but undocumented": "Medium",
    "Implemented but not observed": "Review",
    "Documented but not observed": "Review",
    "Data-quality issue": "Informational",
}


def compute_finding_score(
    category: FindingCategory,
    observation: EndpointObservation,
    sources_supplied: List[str],
    observation_window_days: Optional[float],
    settings: Optional[Settings] = None,
) -> Tuple[int, List[str], SeverityLevel]:
    """
    Deterministically calculate a review-priority score (0-100) and human-readable reasons (FR-6).
    Never claims an endpoint is dead or safe to delete.
    """
    cfg = settings or get_settings()
    score = 0
    reasons: List[str] = []
    severity = CATEGORY_SEVERITY.get(category, "Review")

    in_openapi = "openapi" in observation.sources_present
    in_routes = "routes" in observation.sources_present
    in_logs = "logs" in observation.sources_present

    if category == "Documented but not implemented":
        pts = cfg.score_weight_documented_not_in_routes
        score += pts
        reasons.append(
            f"+{pts} pts: Declared in OpenAPI specification but absent from supplied backend route inventory"
        )
        if not in_logs and "logs" in sources_supplied:
            w_pts = (
                cfg.score_weight_no_traffic_long_window
                if (observation_window_days is not None and observation_window_days >= 7.0)
                else cfg.score_weight_no_traffic_short_window
            )
            score += w_pts
            window_label = (
                f"{observation_window_days:.1f}-day log window"
                if observation_window_days is not None
                else "supplied log sample"
            )
            reasons.append(f"+{w_pts} pts: Zero requests observed in {window_label}")

    elif category == "Implemented but undocumented":
        pts = cfg.score_weight_absent_from_openapi
        score += pts
        reasons.append(f"+{pts} pts: Implemented in route inventory but absent from OpenAPI specification")
        if in_logs and observation.request_count > 0:
            score += 15
            reasons.append(
                f"+15 pts: Actively receiving traffic ({observation.request_count} requests) without contract documentation"
            )
        elif not in_logs and "logs" in sources_supplied:
            score += 15
            reasons.append("+15 pts: Also absent from supplied request logs")

    elif category == "Observed but undocumented":
        pts = cfg.score_weight_absent_from_openapi
        score += pts
        reasons.append(f"+{pts} pts: Observed in request logs but absent from OpenAPI specification")
        if observation.request_count > 0:
            score += 15
            reasons.append(
                f"+15 pts: Observed {observation.request_count} request(s) in logs requiring contract/security review"
            )
        if "routes" in sources_supplied and not in_routes:
            score += 20
            reasons.append(
                "+20 pts: Observed in traffic logs but absent from supplied backend route inventory (possible legacy/gateway/shadow route)"
            )

    elif category == "Implemented but not observed":
        pts = cfg.score_weight_implemented_not_in_logs
        score += pts
        reasons.append(f"+{pts} pts: Implemented in route inventory but absent from supplied request logs")
        if observation_window_days is not None and observation_window_days >= 7.0:
            w_pts = cfg.score_weight_no_traffic_long_window
            score += w_pts
            reasons.append(
                f"+{w_pts} pts: No observed traffic across {observation_window_days:.1f}-day observation window"
            )
        else:
            w_pts = cfg.score_weight_no_traffic_short_window
            score += w_pts
            reasons.append(
                f"+{w_pts} pts: No observed traffic in sample (confidence limited by short or unknown observation window)"
            )
        if "openapi" in sources_supplied and not in_openapi:
            u_pts = cfg.score_weight_absent_from_openapi
            score += u_pts
            reasons.append(f"+{u_pts} pts: Also absent from OpenAPI specification")

    elif category == "Documented but not observed":
        score += 25
        reasons.append("+25 pts: Documented in OpenAPI specification but absent from supplied request logs")
        if observation_window_days is not None and observation_window_days >= 7.0:
            w_pts = cfg.score_weight_no_traffic_long_window
            score += w_pts
            reasons.append(
                f"+{w_pts} pts: No observed traffic across {observation_window_days:.1f}-day observation window"
            )
        else:
            w_pts = cfg.score_weight_no_traffic_short_window
            score += w_pts
            reasons.append(
                f"+{w_pts} pts: No observed traffic in sample (confidence limited by short or unknown observation window)"
            )

    elif category == "Data-quality issue":
        pts = cfg.score_weight_conflicting_metadata
        score += pts
        reasons.append(
            f"+{pts} pts: Data-quality warning, malformed log/route record, or conflicting route definition"
        )
        if len(observation.data_quality_warnings) > 1:
            score += 10
            reasons.append(
                f"+10 pts: Multiple ({len(observation.data_quality_warnings)}) data-quality warnings recorded"
            )

    # Check conflicting/duplicate route metadata across non-data-quality findings
    if category != "Data-quality issue" and observation.data_quality_warnings:
        c_pts = cfg.score_weight_conflicting_metadata
        score += c_pts
        reasons.append(f"+{c_pts} pts: Associated route or log metadata has duplicate/conflicting warnings")

    # Check missing owner or description ONLY if OpenAPI metadata was actually supplied for the spec
    if in_openapi and observation.openapi_metadata:
        has_meta_support = observation.openapi_metadata.get("has_metadata_fields") == "true"
        if has_meta_support:
            missing_owner = not observation.openapi_metadata.get("owner")
            missing_desc = not observation.openapi_metadata.get("description")
            if missing_owner or missing_desc:
                m_pts = cfg.score_weight_missing_openapi_metadata
                score += m_pts
                missing_parts = []
                if missing_owner:
                    missing_parts.append("owner")
                if missing_desc:
                    missing_parts.append("description")
                reasons.append(
                    f"+{m_pts} pts: OpenAPI operation is missing {' and '.join(missing_parts)} metadata"
                )

    clamped_score = max(5, min(100, score))
    return clamped_score, reasons, severity


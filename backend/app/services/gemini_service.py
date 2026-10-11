import concurrent.futures
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Type, TypeVar
from pydantic import BaseModel

from app.config import get_settings
from app.schemas.models import (
    AIExplanationRecord,
    AIExplanationSchema,
    AnalysisRecord,
    ChatResponseRecord,
    ChatResponseSchema,
    ExecutiveSummaryRecord,
    ExecutiveSummarySchema,
    Finding,
    InvestigationPlanRecord,
    InvestigationPlanSchema,
    InvestigationPlanStep,
)
from app.services.normalizer import redact_sensitive_text
from app.store import store

PROMPT_VERSION = "v1.2"

T = TypeVar("T", bound=BaseModel)

SYSTEM_INSTRUCTION = """You are an evidence-grounded API lifecycle investigator assisting a backend engineer in API Graveyard Autopsy.
Strict Rules:
1. Use ONLY the supplied JSON evidence. Never pretend you inspected source code, live production servers, or external systems not in the JSON.
2. Distinguish established facts (present in supplied sources) from possibilities (hypotheses to verify).
3. If evidence or a source is missing, explicitly state that limitation.
4. NEVER conclude or claim that an endpoint is "safe to delete", "definitely dead", or "100% unused".
5. Emphasize that "not observed in logs" only means absent from the uploaded log sample, NOT unused.
6. Do not invent traffic counts, dates, owners, source files, vulnerabilities, or dependencies.
7. Never output destructive shell or deployment commands that automatically delete endpoints.
8. Return strictly valid JSON matching the requested schema."""

FORBIDDEN_PHRASES = [
    "safe to delete",
    "definitely dead",
    "100% unused",
    "certainly unused",
    "can be deleted immediately",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sanitize_text_guardrail(text: str) -> str:
    """Ensure model output never claims an endpoint is safe to delete and redact any accidental token."""
    cleaned, _ = redact_sensitive_text(text)
    lower = cleaned.lower()
    for phrase in FORBIDDEN_PHRASES:
        if phrase in lower:
            cleaned = re.sub_case_insensitive(cleaned, phrase, "requires human verification before retirement")
    return cleaned


def re_sub_case_insensitive(text: str, target: str, replacement: str) -> str:
    import re
    return re.sub(re.escape(target), replacement, text, flags=re.IGNORECASE)


def build_sanitized_finding_payload(analysis: AnalysisRecord, finding: Finding) -> Dict[str, Any]:
    """
    Construct a minimized, sanitized JSON payload for a single finding (FR-10).
    Never includes raw request bodies, headers, cookies, keys, or full files.
    """
    return {
        "finding_id": finding.id,
        "method": finding.method,
        "normalized_path": finding.path,
        "category": finding.category,
        "severity": finding.severity,
        "review_priority_score": finding.review_priority_score,
        "score_reasons": finding.score_reasons[:6],
        "sources_present": finding.sources_present,
        "sources_missing": finding.sources_missing,
        "sources_uploaded_in_analysis": analysis.summary.sources_supplied if analysis.summary else [],
        "request_count": finding.request_count,
        "first_seen": finding.first_seen,
        "last_seen": finding.last_seen,
        "status_code_counts": finding.status_code_counts,
        "log_window_start": analysis.log_start,
        "log_window_end": analysis.log_end,
        "observation_window_days": analysis.summary.observation_window_days if analysis.summary else None,
        "evidence": finding.evidence[:8],
        "limitations": finding.limitations[:6],
    }


def build_sanitized_analysis_context(analysis: AnalysisRecord, max_findings: int = 12) -> Dict[str, Any]:
    """
    Construct a bounded, sanitized analysis summary payload for grounded Q&A, summary, or plan generation.
    Truncates findings list with an explicit truncation note if total findings exceed max_findings.
    """
    total = len(analysis.findings)
    bounded_findings = analysis.findings[:max_findings]
    truncated = total > max_findings

    return {
        "analysis_id": analysis.id,
        "analysis_name": analysis.name,
        "log_window": {
            "start": analysis.log_start,
            "end": analysis.log_end,
            "days": analysis.summary.observation_window_days if analysis.summary else None,
        },
        "summary": analysis.summary.model_dump() if analysis.summary else {},
        "truncation_note": (
            f"Showing top {len(bounded_findings)} of {total} prioritized findings to respect context bounds."
            if truncated
            else f"All {total} findings included."
        ),
        "findings": [
            {
                "id": f.id,
                "method": f.method,
                "path": f.path,
                "category": f.category,
                "severity": f.severity,
                "review_priority_score": f.review_priority_score,
                "sources_present": f.sources_present,
                "sources_missing": f.sources_missing,
                "request_count": f.request_count,
                "evidence": f.evidence[:4],
            }
            for f in bounded_findings
        ],
    }


def _compute_cache_key(action: str, model: str, payload: Dict[str, Any]) -> str:
    canonical = json.dumps(
        {
            "v": PROMPT_VERSION,
            "action": action,
            "model": model,
            "payload": payload,
        },
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def generate_deterministic_finding_explanation(
    analysis: AnalysisRecord,
    finding: Finding,
    status_message: str = "Generated using deterministic rule templates (Gemini API not active).",
) -> AIExplanationRecord:
    """Deterministic fallback explanation for a finding when Gemini is unconfigured or unavailable."""
    window_days = analysis.summary.observation_window_days if analysis.summary else None
    window_str = f"{window_days:.1f}-day log window" if window_days is not None else "supplied log sample"

    if finding.category == "Documented but not implemented":
        summary = (
            f"{finding.method} {finding.path} is declared in the OpenAPI contract but was not found in the "
            f"supplied backend route inventory (Review Priority: {finding.review_priority_score}/100)."
        )
    elif finding.category == "Implemented but undocumented":
        summary = (
            f"{finding.method} {finding.path} exists in the backend route inventory but is missing from the "
            f"OpenAPI specification (Review Priority: {finding.review_priority_score}/100)."
        )
    elif finding.category == "Observed but undocumented":
        summary = (
            f"{finding.method} {finding.path} recorded {finding.request_count} request(s) in the {window_str} "
            f"but is undocumented in the OpenAPI specification (Review Priority: {finding.review_priority_score}/100)."
        )
    elif finding.category == "Implemented but not observed":
        summary = (
            f"{finding.method} {finding.path} is registered in the backend route inventory but had 0 matching "
            f"requests in the {window_str} (Review Priority: {finding.review_priority_score}/100)."
        )
    elif finding.category == "Documented but not observed":
        summary = (
            f"{finding.method} {finding.path} is documented in the OpenAPI specification but had 0 matching "
            f"requests in the {window_str} (Review Priority: {finding.review_priority_score}/100)."
        )
    else:
        summary = (
            f"Data-quality or metadata inconsistency detected for {finding.method} {finding.path} "
            f"(Review Priority: {finding.review_priority_score}/100)."
        )

    evidence_interp = list(finding.evidence) if finding.evidence else [
        f"Present in sources: {', '.join(finding.sources_present) or 'none'}.",
        f"Missing from sources: {', '.join(finding.sources_missing) or 'none'}.",
    ]
    checks = list(finding.recommended_checks) if finding.recommended_checks else [
        "Verify route registration and OpenAPI documentation with the owning engineering team.",
        "Confirm log coverage across all gateway entry points before any deprecation decision.",
    ]
    caveats = list(finding.limitations) if finding.limitations else [
        "Absence of traffic in a log sample never proves an endpoint is unused or safe to delete."
    ]

    return AIExplanationRecord(
        summary=summary,
        evidence_interpretation=evidence_interp[:8],
        recommended_checks=checks[:8],
        caveats=caveats[:6],
        provider="deterministic-fallback",
        model=None,
        is_fallback=True,
        cached=False,
        generated_at=_now_iso(),
        status_message=status_message,
    )


def generate_deterministic_investigation_plan(
    analysis: AnalysisRecord,
    status_message: str = "Generated using deterministic prioritization rules (Gemini API not active).",
) -> InvestigationPlanRecord:
    """Deterministic fallback investigation plan grouped by finding category."""
    high_contract = [f for f in analysis.findings if f.category == "Documented but not implemented"]
    undoc_active = [
        f for f in analysis.findings if f.category in ("Observed but undocumented", "Implemented but undocumented")
    ]
    unobserved = [
        f for f in analysis.findings if f.category in ("Implemented but not observed", "Documented but not observed")
    ]
    dq = [f for f in analysis.findings if f.category == "Data-quality issue"]

    steps: List[InvestigationPlanStep] = []
    order = 1

    if undoc_active:
        steps.append(
            InvestigationPlanStep(
                priority_order=order,
                title="Audit Undocumented & Shadow Endpoints Receiving Traffic",
                rationale=(
                    "Endpoints present in backend routes or observed in runtime traffic without OpenAPI documentation "
                    "pose immediate contract drift and security visibility risks."
                ),
                finding_ids=[f.id for f in undoc_active[:8]],
                verification_criteria=[
                    "Identify the router handler and owning team for each undocumented route.",
                    "Verify authentication, authorization, and rate-limiting middleware on these routes.",
                    "Document active legitimate routes in OpenAPI or schedule deprecation for legacy routes.",
                ],
            )
        )
        order += 1

    if high_contract:
        steps.append(
            InvestigationPlanStep(
                priority_order=order,
                title="Resolve Documented Endpoints Missing from Route Inventory",
                rationale=(
                    "Endpoints promised in the OpenAPI contract but absent from the backend route inventory can break "
                    "client SDKs and external integrations."
                ),
                finding_ids=[f.id for f in high_contract[:8]],
                verification_criteria=[
                    "Confirm whether these endpoints are served by another service/gateway or were removed in code.",
                    "Update the OpenAPI specification or restore the missing route handlers.",
                ],
            )
        )
        order += 1

    if unobserved:
        steps.append(
            InvestigationPlanStep(
                priority_order=order,
                title="Verify Unobserved Endpoints Before Retirement Consideration",
                rationale=(
                    "Endpoints absent from the uploaded log sample may be candidates for deprecation, or may serve "
                    "low-frequency batch, admin, or seasonal workflows (such as quarterly/annual exports)."
                ),
                finding_ids=[f.id for f in unobserved[:8]],
                verification_criteria=[
                    "Confirm log ingestion covers all environments, gateways, and internal callers over a sufficient window.",
                    "Check cron schedules, admin tooling, and seasonal business workflows.",
                    "Obtain owner sign-off and add deprecation headers before retiring any route.",
                ],
            )
        )
        order += 1

    if dq or not steps:
        steps.append(
            InvestigationPlanStep(
                priority_order=order,
                title="Clean Up Duplicate Route Registrations & Log Data-Quality Warnings",
                rationale="Resolving duplicate route definitions and malformed log records improves observability accuracy.",
                finding_ids=[f.id for f in dq[:8]],
                verification_criteria=[
                    "Remove duplicate route registrations across backend router modules.",
                    "Ensure timestamps follow ISO-8601 and sensitive tokens are redacted at the edge.",
                ],
            )
        )

    return InvestigationPlanRecord(
        overview=(
            f"Prioritized {len(steps)}-phase human verification plan across {len(analysis.findings)} findings "
            f"for analysis '{analysis.name}'. All steps require human review; no endpoints are automatically modified."
        ),
        steps=steps,
        general_caveats=[
            "Not observed in logs means absent from the uploaded sample, never guaranteed unused.",
            "Always verify multi-environment gateway logs, scheduled jobs, and partner integrations before deprecation.",
        ],
        provider="deterministic-fallback",
        model=None,
        is_fallback=True,
        cached=False,
        generated_at=_now_iso(),
        status_message=status_message,
    )


def generate_deterministic_chat_answer(
    analysis: AnalysisRecord,
    question: str,
    status_message: str = "Answered using deterministic evidence lookup (Gemini API not active).",
) -> ChatResponseRecord:
    """Grounded deterministic Q&A fallback over the current analysis findings."""
    q_lower = question.lower()
    top_findings = analysis.findings[:5]

    matched: List[Finding] = []
    for f in analysis.findings:
        if f.path.lower() in q_lower or f.id.lower() in q_lower or f.category.lower() in q_lower:
            matched.append(f)

    if not matched:
        if "undocumented" in q_lower or "shadow" in q_lower or "security" in q_lower:
            matched = [f for f in analysis.findings if "undocumented" in f.category.lower()]
        elif "not implemented" in q_lower or "missing" in q_lower or "broken" in q_lower:
            matched = [f for f in analysis.findings if f.category == "Documented but not implemented"]
        elif "unobserved" in q_lower or "quiet" in q_lower or "unused" in q_lower or "retire" in q_lower:
            matched = [f for f in analysis.findings if "not observed" in f.category.lower()]
        else:
            matched = top_findings

    selected = matched[:5] if matched else top_findings
    ref_ids = [f.id for f in selected]
    bullets = [
        f"{f.id} ({f.method} {f.path}) — {f.category} [Priority {f.review_priority_score}/100]"
        for f in selected
    ]

    window_note = analysis.summary.observation_window_note if analysis.summary else "Log window not specified."
    answer = (
        f"Based on the deterministic analysis of '{analysis.name}' ({len(analysis.findings)} total findings; {window_note}), "
        f"the highest-priority relevant findings to investigate are: "
        + ("; ".join(bullets) if bullets else "No matching findings found.")
        + ". Review the source presence indicators and recommended human checks for each finding before making lifecycle changes."
    )

    return ChatResponseRecord(
        question=question,
        answer=answer,
        referenced_finding_ids=ref_ids,
        supporting_evidence=[f.evidence[0] for f in selected if f.evidence][:5],
        caveats=[
            "Grounded strictly in uploaded analysis metadata.",
            "Absence from the uploaded log sample does not prove an endpoint is unused or safe to delete.",
        ],
        provider="deterministic-fallback",
        model=None,
        is_fallback=True,
        cached=False,
        generated_at=_now_iso(),
        status_message=status_message,
    )


def generate_deterministic_executive_summary(
    analysis: AnalysisRecord,
    status_message: str = "Generated using deterministic summary rules (Gemini API not active).",
) -> ExecutiveSummaryRecord:
    """Deterministic fallback executive summary of the analysis."""
    s = analysis.summary
    if not s:
        return ExecutiveSummaryRecord(
            headline=f"Analysis '{analysis.name}' has no summary data.",
            key_observations=["No endpoint summary available."],
            priority_focus_areas=["Verify input files and re-run analysis."],
            caveats=["Incomplete analysis state."],
            status_message=status_message,
            generated_at=_now_iso(),
        )

    top_3 = analysis.findings[:3]
    headline = (
        f"Compared {len(s.sources_supplied)} source(s) ({', '.join(s.sources_supplied)}) across "
        f"{s.total_unique_endpoints} unique endpoints and identified {s.total_findings} prioritized findings."
    )
    observations = [
        f"OpenAPI declared {s.openapi_endpoint_count} endpoints; Route inventory listed {s.routes_endpoint_count} routes; Logs captured {s.logs_endpoint_count} distinct endpoints ({s.total_log_requests} total requests).",
        s.observation_window_note,
    ]
    for cat, count in sorted(s.findings_by_category.items(), key=lambda x: -x[1]):
        observations.append(f"{cat}: {count} finding(s)")

    focus = [
        f"Investigate {f.id}: {f.method} {f.path} ({f.category}, Review Priority {f.review_priority_score}/100)"
        for f in top_3
    ] or ["No high-priority mismatches detected across supplied sources."]

    return ExecutiveSummaryRecord(
        headline=headline,
        key_observations=observations[:6],
        priority_focus_areas=focus[:6],
        caveats=[
            "Scores represent human review priority, not a probability that an endpoint is dead.",
            "Endpoints not observed in the uploaded log sample may still be used by scheduled, seasonal, or unlogged workflows.",
        ],
        provider="deterministic-fallback",
        model=None,
        is_fallback=True,
        cached=False,
        generated_at=_now_iso(),
        status_message=status_message,
    )


def _call_gemini_structured(
    prompt: str,
    schema_cls: Type[T],
) -> Tuple[Optional[T], Optional[str]]:
    """
    Invoke Google Gemini API with timeout, structured JSON schema validation, and rate-limit handling.
    Returns (validated_model_or_None, error_message_or_None).
    """
    settings = get_settings()
    if not settings.is_gemini_configured:
        return None, "Gemini API is not configured (set GEMINI_API_KEY in .env to enable live AI)."

    if not store.check_rate_limit("gemini_global", max_calls=20, window_seconds=60):
        return None, "Local free-tier rate limit reached (max 20 AI requests/min). Showing deterministic fallback."

    def _invoke() -> T:
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(timeout=settings.gemini_timeout_seconds * 1000),
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=schema_cls,
                temperature=0.1,
                max_output_tokens=settings.gemini_max_output_tokens,
            ),
        )
        raw_text = (response.text or "").strip()
        if not raw_text:
            raise ValueError("Empty response received from Gemini API.")
        return schema_cls.model_validate_json(raw_text)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_invoke)
            validated = future.result(timeout=settings.gemini_timeout_seconds + 2)
            return validated, None
    except concurrent.futures.TimeoutError:
        return None, f"Gemini API request timed out after {settings.gemini_timeout_seconds}s. Showing deterministic fallback."
    except Exception as exc:
        err_str = str(exc)
        err_lower = err_str.lower()
        if "429" in err_lower or "quota" in err_lower or "resource_exhausted" in err_lower or "rate" in err_lower:
            return (
                None,
                "Gemini API free-tier quota or rate limit reached (HTTP 429). Showing deterministic fallback.",
            )
        if "api_key_invalid" in err_lower or "401" in err_lower or "403" in err_lower or "invalid api key" in err_lower:
            return (
                None,
                "Gemini API key was rejected by Google AI Studio. Check GEMINI_API_KEY in .env. Showing deterministic fallback.",
            )
        if "404" in err_lower or "not found" in err_lower:
            return (
                None,
                f"Configured GEMINI_MODEL ('{settings.gemini_model}') was not found or unavailable. Showing deterministic fallback.",
            )
        return None, "Gemini API temporarily unavailable. Showing deterministic fallback."


def investigate_finding_with_ai(analysis: AnalysisRecord, finding: Finding) -> AIExplanationRecord:
    """
    Investigate a single finding with Gemini (FR-10), using Redis caching and deterministic fallback.
    """
    settings = get_settings()
    sanitized_payload = build_sanitized_finding_payload(analysis, finding)
    cache_key = _compute_cache_key("investigate_finding", settings.gemini_model, sanitized_payload)

    cached_data = store.get_cached_ai_response(cache_key)
    if cached_data:
        try:
            record = AIExplanationRecord.model_validate(cached_data)
            record.cached = True
            record.status_message = f"Loaded cached Gemini explanation ({record.model or settings.gemini_model})."
            return record
        except Exception:
            pass

    if not settings.is_gemini_configured:
        return generate_deterministic_finding_explanation(
            analysis,
            finding,
            status_message="Gemini API key not configured in .env — showing deterministic evidence analysis.",
        )

    prompt = (
        "Investigate the following sanitized API endpoint finding and explain the cross-source evidence, "
        "uncertainties, and safe human verification steps.\n\n"
        f"SANITIZED_FINDING_EVIDENCE_JSON:\n{json.dumps(sanitized_payload, indent=2)}"
    )

    validated, error_msg = _call_gemini_structured(prompt, AIExplanationSchema)
    if validated is None:
        return generate_deterministic_finding_explanation(
            analysis,
            finding,
            status_message=error_msg or "Gemini unavailable — showing deterministic fallback.",
        )

    record = AIExplanationRecord(
        summary=_sanitize_text_guardrail(validated.summary),
        evidence_interpretation=[_sanitize_text_guardrail(item) for item in validated.evidence_interpretation],
        recommended_checks=[_sanitize_text_guardrail(item) for item in validated.recommended_checks],
        caveats=[_sanitize_text_guardrail(item) for item in validated.caveats],
        provider="gemini",
        model=settings.gemini_model,
        is_fallback=False,
        cached=False,
        generated_at=_now_iso(),
        status_message=f"Generated by Google Gemini ({settings.gemini_model}) grounded in finding evidence.",
    )
    store.set_cached_ai_response(cache_key, record.model_dump())
    return record


def ask_analysis_chat(analysis: AnalysisRecord, question: str) -> ChatResponseRecord:
    """
    Answer a developer's natural-language question grounded strictly in the current analysis context.
    """
    settings = get_settings()
    clean_question, _ = redact_sensitive_text(question.strip())
    context_payload = build_sanitized_analysis_context(analysis, max_findings=12)
    cache_payload = {"question": clean_question.lower(), "context": context_payload}
    cache_key = _compute_cache_key("analysis_chat", settings.gemini_model, cache_payload)

    cached_data = store.get_cached_ai_response(cache_key)
    if cached_data:
        try:
            record = ChatResponseRecord.model_validate(cached_data)
            record.cached = True
            record.status_message = f"Loaded cached Gemini answer ({record.model or settings.gemini_model})."
            return record
        except Exception:
            pass

    if not settings.is_gemini_configured:
        return generate_deterministic_chat_answer(
            analysis,
            clean_question,
            status_message="Gemini API key not configured in .env — answered via deterministic evidence lookup.",
        )

    prompt = (
        "Answer the developer's question using ONLY the supplied analysis context JSON. "
        "Reference relevant finding IDs (e.g., FND-001) where applicable. "
        "Never claim an endpoint is safe to delete.\n\n"
        f"DEVELOPER_QUESTION: {clean_question}\n\n"
        f"SANITIZED_ANALYSIS_CONTEXT_JSON:\n{json.dumps(context_payload, indent=2)}"
    )

    validated, error_msg = _call_gemini_structured(prompt, ChatResponseSchema)
    if validated is None:
        return generate_deterministic_chat_answer(
            analysis,
            clean_question,
            status_message=error_msg or "Gemini unavailable — showing deterministic fallback answer.",
        )

    valid_ids = {f.id for f in analysis.findings}
    filtered_refs = [fid for fid in validated.referenced_finding_ids if fid in valid_ids]

    record = ChatResponseRecord(
        question=clean_question,
        answer=_sanitize_text_guardrail(validated.answer),
        referenced_finding_ids=filtered_refs,
        supporting_evidence=[_sanitize_text_guardrail(e) for e in validated.supporting_evidence],
        caveats=[_sanitize_text_guardrail(c) for c in validated.caveats],
        provider="gemini",
        model=settings.gemini_model,
        is_fallback=False,
        cached=False,
        generated_at=_now_iso(),
        status_message=f"Generated by Google Gemini ({settings.gemini_model}) grounded in analysis results.",
    )
    store.set_cached_ai_response(cache_key, record.model_dump())
    return record


def generate_investigation_plan_with_ai(analysis: AnalysisRecord) -> InvestigationPlanRecord:
    """
    Generate a prioritized, human-reviewable investigation plan across findings.
    """
    settings = get_settings()
    context_payload = build_sanitized_analysis_context(analysis, max_findings=15)
    cache_key = _compute_cache_key("investigation_plan", settings.gemini_model, context_payload)

    cached_data = store.get_cached_ai_response(cache_key)
    if cached_data:
        try:
            record = InvestigationPlanRecord.model_validate(cached_data)
            record.cached = True
            record.status_message = f"Loaded cached Gemini investigation plan ({record.model or settings.gemini_model})."
            return record
        except Exception:
            pass

    if not settings.is_gemini_configured:
        return generate_deterministic_investigation_plan(
            analysis,
            status_message="Gemini API key not configured in .env — generated deterministic verification plan.",
        )

    prompt = (
        "Create a prioritized, step-by-step human verification and remediation plan based ONLY on the "
        "supplied analysis findings. Include finding IDs and clear verification criteria for each step. "
        "Do NOT execute or propose automatic endpoint deletion.\n\n"
        f"SANITIZED_ANALYSIS_CONTEXT_JSON:\n{json.dumps(context_payload, indent=2)}"
    )

    validated, error_msg = _call_gemini_structured(prompt, InvestigationPlanSchema)
    if validated is None:
        return generate_deterministic_investigation_plan(
            analysis,
            status_message=error_msg or "Gemini unavailable — showing deterministic verification plan.",
        )

    valid_ids = {f.id for f in analysis.findings}
    sanitized_steps: List[InvestigationPlanStep] = []
    for idx, step in enumerate(validated.steps, start=1):
        sanitized_steps.append(
            InvestigationPlanStep(
                priority_order=idx,
                title=_sanitize_text_guardrail(step.title),
                rationale=_sanitize_text_guardrail(step.rationale),
                finding_ids=[fid for fid in step.finding_ids if fid in valid_ids],
                verification_criteria=[_sanitize_text_guardrail(c) for c in step.verification_criteria],
            )
        )

    record = InvestigationPlanRecord(
        overview=_sanitize_text_guardrail(validated.overview),
        steps=sanitized_steps,
        general_caveats=[_sanitize_text_guardrail(c) for c in validated.general_caveats],
        provider="gemini",
        model=settings.gemini_model,
        is_fallback=False,
        cached=False,
        generated_at=_now_iso(),
        status_message=f"Generated by Google Gemini ({settings.gemini_model}).",
    )
    store.set_cached_ai_response(cache_key, record.model_dump())
    return record


def generate_executive_summary_with_ai(analysis: AnalysisRecord) -> ExecutiveSummaryRecord:
    """
    Generate a concise executive summary of the analysis using bounded finding data.
    """
    settings = get_settings()
    context_payload = build_sanitized_analysis_context(analysis, max_findings=12)
    cache_key = _compute_cache_key("executive_summary", settings.gemini_model, context_payload)

    cached_data = store.get_cached_ai_response(cache_key)
    if cached_data:
        try:
            record = ExecutiveSummaryRecord.model_validate(cached_data)
            record.cached = True
            record.status_message = f"Loaded cached Gemini executive summary ({record.model or settings.gemini_model})."
            return record
        except Exception:
            pass

    if not settings.is_gemini_configured:
        return generate_deterministic_executive_summary(
            analysis,
            status_message="Gemini API key not configured in .env — showing deterministic executive summary.",
        )

    prompt = (
        "Produce a concise executive summary of this API lifecycle analysis using ONLY the supplied JSON data. "
        "Highlight key cross-source observations, priority areas for engineering review, and data caveats.\n\n"
        f"SANITIZED_ANALYSIS_CONTEXT_JSON:\n{json.dumps(context_payload, indent=2)}"
    )

    validated, error_msg = _call_gemini_structured(prompt, ExecutiveSummarySchema)
    if validated is None:
        return generate_deterministic_executive_summary(
            analysis,
            status_message=error_msg or "Gemini unavailable — showing deterministic executive summary.",
        )

    record = ExecutiveSummaryRecord(
        headline=_sanitize_text_guardrail(validated.headline),
        key_observations=[_sanitize_text_guardrail(o) for o in validated.key_observations],
        priority_focus_areas=[_sanitize_text_guardrail(p) for p in validated.priority_focus_areas],
        caveats=[_sanitize_text_guardrail(c) for c in validated.caveats],
        provider="gemini",
        model=settings.gemini_model,
        is_fallback=False,
        cached=False,
        generated_at=_now_iso(),
        status_message=f"Generated by Google Gemini ({settings.gemini_model}).",
    )
    store.set_cached_ai_response(cache_key, record.model_dump())
    return record

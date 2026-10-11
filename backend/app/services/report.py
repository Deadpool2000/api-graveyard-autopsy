import json
from datetime import datetime, timezone
from typing import Any, Dict, List

from app.schemas.models import AnalysisRecord


def generate_json_report(analysis: AnalysisRecord) -> str:
    """
    Export the analysis as a sanitized JSON report (FR-8).
    Excludes raw payloads and secrets; clearly labels AI-generated commentary when present.
    """
    report_obj: Dict[str, Any] = {
        "report_type": "API Graveyard Autopsy Report",
        "exported_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "analysis": {
            "id": analysis.id,
            "name": analysis.name,
            "is_demo": analysis.is_demo,
            "status": analysis.status,
            "created_at": analysis.created_at,
            "completed_at": analysis.completed_at,
            "log_observation_window": {
                "start": analysis.log_start,
                "end": analysis.log_end,
                "days": analysis.summary.observation_window_days if analysis.summary else None,
                "note": analysis.summary.observation_window_note if analysis.summary else "",
            },
            "sources": [s.model_dump() for s in analysis.source_metadata],
            "summary": analysis.summary.model_dump() if analysis.summary else {},
        },
        "global_caveats": [
            "'Not observed' in request logs means only that the endpoint was absent from the uploaded log sample. It does NOT prove that an endpoint is unused or safe to delete.",
            "Review-priority scores (0-100) are deterministic heuristics to prioritize human engineering review, not probabilities of dead code.",
            "AI commentary (when present) is an interpretation of supplied metadata and never overrides deterministic evidence.",
        ],
        "executive_summary_commentary": (
            {
                "notice": "AI-Assisted / Automated Commentary — Verify against deterministic evidence",
                **analysis.executive_summary.model_dump(),
            }
            if analysis.executive_summary
            else None
        ),
        "investigation_plan_commentary": (
            {
                "notice": "AI-Assisted / Automated Investigation Plan — Human review required before action",
                **analysis.investigation_plan.model_dump(),
            }
            if analysis.investigation_plan
            else None
        ),
        "findings": [
            {
                "id": f.id,
                "method": f.method,
                "path": f.path,
                "original_paths": f.original_paths,
                "category": f.category,
                "severity": f.severity,
                "review_priority_score": f.review_priority_score,
                "score_reasons": f.score_reasons,
                "sources_present": f.sources_present,
                "sources_missing": f.sources_missing,
                "request_count": f.request_count,
                "first_seen": f.first_seen,
                "last_seen": f.last_seen,
                "status_code_counts": f.status_code_counts,
                "deterministic_evidence": f.evidence,
                "limitations": f.limitations,
                "recommended_human_checks": f.recommended_checks,
                "ai_generated_commentary": (
                    {
                        "label": (
                            f"AI-Generated Commentary ({f.ai_explanation.provider}"
                            + (f" / {f.ai_explanation.model}" if f.ai_explanation.model else "")
                            + ")"
                        ),
                        **f.ai_explanation.model_dump(),
                    }
                    if f.ai_explanation
                    else None
                ),
            }
            for f in analysis.findings
        ],
    }
    return json.dumps(report_obj, indent=2)


def generate_markdown_report(analysis: AnalysisRecord) -> str:
    """
    Export a readable Markdown report (FR-8) with summary metrics, caveats, evidence,
    scores, and clearly labeled AI commentary when generated.
    """
    exported_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    s = analysis.summary
    lines: List[str] = [
        f"# API Graveyard Autopsy Report — {analysis.name}",
        "",
        f"- **Analysis ID:** `{analysis.id}`",
        f"- **Created At:** `{analysis.created_at}`",
        f"- **Completed At:** `{analysis.completed_at or 'N/A'}`",
        f"- **Exported At:** `{exported_at}`",
        f"- **Log Observation Window:** `{analysis.log_start or 'N/A'}` to `{analysis.log_end or 'N/A'}` "
        + (f"(`{s.observation_window_days:.1f} days`)" if s and s.observation_window_days is not None else "(Unknown/Not provided)"),
        "",
        "> **Important Interpretation Caveat:** \"Not observed\" means only that an endpoint was absent from the uploaded request log sample. It does **not** prove an endpoint is dead or safe to delete. Always complete human verification before deprecating or retiring any API route.",
        "",
        "## 1. Input Sources",
        "",
    ]

    if analysis.source_metadata:
        lines.append("| Source Type | Filename | Format | Size (Bytes) | Parsed Records |")
        lines.append("|---|---|---|---|---|")
        for src in analysis.source_metadata:
            lines.append(
                f"| `{src.source_type}` | `{src.filename}` | `{src.format}` | {src.size_bytes} | {src.record_count} |"
            )
    else:
        lines.append("_No source metadata recorded._")

    lines.append("")
    lines.append("## 2. Summary Metrics")
    lines.append("")
    if s:
        lines.extend(
            [
                f"- **Sources Supplied:** {', '.join(s.sources_supplied) or 'None'}",
                f"- **Sources Missing:** {', '.join(s.sources_missing) or 'None'}",
                f"- **OpenAPI Declared Endpoints:** {s.openapi_endpoint_count}",
                f"- **Route Inventory Endpoints:** {s.routes_endpoint_count}",
                f"- **Observed Log Endpoints:** {s.logs_endpoint_count} ({s.total_log_requests} total requests)",
                f"- **Total Unique Normalized Endpoints:** {s.total_unique_endpoints}",
                f"- **Total Findings Flagged:** {s.total_findings}",
                "",
                "### Findings by Category",
                "",
            ]
        )
        for cat, count in sorted(s.findings_by_category.items(), key=lambda x: -x[1]):
            lines.append(f"- **{cat}:** {count}")
    lines.append("")

    if analysis.executive_summary:
        es = analysis.executive_summary
        label = (
            f"Google Gemini (`{es.model}`)"
            if not es.is_fallback
            else "Deterministic Fallback Template"
        )
        lines.extend(
            [
                "## 3. Executive Summary (AI-Assisted Commentary)",
                "",
                f"> _Source: {label} — Generated at `{es.generated_at}`. Grounded in structured analysis metadata._",
                "",
                f"**{es.headline}**",
                "",
                "**Key Observations:**",
            ]
        )
        for obs in es.key_observations:
            lines.append(f"- {obs}")
        lines.append("")
        lines.append("**Priority Focus Areas:**")
        for p in es.priority_focus_areas:
            lines.append(f"- {p}")
        lines.append("")

    if analysis.investigation_plan:
        plan = analysis.investigation_plan
        label = (
            f"Google Gemini (`{plan.model}`)"
            if not plan.is_fallback
            else "Deterministic Prioritization Plan"
        )
        lines.extend(
            [
                "## 4. Prioritized Investigation Plan (AI-Assisted Commentary)",
                "",
                f"> _Source: {label} — Human verification required before taking any action._",
                "",
                plan.overview,
                "",
            ]
        )
        for step in plan.steps:
            refs = ", ".join(f"`{fid}`" for fid in step.finding_ids) if step.finding_ids else "General"
            lines.append(f"### Step {step.priority_order}: {step.title}")
            lines.append(f"- **Related Findings:** {refs}")
            lines.append(f"- **Rationale:** {step.rationale}")
            lines.append("- **Verification Criteria:**")
            for vc in step.verification_criteria:
                lines.append(f"  - [ ] {vc}")
            lines.append("")

    lines.append("## 5. Prioritized Findings & Source Evidence")
    lines.append("")

    if not analysis.findings:
        lines.append("_No findings detected for this analysis._")
    else:
        for f in analysis.findings:
            lines.extend(
                [
                    f"### [{f.id}] `{f.method} {f.path}` — {f.category}",
                    "",
                    f"- **Severity:** `{f.severity}`",
                    f"- **Review Priority Score:** `{f.review_priority_score}/100` _(Heuristic review priority, not probability of unused code)_",
                    f"- **Sources Present:** `{', '.join(f.sources_present) or 'None'}`",
                    f"- **Sources Missing:** `{', '.join(f.sources_missing) or 'None'}`",
                    f"- **Observed Requests:** `{f.request_count}`"
                    + (f" (First seen: `{f.first_seen}`, Last seen: `{f.last_seen}`)" if f.first_seen else ""),
                    "",
                    "#### Deterministic Score Factors",
                ]
            )
            for reason in f.score_reasons:
                lines.append(f"- {reason}")

            lines.append("")
            lines.append("#### Deterministic Source Evidence")
            for ev in f.evidence:
                lines.append(f"- {ev}")

            lines.append("")
            lines.append("#### Data Limitations & Caveats")
            for lim in f.limitations:
                lines.append(f"- {lim}")

            lines.append("")
            lines.append("#### Recommended Human Verification Checklist")
            for chk in f.recommended_checks:
                lines.append(f"- [ ] {chk}")

            if f.ai_explanation:
                ai = f.ai_explanation
                provider_label = (
                    f"Google Gemini (`{ai.model}`)"
                    if not ai.is_fallback
                    else "Deterministic Fallback Explanation"
                )
                lines.extend(
                    [
                        "",
                        f"#### AI-Assisted Investigation Commentary ({provider_label})",
                        "",
                        f"> _Note: AI-generated commentary based solely on structured finding metadata (`{ai.generated_at}`)._",
                        "",
                        f"**Summary:** {ai.summary}",
                        "",
                        "**Evidence Interpretation:**",
                    ]
                )
                for interp in ai.evidence_interpretation:
                    lines.append(f"- {interp}")
                lines.append("")
                lines.append("**AI Caveats:**")
                for cav in ai.caveats:
                    lines.append(f"- {cav}")

            lines.append("")
            lines.append("---")
            lines.append("")

    return "\n".join(lines)


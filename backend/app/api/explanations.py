from typing import Dict
from fastapi import APIRouter, HTTPException, status

from app.schemas.models import ChatRequest
from app.services.gemini_service import (
    ask_analysis_chat,
    generate_executive_summary_with_ai,
    generate_investigation_plan_with_ai,
    investigate_finding_with_ai,
)
from app.store import store

router = APIRouter(prefix="/api/v1/analyses", tags=["ai-investigation"])


@router.post("/{analysis_id}/findings/{finding_id}/investigate")
def investigate_finding_endpoint(analysis_id: str, finding_id: str) -> Dict[str, object]:
    """
    Request an evidence-grounded Gemini investigation for a single finding (FR-10).
    Never alters deterministic scores or categories; falls back gracefully when Gemini is unavailable.
    """
    analysis = store.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")

    target_finding = None
    for f in analysis.findings:
        if f.id.lower() == finding_id.strip().lower():
            target_finding = f
            break

    if target_finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Finding '{finding_id}' not found.")

    explanation = investigate_finding_with_ai(analysis, target_finding)

    # Persist AI explanation on the finding without altering category, severity, score, or evidence
    target_finding.ai_explanation = explanation
    target_finding.ai_provider = explanation.provider
    target_finding.ai_generated_at = explanation.generated_at
    store.save_analysis(analysis)

    return {
        "analysis_id": analysis.id,
        "finding_id": target_finding.id,
        "explanation": explanation.model_dump(),
        "finding": target_finding.model_dump(),
    }


@router.post("/{analysis_id}/summary")
def create_analysis_executive_summary(analysis_id: str) -> Dict[str, object]:
    """
    Request a concise Gemini executive summary over bounded finding data.
    """
    analysis = store.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")

    summary_record = generate_executive_summary_with_ai(analysis)
    analysis.executive_summary = summary_record
    store.save_analysis(analysis)

    return {
        "analysis_id": analysis.id,
        "executive_summary": summary_record.model_dump(),
    }


@router.post("/{analysis_id}/chat")
def ask_analysis_question(analysis_id: str, payload: ChatRequest) -> Dict[str, object]:
    """
    Answer a natural-language question grounded strictly in the selected analysis results.
    """
    analysis = store.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")

    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question cannot be empty.")

    chat_response = ask_analysis_chat(analysis, question)
    return {
        "analysis_id": analysis.id,
        "response": chat_response.model_dump(),
    }


@router.post("/{analysis_id}/investigation-plan")
def create_investigation_plan(analysis_id: str) -> Dict[str, object]:
    """
    Generate a prioritized, human-reviewable investigation plan across findings.
    Never executes cleanup actions.
    """
    analysis = store.get_analysis(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found.")

    plan_record = generate_investigation_plan_with_ai(analysis)
    analysis.investigation_plan = plan_record
    store.save_analysis(analysis)

    return {
        "analysis_id": analysis.id,
        "investigation_plan": plan_record.model_dump(),
    }


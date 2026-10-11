from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field


AnalysisStatus = Literal["queued", "processing", "completed", "failed"]
AnalysisStage = Literal[
    "queued",
    "parsing",
    "normalizing",
    "comparing",
    "scoring",
    "exporting",
    "completed",
    "failed",
]

FindingCategory = Literal[
    "Documented but not implemented",
    "Implemented but undocumented",
    "Observed but undocumented",
    "Implemented but not observed",
    "Documented but not observed",
    "Data-quality issue",
]

SeverityLevel = Literal["High", "Medium", "Review", "Informational"]


class SourceFileMetadata(BaseModel):
    source_type: Literal["openapi", "routes", "logs"]
    filename: str
    size_bytes: int
    format: str
    record_count: int = 0


class AnalysisSummary(BaseModel):
    sources_supplied: List[str] = Field(default_factory=list)
    sources_missing: List[str] = Field(default_factory=list)
    possible_comparisons: List[str] = Field(default_factory=list)
    openapi_endpoint_count: int = 0
    routes_endpoint_count: int = 0
    logs_endpoint_count: int = 0
    total_unique_endpoints: int = 0
    total_log_requests: int = 0
    total_findings: int = 0
    findings_by_category: Dict[str, int] = Field(default_factory=dict)
    findings_by_severity: Dict[str, int] = Field(default_factory=dict)
    observation_window_days: Optional[float] = None
    observation_window_note: str = ""


class LatencySummary(BaseModel):
    min_ms: float
    max_ms: float
    avg_ms: float


class EndpointObservation(BaseModel):
    method: str
    normalized_path: str
    original_paths: Dict[str, List[str]] = Field(default_factory=dict)
    sources_present: List[str] = Field(default_factory=list)
    request_count: int = 0
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    status_code_counts: Dict[str, int] = Field(default_factory=dict)
    latency_summary: Optional[LatencySummary] = None
    openapi_metadata: Optional[Dict[str, str]] = None
    route_metadata: List[Dict[str, str]] = Field(default_factory=list)
    data_quality_warnings: List[str] = Field(default_factory=list)


class AIExplanationSchema(BaseModel):
    """Strict Pydantic schema for Gemini investigation output (FR-10)."""

    summary: str = Field(..., min_length=5, max_length=2500)
    evidence_interpretation: List[str] = Field(..., min_length=1, max_length=12)
    recommended_checks: List[str] = Field(..., min_length=1, max_length=12)
    caveats: List[str] = Field(..., min_length=1, max_length=10)


class AIExplanationRecord(AIExplanationSchema):
    provider: str = "deterministic-fallback"
    model: Optional[str] = None
    is_fallback: bool = True
    cached: bool = False
    generated_at: str = ""
    status_message: str = ""


class Finding(BaseModel):
    id: str
    analysis_id: str
    method: str
    path: str
    original_paths: Dict[str, List[str]] = Field(default_factory=dict)
    category: FindingCategory
    severity: SeverityLevel
    review_priority_score: int = Field(..., ge=0, le=100)
    score_reasons: List[str] = Field(default_factory=list)
    sources_present: List[str] = Field(default_factory=list)
    sources_missing: List[str] = Field(default_factory=list)
    request_count: int = 0
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    status_code_counts: Dict[str, int] = Field(default_factory=dict)
    evidence: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    recommended_checks: List[str] = Field(default_factory=list)
    ai_explanation: Optional[AIExplanationRecord] = None
    ai_provider: Optional[str] = None
    ai_generated_at: Optional[str] = None


class ExecutiveSummarySchema(BaseModel):
    headline: str = Field(..., min_length=5, max_length=1000)
    key_observations: List[str] = Field(..., min_length=1, max_length=10)
    priority_focus_areas: List[str] = Field(..., min_length=1, max_length=10)
    caveats: List[str] = Field(..., min_length=1, max_length=10)


class ExecutiveSummaryRecord(ExecutiveSummarySchema):
    provider: str = "deterministic-fallback"
    model: Optional[str] = None
    is_fallback: bool = True
    cached: bool = False
    generated_at: str = ""
    status_message: str = ""


class InvestigationPlanStep(BaseModel):
    priority_order: int = Field(..., ge=1, le=20)
    title: str = Field(..., min_length=3, max_length=400)
    rationale: str = Field(..., min_length=5, max_length=1200)
    finding_ids: List[str] = Field(default_factory=list)
    verification_criteria: List[str] = Field(..., min_length=1, max_length=10)


class InvestigationPlanSchema(BaseModel):
    overview: str = Field(..., min_length=5, max_length=1600)
    steps: List[InvestigationPlanStep] = Field(..., min_length=1, max_length=12)
    general_caveats: List[str] = Field(..., min_length=1, max_length=10)


class InvestigationPlanRecord(InvestigationPlanSchema):
    provider: str = "deterministic-fallback"
    model: Optional[str] = None
    is_fallback: bool = True
    cached: bool = False
    generated_at: str = ""
    status_message: str = ""


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)


class ChatResponseSchema(BaseModel):
    answer: str = Field(..., min_length=5, max_length=3000)
    referenced_finding_ids: List[str] = Field(default_factory=list)
    supporting_evidence: List[str] = Field(default_factory=list)
    caveats: List[str] = Field(..., min_length=1, max_length=10)


class ChatResponseRecord(ChatResponseSchema):
    question: str = ""
    provider: str = "deterministic-fallback"
    model: Optional[str] = None
    is_fallback: bool = True
    cached: bool = False
    generated_at: str = ""
    status_message: str = ""


class SuggestedQuestionsSchema(BaseModel):
    questions: List[str] = Field(..., min_length=3, max_length=6)


class SuggestedQuestionsRecord(SuggestedQuestionsSchema):
    provider: str = "deterministic-fallback"
    model: Optional[str] = None
    is_fallback: bool = True
    cached: bool = False
    generated_at: str = ""
    status_message: str = ""


class AnalysisRecord(BaseModel):
    id: str
    name: str
    is_demo: bool = False
    status: AnalysisStatus
    stage: AnalysisStage
    progress_percent: int = 0
    created_at: str
    completed_at: Optional[str] = None
    source_metadata: List[SourceFileMetadata] = Field(default_factory=list)
    log_start: Optional[str] = None
    log_end: Optional[str] = None
    summary: Optional[AnalysisSummary] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    endpoints: List[EndpointObservation] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    executive_summary: Optional[ExecutiveSummaryRecord] = None
    investigation_plan: Optional[InvestigationPlanRecord] = None
    suggested_questions: Optional[SuggestedQuestionsRecord] = None


class AnalysisPublicResponse(BaseModel):
    id: str
    name: str
    is_demo: bool = False
    status: AnalysisStatus
    stage: AnalysisStage
    progress_percent: int = 0
    created_at: str
    completed_at: Optional[str] = None
    source_metadata: List[SourceFileMetadata] = Field(default_factory=list)
    log_start: Optional[str] = None
    log_end: Optional[str] = None
    summary: Optional[AnalysisSummary] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    executive_summary: Optional[ExecutiveSummaryRecord] = None
    investigation_plan: Optional[InvestigationPlanRecord] = None
    suggested_questions: Optional[SuggestedQuestionsRecord] = None
    ai_status: Dict[str, object] = Field(default_factory=dict)



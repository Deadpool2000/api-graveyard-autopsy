export type AnalysisStatus = "queued" | "processing" | "completed" | "failed";
export type AnalysisStage =
  | "queued"
  | "parsing"
  | "normalizing"
  | "comparing"
  | "scoring"
  | "exporting"
  | "completed"
  | "failed";

export type FindingCategory =
  | "Documented but not implemented"
  | "Implemented but undocumented"
  | "Observed but undocumented"
  | "Implemented but not observed"
  | "Documented but not observed"
  | "Data-quality issue";

export type SeverityLevel = "High" | "Medium" | "Review" | "Informational";

export interface SourceFileMetadata {
  source_type: "openapi" | "routes" | "logs";
  filename: string;
  size_bytes: number;
  format: string;
  record_count: number;
}

export interface AnalysisSummary {
  sources_supplied: string[];
  sources_missing: string[];
  possible_comparisons: string[];
  openapi_endpoint_count: number;
  routes_endpoint_count: number;
  logs_endpoint_count: number;
  total_unique_endpoints: number;
  total_log_requests: number;
  total_findings: number;
  findings_by_category: Record<string, number>;
  findings_by_severity: Record<string, number>;
  observation_window_days: number | null;
  observation_window_note: string;
}

export interface AIExplanationRecord {
  summary: string;
  evidence_interpretation: string[];
  recommended_checks: string[];
  caveats: string[];
  provider: string;
  model: string | null;
  is_fallback: boolean;
  cached: boolean;
  generated_at: string;
  status_message: string;
}

export interface Finding {
  id: string;
  analysis_id: string;
  method: string;
  path: string;
  original_paths: Record<string, string[]>;
  category: FindingCategory;
  severity: SeverityLevel;
  review_priority_score: number;
  score_reasons: string[];
  sources_present: string[];
  sources_missing: string[];
  request_count: number;
  first_seen: string | null;
  last_seen: string | null;
  status_code_counts: Record<string, number>;
  evidence: string[];
  limitations: string[];
  recommended_checks: string[];
  ai_explanation: AIExplanationRecord | null;
  ai_provider: string | null;
  ai_generated_at: string | null;
}

export interface ExecutiveSummaryRecord {
  headline: string;
  key_observations: string[];
  priority_focus_areas: string[];
  caveats: string[];
  provider: string;
  model: string | null;
  is_fallback: boolean;
  cached: boolean;
  generated_at: string;
  status_message: string;
}

export interface InvestigationPlanStep {
  priority_order: number;
  title: string;
  rationale: string;
  finding_ids: string[];
  verification_criteria: string[];
}

export interface InvestigationPlanRecord {
  overview: string;
  steps: InvestigationPlanStep[];
  general_caveats: string[];
  provider: string;
  model: string | null;
  is_fallback: boolean;
  cached: boolean;
  generated_at: string;
  status_message: string;
}

export interface ChatResponseRecord {
  question: string;
  answer: string;
  referenced_finding_ids: string[];
  supporting_evidence: string[];
  caveats: string[];
  provider: string;
  model: string | null;
  is_fallback: boolean;
  cached: boolean;
  generated_at: string;
  status_message: string;
}

export interface AIStatus {
  enabled: boolean;
  configured: boolean;
  provider: string;
  model: string | null;
  message?: string;
}

export interface AnalysisResponse {
  id: string;
  analysis_id: string;
  name: string;
  is_demo: boolean;
  status: AnalysisStatus;
  stage: AnalysisStage;
  progress_percent: number;
  created_at: string;
  completed_at: string | null;
  source_metadata: SourceFileMetadata[];
  log_start: string | null;
  log_end: string | null;
  summary: AnalysisSummary | null;
  error_code: string | null;
  error_message: string | null;
  executive_summary: ExecutiveSummaryRecord | null;
  investigation_plan: InvestigationPlanRecord | null;
  ai_status: AIStatus;
}


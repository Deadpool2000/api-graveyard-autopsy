import {
  AIExplanationRecord,
  AnalysisResponse,
  ChatResponseRecord,
  ExecutiveSummaryRecord,
  Finding,
  InvestigationPlanRecord,
} from "./types";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMsg = `Request failed with HTTP ${res.status}`;
    try {
      const errData = await res.json();
      if (errData.detail) {
        errorMsg =
          typeof errData.detail === "string"
            ? errData.detail
            : JSON.stringify(errData.detail);
      }
    } catch {
      // Fallback to status text
    }
    throw new Error(errorMsg);
  }
  return res.json() as Promise<T>;
}

export async function fetchServiceStatus(): Promise<{
  status: string;
  max_upload_size_mb: number;
  redis_connected: boolean;
  ai: {
    enabled: boolean;
    configured: boolean;
    provider: string;
    model: string | null;
  };
}> {
  const res = await fetch("/api/v1/status", { cache: "no-store" });
  return handleResponse(res);
}

export async function startDemoAnalysis(): Promise<AnalysisResponse> {
  const res = await fetch("/api/v1/analyses/demo", {
    method: "POST",
  });
  return handleResponse<AnalysisResponse>(res);
}

export async function createCustomAnalysis(formData: FormData): Promise<AnalysisResponse> {
  const res = await fetch("/api/v1/analyses", {
    method: "POST",
    body: formData,
  });
  return handleResponse<AnalysisResponse>(res);
}

export async function fetchAnalysis(analysisId: string): Promise<AnalysisResponse> {
  const res = await fetch(`/api/v1/analyses/${encodeURIComponent(analysisId)}`, {
    cache: "no-store",
  });
  return handleResponse<AnalysisResponse>(res);
}

export async function fetchFindings(
  analysisId: string,
  params?: {
    category?: string;
    method?: string;
    search?: string;
    min_score?: number;
    max_score?: number;
  }
): Promise<{
  analysis_id: string;
  total_count: number;
  filtered_count: number;
  findings: Finding[];
}> {
  const query = new URLSearchParams();
  if (params?.category && params.category !== "all") {
    query.set("category", params.category);
  }
  if (params?.method && params.method !== "all") {
    query.set("method", params.method);
  }
  if (params?.search) {
    query.set("search", params.search);
  }
  if (params?.min_score !== undefined) {
    query.set("min_score", String(params.min_score));
  }
  if (params?.max_score !== undefined) {
    query.set("max_score", String(params.max_score));
  }
  const qs = query.toString() ? `?${query.toString()}` : "";
  const res = await fetch(
    `/api/v1/analyses/${encodeURIComponent(analysisId)}/findings${qs}`,
    { cache: "no-store" }
  );
  return handleResponse(res);
}

export async function investigateFinding(
  analysisId: string,
  findingId: string
): Promise<{
  analysis_id: string;
  finding_id: string;
  explanation: AIExplanationRecord;
  finding: Finding;
}> {
  const res = await fetch(
    `/api/v1/analyses/${encodeURIComponent(analysisId)}/findings/${encodeURIComponent(
      findingId
    )}/investigate`,
    { method: "POST" }
  );
  return handleResponse(res);
}

export async function generateExecutiveSummary(
  analysisId: string
): Promise<{
  analysis_id: string;
  executive_summary: ExecutiveSummaryRecord;
}> {
  const res = await fetch(
    `/api/v1/analyses/${encodeURIComponent(analysisId)}/summary`,
    { method: "POST" }
  );
  return handleResponse(res);
}

export async function generateInvestigationPlan(
  analysisId: string
): Promise<{
  analysis_id: string;
  investigation_plan: InvestigationPlanRecord;
}> {
  const res = await fetch(
    `/api/v1/analyses/${encodeURIComponent(analysisId)}/investigation-plan`,
    { method: "POST" }
  );
  return handleResponse(res);
}

export async function askAnalysisQuestion(
  analysisId: string,
  question: string
): Promise<{
  analysis_id: string;
  response: ChatResponseRecord;
}> {
  const res = await fetch(
    `/api/v1/analyses/${encodeURIComponent(analysisId)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }
  );
  return handleResponse(res);
}

export function getReportDownloadUrl(
  analysisId: string,
  format: "markdown" | "json"
): string {
  return `/api/v1/analyses/${encodeURIComponent(analysisId)}/report?format=${format}`;
}


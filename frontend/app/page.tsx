"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Database,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Filter,
  HelpCircle,
  Info,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  askAnalysisQuestion,
  createCustomAnalysis,
  fetchAnalysis,
  fetchFindings,
  fetchServiceStatus,
  generateExecutiveSummary,
  generateInvestigationPlan,
  getReportDownloadUrl,
  investigateFinding,
  startDemoAnalysis,
} from "@/lib/api";
import {
  AnalysisResponse,
  ChatResponseRecord,
  ExecutiveSummaryRecord,
  Finding,
  InvestigationPlanRecord,
} from "@/lib/types";

const CATEGORIES = [
  "all",
  "Documented but not implemented",
  "Implemented but undocumented",
  "Observed but undocumented",
  "Implemented but not observed",
  "Documented but not observed",
  "Data-quality issue",
];

const HTTP_METHODS = ["all", "GET", "POST", "PUT", "PATCH", "DELETE"];

const PRESET_QUESTIONS = [
  "Which findings should I investigate first, and why?",
  "Which undocumented endpoints are actively receiving traffic?",
  "Why aren't unobserved endpoints automatically safe to delete?",
];

function getMethodBadgeColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "POST":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "PUT":
    case "PATCH":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "DELETE":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  }
}

function getSeverityBadgeColor(severity: string): string {
  switch (severity) {
    case "High":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "Medium":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "Review":
      return "bg-indigo-500/15 text-indigo-300 border-indigo-500/30";
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  }
}

function getScoreBarColor(score: number): string {
  if (score >= 70) return "bg-rose-500";
  if (score >= 45) return "bg-amber-500";
  return "bg-indigo-500";
}

export default function AutopsyDashboard() {
  // Service & AI configuration state
  const [aiStatus, setAiStatus] = useState<{
    enabled: boolean;
    configured: boolean;
    provider: string;
    model: string | null;
  } | null>(null);
  const [redisConnected, setRedisConnected] = useState<boolean>(false);

  // Active analysis state
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [showUploadPanel, setShowUploadPanel] = useState<boolean>(true);

  // Upload form state
  const [analysisName, setAnalysisName] = useState<string>("");
  const [openapiFile, setOpenapiFile] = useState<File | null>(null);
  const [routesFile, setRoutesFile] = useState<File | null>(null);
  const [logsFile, setLogsFile] = useState<File | null>(null);

  // Loading & error states
  const [isStartingAnalysis, setIsStartingAnalysis] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Filter states
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedMethod, setSelectedMethod] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minScore, setMinScore] = useState<number>(0);

  // Checklist interactive state (keyed by findingId -> stepIndex)
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  // AI action states
  const [isInvestigatingFinding, setIsInvestigatingFinding] = useState<boolean>(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false);
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummaryRecord | null>(null);
  const [investigationPlan, setInvestigationPlan] = useState<InvestigationPlanRecord | null>(null);

  // Grounded chat state
  const [chatQuestion, setChatQuestion] = useState<string>("");
  const [isAskingChat, setIsAskingChat] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<ChatResponseRecord[]>([]);

  // Initial service status check
  useEffect(() => {
    fetchServiceStatus()
      .then((data) => {
        setAiStatus(data.ai);
        setRedisConnected(data.redis_connected);
      })
      .catch(() => {
        // Non-blocking on initial load
      });
  }, []);

  // Poll analysis job status if queued or processing
  useEffect(() => {
    if (!analysis) return;
    if (analysis.status !== "queued" && analysis.status !== "processing") {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const updated = await fetchAnalysis(analysis.id);
        setAnalysis(updated);
        if (updated.ai_status) {
          setAiStatus({
            enabled: Boolean(updated.ai_status.enabled),
            configured: Boolean(updated.ai_status.configured),
            provider: String(updated.ai_status.provider || ""),
            model: updated.ai_status.model ? String(updated.ai_status.model) : null,
          });
        }
        if (updated.status === "completed") {
          const fRes = await fetchFindings(updated.id);
          setFindings(fRes.findings);
          if (fRes.findings.length > 0 && !selectedFindingId) {
            setSelectedFindingId(fRes.findings[0].id);
          }
          setShowUploadPanel(false);
        } else if (updated.status === "failed") {
          setErrorBanner(updated.error_message || "Analysis job failed.");
        }
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : "Error polling analysis status.");
      }
    }, 800);

    return () => clearInterval(timer);
  }, [analysis, selectedFindingId]);

  const handleLoadDemo = async () => {
    setErrorBanner(null);
    setIsStartingAnalysis(true);
    setExecutiveSummary(null);
    setInvestigationPlan(null);
    setChatHistory([]);
    try {
      const demoAnalysis = await startDemoAnalysis();
      setAnalysis(demoAnalysis);
      if (demoAnalysis.ai_status) {
        setAiStatus({
          enabled: Boolean(demoAnalysis.ai_status.enabled),
          configured: Boolean(demoAnalysis.ai_status.configured),
          provider: String(demoAnalysis.ai_status.provider || ""),
          model: demoAnalysis.ai_status.model ? String(demoAnalysis.ai_status.model) : null,
        });
      }
      if (demoAnalysis.status === "completed") {
        const fRes = await fetchFindings(demoAnalysis.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        setShowUploadPanel(false);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to load demo dataset.");
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);

    if (!openapiFile && !routesFile && !logsFile) {
      setErrorBanner("Please upload at least one source file (OpenAPI spec, route inventory, or request logs).");
      return;
    }

    setIsStartingAnalysis(true);
    setExecutiveSummary(null);
    setInvestigationPlan(null);
    setChatHistory([]);
    try {
      const formData = new FormData();
      if (openapiFile) formData.append("openapi_file", openapiFile);
      if (routesFile) formData.append("routes_file", routesFile);
      if (logsFile) formData.append("logs_file", logsFile);
      if (analysisName.trim()) formData.append("analysis_name", analysisName.trim());

      const created = await createCustomAnalysis(formData);
      setAnalysis(created);
      if (created.status === "completed") {
        const fRes = await fetchFindings(created.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        setShowUploadPanel(false);
      } else if (created.status === "failed") {
        setErrorBanner(created.error_message || "Analysis validation failed.");
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to start custom analysis.");
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  // Filtered findings client-side for instant responsiveness
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (selectedCategory !== "all" && f.category !== selectedCategory) {
        return false;
      }
      if (selectedMethod !== "all" && f.method.toUpperCase() !== selectedMethod.toUpperCase()) {
        return false;
      }
      if (f.review_priority_score < minScore) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${f.id} ${f.method} ${f.path} ${f.category} ${f.evidence.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [findings, selectedCategory, selectedMethod, minScore, searchQuery]);

  const selectedFinding = useMemo(() => {
    if (!selectedFindingId) return filteredFindings[0] || null;
    return (
      findings.find((f) => f.id === selectedFindingId) ||
      filteredFindings[0] ||
      null
    );
  }, [findings, filteredFindings, selectedFindingId]);

  const handleInvestigateFinding = async (finding: Finding) => {
    if (!analysis) return;
    setIsInvestigatingFinding(true);
    setErrorBanner(null);
    try {
      const res = await investigateFinding(analysis.id, finding.id);
      setFindings((prev) =>
        prev.map((item) => (item.id === finding.id ? res.finding : item))
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to run AI investigation."
      );
    } finally {
      setIsInvestigatingFinding(false);
    }
  };

  const handleGenerateExecutiveSummary = async () => {
    if (!analysis) return;
    setIsGeneratingSummary(true);
    setErrorBanner(null);
    try {
      const res = await generateExecutiveSummary(analysis.id);
      setExecutiveSummary(res.executive_summary);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to generate executive summary."
      );
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!analysis) return;
    setIsGeneratingPlan(true);
    setErrorBanner(null);
    try {
      const res = await generateInvestigationPlan(analysis.id);
      setInvestigationPlan(res.investigation_plan);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to generate investigation plan."
      );
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleAskQuestion = async (questionText?: string) => {
    if (!analysis) return;
    const q = (questionText ?? chatQuestion).trim();
    if (!q) return;
    setIsAskingChat(true);
    setErrorBanner(null);
    try {
      const res = await askAnalysisQuestion(analysis.id, q);
      setChatHistory((prev) => [res.response, ...prev]);
      if (!questionText) {
        setChatQuestion("");
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to answer question."
      );
    } finally {
      setIsAskingChat(false);
    }
  };

  const toggleChecklistStep = (findingId: string, idx: number) => {
    const key = `${findingId}:${idx}`;
    setCheckedSteps((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  API Graveyard Autopsy
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  v1.2
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Find API endpoints that may be ready for retirement—with evidence, not guesses.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* AI Status Indicator (Never displays key) */}
            <div
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ${
                aiStatus?.configured
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
              }`}
              title={
                aiStatus?.configured
                  ? `Google Gemini active (${aiStatus.model})`
                  : "Gemini API key not configured in .env — deterministic fallback active"
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {aiStatus?.configured
                  ? `Gemini AI Ready (${aiStatus.model})`
                  : "AI Fallback Mode (Add Key in .env)"}
              </span>
            </div>

            {/* Redis Status Badge */}
            <div
              className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
                redisConnected
                  ? "bg-slate-800/80 border-slate-700 text-slate-300"
                  : "bg-slate-900 border-slate-800 text-slate-400"
              }`}
            >
              <Database className="h-3.5 w-3.5 text-indigo-400" />
              <span>{redisConnected ? "Redis Cache & Queue Active" : "In-Memory Store"}</span>
            </div>

            {/* Action Buttons */}
            <button
              onClick={handleLoadDemo}
              disabled={isStartingAnalysis}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-50"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Try Demo Dataset
            </button>

            {analysis && (
              <button
                onClick={() => setShowUploadPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              >
                <Upload className="h-3.5 w-3.5" />
                {showUploadPanel ? "Hide Upload Panel" : "New Analysis"}
              </button>
            )}

            {analysis?.status === "completed" && (
              <div className="flex items-center gap-1.5">
                <a
                  href={getReportDownloadUrl(analysis.id, "markdown")}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  Export .MD
                </a>
                <a
                  href={getReportDownloadUrl(analysis.id, "json")}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                >
                  <Download className="h-3.5 w-3.5 text-sky-400" />
                  Export .JSON
                </a>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Error Banner */}
        {errorBanner && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-sm text-rose-200">
                <p className="font-semibold text-rose-100">Action Error</p>
                <p className="mt-0.5">{errorBanner}</p>
              </div>
            </div>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-xs text-rose-300 hover:text-white px-2 py-1 rounded"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Screen A: Landing & Upload Panel */}
        {(!analysis || showUploadPanel) && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-5 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-medium">
                  <Layers className="h-3.5 w-3.5" />
                  Three-Source Evidence Triangulation
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  Compare Contract, Code Routes, and Traffic Logs
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Teams rarely have a complete view of their API surface.{" "}
                  <strong className="text-white">API Graveyard Autopsy</strong>{" "}
                  normalizes OpenAPI specifications, backend route inventories, and
                  observed request logs to surface undocumented endpoints, missing
                  implementations, and quiet routes needing review—without ever
                  guessing that an endpoint is &ldquo;safe to delete.&rdquo;
                </p>

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleLoadDemo}
                    disabled={isStartingAnalysis}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
                  >
                    {isStartingAnalysis ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Try Built-in Demo Dataset
                  </button>
                  <span className="text-xs text-slate-400">
                    Loads synthetic OpenAPI 3.0 + FastAPI routes + 14-day request logs
                  </span>
                </div>

                <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3.5 text-xs text-slate-400 space-y-1.5">
                  <div className="flex items-center gap-2 text-slate-200 font-medium">
                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                    Privacy & Evidence Guardrails
                  </div>
                  <p>
                    Uploaded files are parsed strictly as data (max 5 MB per file) and
                    never executed. Sensitive query tokens are automatically redacted.
                    When you invoke AI features, only minimized structured finding
                    metadata is sent to Google Gemini.
                  </p>
                </div>
              </div>

              {/* Custom Upload Form */}
              <form
                onSubmit={handleCustomSubmit}
                className="lg:col-span-7 rounded-xl border border-slate-800 bg-slate-950/60 p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Upload className="h-4 w-4 text-indigo-400" />
                    Run Custom Analysis
                  </h3>
                  <span className="text-xs text-slate-400">Max 5 MB per file</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Analysis Name (optional)
                  </label>
                  <input
                    type="text"
                    value={analysisName}
                    onChange={(e) => setAnalysisName(e.target.value)}
                    placeholder="e.g., Core Billing API Q4 Audit"
                    className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* OpenAPI Upload */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                        <FileCode className="h-4 w-4" />
                        1. OpenAPI Spec
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        OpenAPI 3.x (.json, .yaml, .yml) declared contract.
                      </p>
                    </div>
                    <div className="mt-3">
                      <input
                        type="file"
                        accept=".json,.yaml,.yml"
                        onChange={(e) => setOpenapiFile(e.target.files?.[0] || null)}
                        className="block w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-indigo-500/20 file:text-indigo-300 hover:file:bg-indigo-500/30 cursor-pointer"
                      />
                      {openapiFile && (
                        <p className="text-[11px] text-emerald-400 mt-1 truncate">
                          Selected: {openapiFile.name}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Route Inventory Upload */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                        <Code2 className="h-4 w-4" />
                        2. Route Inventory
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        CSV or JSON (`method, path, framework, source_file`).
                      </p>
                    </div>
                    <div className="mt-3">
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={(e) => setRoutesFile(e.target.files?.[0] || null)}
                        className="block w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-emerald-500/20 file:text-emerald-300 hover:file:bg-emerald-500/30 cursor-pointer"
                      />
                      {routesFile && (
                        <p className="text-[11px] text-emerald-400 mt-1 truncate">
                          Selected: {routesFile.name}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Request Logs Upload */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                        <FileSpreadsheet className="h-4 w-4" />
                        3. Request Logs
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        CSV or JSON (`timestamp, method, path, status_code`).
                      </p>
                    </div>
                    <div className="mt-3">
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={(e) => setLogsFile(e.target.files?.[0] || null)}
                        className="block w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-amber-500/20 file:text-amber-300 hover:file:bg-amber-500/30 cursor-pointer"
                      />
                      {logsFile && (
                        <p className="text-[11px] text-emerald-400 mt-1 truncate">
                          Selected: {logsFile.name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-400">
                    Supports partial analysis if one source is omitted.
                  </span>
                  <button
                    type="submit"
                    disabled={isStartingAnalysis}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-white text-slate-900 transition disabled:opacity-50"
                  >
                    {isStartingAnalysis ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Start Autopsy Analysis
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {/* Screen B: Analysis Progress Indicator */}
        {analysis &&
          (analysis.status === "queued" || analysis.status === "processing") && (
            <section className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" />
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Running Analysis: {analysis.name}
                    </h3>
                    <p className="text-xs text-indigo-300 capitalize">
                      Current Stage: {analysis.stage}...
                    </p>
                  </div>
                </div>
                <span className="text-sm font-bold text-indigo-300">
                  {analysis.progress_percent}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${analysis.progress_percent}%` }}
                />
              </div>
            </section>
          )}

        {/* Screen C & D: Completed Results Dashboard */}
        {analysis && analysis.status === "completed" && analysis.summary && (
          <>
            {/* Guardrail Caveat & Missing Source Banner */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Evidence Guardrail:</strong> &ldquo;Not observed&rdquo;
                  means only that an endpoint was absent from the uploaded request
                  log sample. It does <strong>not</strong> prove an endpoint is
                  unused or safe to delete.
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-amber-300">
                <Clock className="h-3.5 w-3.5" />
                <span>{analysis.summary.observation_window_note}</span>
              </div>
            </div>

            {analysis.summary.sources_missing.length > 0 && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-200 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-sky-400 shrink-0" />
                  <span>
                    <strong>Partial Source Analysis:</strong> Missing sources:{" "}
                    <code className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300">
                      {analysis.summary.sources_missing.join(", ")}
                    </code>
                    . Active comparisons:{" "}
                    {analysis.summary.possible_comparisons.join(" • ") ||
                      "Single-source validation only"}
                    .
                  </span>
                </div>
              </div>
            )}

            {/* Summary Metric Cards */}
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>OpenAPI Contract</span>
                  <FileCode className="h-4 w-4 text-indigo-400" />
                </div>
                <p className="text-2xl font-bold text-white mt-2">
                  {analysis.summary.openapi_endpoint_count}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Declared endpoints
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Route Inventory</span>
                  <Code2 className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-2xl font-bold text-white mt-2">
                  {analysis.summary.routes_endpoint_count}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Implemented backend routes
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Observed Traffic</span>
                  <Activity className="h-4 w-4 text-amber-400" />
                </div>
                <p className="text-2xl font-bold text-white mt-2">
                  {analysis.summary.logs_endpoint_count}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Active routes ({analysis.summary.total_log_requests} requests)
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Normalized Surface</span>
                  <Layers className="h-4 w-4 text-sky-400" />
                </div>
                <p className="text-2xl font-bold text-white mt-2">
                  {analysis.summary.total_unique_endpoints}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Total unique endpoints
                </p>
              </div>

              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 col-span-2 sm:col-span-1">
                <div className="flex items-center justify-between text-xs text-indigo-300">
                  <span>Flagged Findings</span>
                  <ShieldAlert className="h-4 w-4 text-rose-400" />
                </div>
                <p className="text-2xl font-bold text-white mt-2">
                  {analysis.summary.total_findings}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Object.entries(analysis.summary.findings_by_severity).map(
                    ([sev, cnt]) => (
                      <span
                        key={sev}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300"
                      >
                        {sev}: {cnt}
                      </span>
                    )
                  )}
                </div>
              </div>
            </section>

            {/* AI Executive Summary & Prioritized Investigation Plan Bar */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Bot className="h-5 w-5 text-indigo-400" />
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      AI-Assisted Analysis Overview & Verification Planner
                    </h3>
                    <p className="text-xs text-slate-400">
                      User-triggered synthesis grounded strictly in deterministic
                      findings. Cached in Redis for free-tier efficiency.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleGenerateExecutiveSummary}
                    disabled={isGeneratingSummary}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition disabled:opacity-50"
                  >
                    {isGeneratingSummary ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {executiveSummary
                      ? "Refresh Executive Summary"
                      : "Generate Executive Summary"}
                  </button>

                  <button
                    onClick={handleGeneratePlan}
                    disabled={isGeneratingPlan}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition disabled:opacity-50"
                  >
                    {isGeneratingPlan ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ListChecks className="h-3.5 w-3.5" />
                    )}
                    {investigationPlan
                      ? "Refresh Investigation Plan"
                      : "Generate Investigation Plan"}
                  </button>
                </div>
              </div>

              {/* Rendered Executive Summary */}
              {executiveSummary && (
                <div className="rounded-xl border border-indigo-500/30 bg-slate-950/80 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
                        Executive Summary
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          executiveSummary.is_fallback
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        }`}
                      >
                        {executiveSummary.is_fallback
                          ? "Deterministic Fallback"
                          : `Google Gemini (${executiveSummary.model})`}
                      </span>
                      {executiveSummary.cached && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-300">
                          Redis Cached
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {executiveSummary.status_message}
                    </span>
                  </div>

                  <p className="text-sm font-medium text-white">
                    {executiveSummary.headline}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 mb-1.5">
                        Key Cross-Source Observations
                      </h4>
                      <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside">
                        {executiveSummary.key_observations.map((obs, idx) => (
                          <li key={idx}>{obs}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 mb-1.5">
                        Priority Review Focus
                      </h4>
                      <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside">
                        {executiveSummary.priority_focus_areas.map((fa, idx) => (
                          <li key={idx}>{fa}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Rendered Investigation Plan */}
              {investigationPlan && (
                <div className="rounded-xl border border-emerald-500/30 bg-slate-950/80 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                        Prioritized Human Verification Plan
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          investigationPlan.is_fallback
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        }`}
                      >
                        {investigationPlan.is_fallback
                          ? "Deterministic Plan"
                          : `Google Gemini (${investigationPlan.model})`}
                      </span>
                      {investigationPlan.cached && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-300">
                          Redis Cached
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {investigationPlan.status_message}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300">
                    {investigationPlan.overview}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {investigationPlan.steps.map((step) => (
                      <div
                        key={step.priority_order}
                        className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-emerald-300">
                            Phase {step.priority_order}: {step.title}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{step.rationale}</p>
                        {step.finding_ids.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {step.finding_ids.map((fid) => (
                              <button
                                key={fid}
                                onClick={() => setSelectedFindingId(fid)}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition"
                              >
                                {fid}
                              </button>
                            ))}
                          </div>
                        )}
                        <ul className="space-y-1 text-[11px] text-slate-300 list-disc list-inside pt-1">
                          {step.verification_criteria.map((vc, i) => (
                            <li key={i}>{vc}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Filter & Search Bar */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <div className="relative min-w-[240px] flex-1 max-w-md">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by path (/api/v1/users), ID (FND-001), or evidence..."
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === "all" ? "All Finding Categories" : cat}
                      </option>
                    ))}
                  </select>

                  <select
                    value={selectedMethod}
                    onChange={(e) => setSelectedMethod(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {HTTP_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m === "all" ? "All Methods" : m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span>Min Review Priority:</span>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={5}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    className="w-24 accent-indigo-500 cursor-pointer"
                  />
                  <span className="font-mono text-indigo-300 w-7">
                    {minScore}
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-400">
                Showing{" "}
                <strong className="text-white">{filteredFindings.length}</strong>{" "}
                of {findings.length} findings
              </div>
            </section>

            {/* Main Split View: Findings List (Left) & Finding Detail Inspector (Right) */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Findings Table */}
              <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-lg">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    Prioritized Findings Queue
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Click any row to inspect evidence & run AI investigation
                  </span>
                </div>

                {filteredFindings.length === 0 ? (
                  <div className="p-12 text-center space-y-2">
                    <HelpCircle className="h-8 w-8 text-slate-500 mx-auto" />
                    <p className="text-sm font-medium text-slate-300">
                      No findings match your current filter criteria.
                    </p>
                    <button
                      onClick={() => {
                        setSelectedCategory("all");
                        setSelectedMethod("all");
                        setSearchQuery("");
                        setMinScore(0);
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                    >
                      Reset all filters
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/70 max-h-[760px] overflow-y-auto">
                    {filteredFindings.map((f) => {
                      const isSelected = selectedFinding?.id === f.id;
                      return (
                        <div
                          key={f.id}
                          onClick={() => setSelectedFindingId(f.id)}
                          className={`p-4 cursor-pointer transition flex items-center justify-between gap-4 ${
                            isSelected
                              ? "bg-indigo-600/15 border-l-4 border-l-indigo-500"
                              : "hover:bg-slate-800/50"
                          }`}
                        >
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-mono text-slate-400">
                                {f.id}
                              </span>
                              <span
                                className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${getMethodBadgeColor(
                                  f.method
                                )}`}
                              >
                                {f.method}
                              </span>
                              <span className="text-sm font-mono font-medium text-white truncate">
                                {f.path}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${getSeverityBadgeColor(
                                  f.severity
                                )}`}
                              >
                                {f.severity}: {f.category}
                              </span>

                              {/* Source Presence Indicators */}
                              <div className="flex items-center gap-1 text-[10px]">
                                {(["openapi", "routes", "logs"] as const).map(
                                  (src) => {
                                    const present =
                                      f.sources_present.includes(src);
                                    return (
                                      <span
                                        key={src}
                                        className={`px-1.5 py-0.5 rounded font-mono uppercase ${
                                          present
                                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                            : "bg-slate-800 text-slate-500 border border-slate-700/60 line-through"
                                        }`}
                                      >
                                        {src === "openapi"
                                          ? "OpenAPI"
                                          : src === "routes"
                                          ? "Routes"
                                          : "Logs"}
                                      </span>
                                    );
                                  }
                                )}
                              </div>

                              {f.ai_explanation && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  AI Investigated
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Review Priority Score */}
                          <div className="text-right shrink-0 flex items-center gap-3">
                            <div>
                              <div className="text-xs font-mono font-bold text-white">
                                {f.review_priority_score}
                                <span className="text-slate-500 font-normal">
                                  /100
                                </span>
                              </div>
                              <div className="w-16 h-1.5 rounded-full bg-slate-800 mt-1 overflow-hidden">
                                <div
                                  className={`h-full ${getScoreBarColor(
                                    f.review_priority_score
                                  )}`}
                                  style={{
                                    width: `${f.review_priority_score}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] text-slate-400">
                                Review Priority
                              </span>
                            </div>
                            <ChevronRight
                              className={`h-4 w-4 ${
                                isSelected
                                  ? "text-indigo-400"
                                  : "text-slate-600"
                              }`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Screen D: Finding Detail & Evidence Panel */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-5 shadow-xl">
                {!selectedFinding ? (
                  <div className="p-8 text-center text-slate-400 text-sm">
                    Select a finding from the table to inspect its evidence and
                    verification steps.
                  </div>
                ) : (
                  <>
                    {/* Header */}
                    <div className="border-b border-slate-800 pb-4 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-indigo-400 font-semibold">
                          {selectedFinding.id} • Evidence Inspector
                        </span>
                        <span
                          className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${getSeverityBadgeColor(
                            selectedFinding.severity
                          )}`}
                        >
                          {selectedFinding.severity} Severity
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5 break-all">
                        <span
                          className={`text-xs font-mono font-bold px-2.5 py-1 rounded border shrink-0 ${getMethodBadgeColor(
                            selectedFinding.method
                          )}`}
                        >
                          {selectedFinding.method}
                        </span>
                        <h3 className="text-base font-mono font-bold text-white">
                          {selectedFinding.path}
                        </h3>
                      </div>

                      <p className="text-xs font-semibold text-amber-300">
                        Category: {selectedFinding.category}
                      </p>
                    </div>

                    {/* Source Presence & Telemetry */}
                    <div className="grid grid-cols-3 gap-2.5">
                      {(
                        [
                          { id: "openapi", label: "OpenAPI Spec" },
                          { id: "routes", label: "Route Inventory" },
                          { id: "logs", label: "Request Logs" },
                        ] as const
                      ).map((src) => {
                        const isPresent =
                          selectedFinding.sources_present.includes(src.id);
                        const origPaths =
                          selectedFinding.original_paths[src.id] || [];
                        return (
                          <div
                            key={src.id}
                            className={`rounded-xl p-2.5 border text-xs ${
                              isPresent
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                                : "bg-slate-950/70 border-slate-800 text-slate-400"
                            }`}
                          >
                            <div className="flex items-center justify-between font-semibold">
                              <span>{src.label}</span>
                              {isPresent ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <AlertCircle className="h-3.5 w-3.5 text-slate-500" />
                              )}
                            </div>
                            <p className="text-[11px] mt-1 font-mono truncate">
                              {isPresent
                                ? origPaths[0] || "Present"
                                : "Absent"}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Traffic Stats if observed */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <span className="text-slate-400">Observed Traffic:</span>{" "}
                        <strong className="text-white font-mono">
                          {selectedFinding.request_count} requests
                        </strong>
                      </div>
                      {selectedFinding.last_seen && (
                        <div>
                          <span className="text-slate-400">Last Seen:</span>{" "}
                          <span className="text-slate-200 font-mono">
                            {selectedFinding.last_seen}
                          </span>
                        </div>
                      )}
                      {Object.keys(selectedFinding.status_code_counts).length >
                        0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">Status Codes:</span>
                          {Object.entries(
                            selectedFinding.status_code_counts
                          ).map(([code, cnt]) => (
                            <span
                              key={code}
                              className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[11px]"
                            >
                              {code}: {cnt}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Deterministic Score & Score Factors */}
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">
                          Deterministic Review Priority Score
                        </span>
                        <span className="text-sm font-mono font-bold text-indigo-300">
                          {selectedFinding.review_priority_score} / 100
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Calculated deterministically in Python. Represents human
                        review priority—not probability that the endpoint is dead.
                      </p>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {selectedFinding.score_reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-indigo-400 font-mono">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Deterministic Source Evidence */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-emerald-400" />
                        Deterministic Source Evidence
                      </h4>
                      <ul className="space-y-1.5 text-xs text-slate-300 bg-slate-950/50 rounded-xl p-3.5 border border-slate-800/80">
                        {selectedFinding.evidence.map((ev, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-emerald-400 font-bold">✓</span>
                            <span>{ev}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Data Limitations & Caveats */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        What This Evidence Cannot Prove (Caveats)
                      </h4>
                      <ul className="space-y-1.5 text-xs text-amber-200/90 bg-amber-950/20 rounded-xl p-3.5 border border-amber-500/20">
                        {selectedFinding.limitations.map((lim, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-amber-400">•</span>
                            <span>{lim}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Interactive Human Verification Checklist */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                        <ListChecks className="h-3.5 w-3.5 text-sky-400" />
                        Recommended Human Verification Checklist
                      </h4>
                      <div className="space-y-1.5 bg-slate-950/50 rounded-xl p-3.5 border border-slate-800/80">
                        {selectedFinding.recommended_checks.map((chk, idx) => {
                          const isChecked =
                            !!checkedSteps[`${selectedFinding.id}:${idx}`];
                          return (
                            <label
                              key={idx}
                              onClick={() =>
                                toggleChecklistStep(selectedFinding.id, idx)
                              }
                              className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none hover:text-white"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                className="mt-0.5 rounded accent-indigo-500"
                              />
                              <span
                                className={
                                  isChecked
                                    ? "line-through text-slate-500"
                                    : ""
                                }
                              >
                                {chk}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Investigate with AI Section (Clearly Separated from Deterministic Evidence) */}
                    <div className="pt-2 border-t border-slate-800 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5" />
                            AI-Assisted Evidence Investigation
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            Sends only sanitized finding metadata. Never alters
                            scores or categories.
                          </p>
                        </div>

                        <button
                          onClick={() =>
                            handleInvestigateFinding(selectedFinding)
                          }
                          disabled={isInvestigatingFinding}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition disabled:opacity-50"
                        >
                          {isInvestigatingFinding ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {selectedFinding.ai_explanation
                            ? "Re-run AI Investigation"
                            : "Investigate with AI"}
                        </button>
                      </div>

                      {selectedFinding.ai_explanation && (
                        <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                  selectedFinding.ai_explanation.is_fallback
                                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                }`}
                              >
                                {selectedFinding.ai_explanation.is_fallback
                                  ? "Deterministic Fallback"
                                  : `Gemini (${selectedFinding.ai_explanation.model})`}
                              </span>
                              {selectedFinding.ai_explanation.cached && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                  Cached
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400">
                              {selectedFinding.ai_explanation.status_message}
                            </span>
                          </div>

                          <div className="space-y-1">
                            <p className="font-semibold text-indigo-200">
                              Interpretation Summary
                            </p>
                            <p className="text-slate-200 leading-relaxed">
                              {selectedFinding.ai_explanation.summary}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <p className="font-semibold text-indigo-200">
                              Cross-Source Evidence Reasoning
                            </p>
                            <ul className="list-disc list-inside space-y-1 text-slate-300">
                              {selectedFinding.ai_explanation.evidence_interpretation.map(
                                (item, i) => (
                                  <li key={i}>{item}</li>
                                )
                              )}
                            </ul>
                          </div>

                          <div className="space-y-1">
                            <p className="font-semibold text-indigo-200">
                              AI Verification Recommendations
                            </p>
                            <ul className="list-disc list-inside space-y-1 text-slate-300">
                              {selectedFinding.ai_explanation.recommended_checks.map(
                                (item, i) => (
                                  <li key={i}>{item}</li>
                                )
                              )}
                            </ul>
                          </div>

                          <div className="space-y-1">
                            <p className="font-semibold text-amber-300">
                              Uncertainties & Caveats
                            </p>
                            <ul className="list-disc list-inside space-y-1 text-amber-200/90">
                              {selectedFinding.ai_explanation.caveats.map(
                                (item, i) => (
                                  <li key={i}>{item}</li>
                                )
                              )}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Grounded "Ask This Analysis" Q&A Chat Section */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="h-5 w-5 text-indigo-400" />
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Ask This Analysis (Evidence-Grounded Q&A)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Ask natural-language questions grounded strictly in the
                      structured findings of this analysis.
                    </p>
                  </div>
                </div>
              </div>

              {/* Preset Questions */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">Quick questions:</span>
                {PRESET_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleAskQuestion(q)}
                    disabled={isAskingChat}
                    className="text-xs px-3 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Chat Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskQuestion();
                }}
                className="flex items-center gap-2.5"
              >
                <input
                  type="text"
                  value={chatQuestion}
                  onChange={(e) => setChatQuestion(e.target.value)}
                  placeholder="Ask a question about these findings (e.g., Which undocumented endpoints have active traffic?)..."
                  maxLength={500}
                  className="flex-1 rounded-xl bg-slate-950 border border-slate-800 px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isAskingChat || !chatQuestion.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
                >
                  {isAskingChat ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Ask
                </button>
              </form>

              {/* Chat Responses */}
              {chatHistory.length > 0 && (
                <div className="space-y-3 pt-2">
                  {chatHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-indigo-300">
                          Q: {item.question}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] border ${
                              item.is_fallback
                                ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                            }`}
                          >
                            {item.is_fallback
                              ? "Deterministic Lookup"
                              : `Gemini (${item.model})`}
                          </span>
                          {item.cached && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-500/10 border border-sky-500/30 text-sky-300">
                              Cached
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-slate-200 leading-relaxed">
                        {item.answer}
                      </p>

                      {item.referenced_finding_ids.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] text-slate-400">
                            Referenced Findings:
                          </span>
                          {item.referenced_finding_ids.map((fid) => (
                            <button
                              key={fid}
                              onClick={() => setSelectedFindingId(fid)}
                              className="font-mono text-[11px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition"
                            >
                              {fid}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        API Graveyard Autopsy • Evidence-Based API Lifecycle Investigator •
        Nginx + Next.js + FastAPI + Worker + Redis + Google Gemini
      </footer>
    </div>
  );
}


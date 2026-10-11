"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  askAnalysisQuestion,
  createCustomAnalysis,
  fetchAnalysis,
  fetchFindings,
  fetchServiceStatus,
  generateExecutiveSummary,
  generateInvestigationPlan,
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
import {
  MethodBadge,
  SourceMatrixPills,
  getSeverityDot,
} from "@/components/Badges";
import { ActiveTab, Header } from "@/components/Header";
import { UploadAndLanding } from "@/components/UploadAndLanding";
import { FindingInspector } from "@/components/FindingInspector";
import {
  AskAnalysisTab,
  PlanAndSummaryTab,
  SourcesAndExportTab,
} from "@/components/SecondaryTabs";

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

export default function AutopsyWorkbench() {
  const [aiStatus, setAiStatus] = useState<{
    enabled: boolean;
    configured: boolean;
    provider: string;
    model: string | null;
  } | null>(null);
  const [redisConnected, setRedisConnected] = useState<boolean>(false);

  // Analysis & workspace state
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("findings");
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);

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

  // Interactive human verification checklist
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  // AI states
  const [isInvestigatingFinding, setIsInvestigatingFinding] =
    useState<boolean>(false);
  const [isGeneratingSummary, setIsGeneratingSummary] =
    useState<boolean>(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState<boolean>(false);
  const [executiveSummary, setExecutiveSummary] =
    useState<ExecutiveSummaryRecord | null>(null);
  const [investigationPlan, setInvestigationPlan] =
    useState<InvestigationPlanRecord | null>(null);

  // Grounded Q&A state
  const [chatQuestion, setChatQuestion] = useState<string>("");
  const [isAskingChat, setIsAskingChat] = useState<boolean>(false);
  const [chatHistory, setChatHistory] = useState<ChatResponseRecord[]>([]);

  useEffect(() => {
    fetchServiceStatus()
      .then((data) => {
        setAiStatus(data.ai);
        setRedisConnected(data.redis_connected);
      })
      .catch(() => {});
  }, []);

  // Poll job status if queued or processing
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
            model: updated.ai_status.model
              ? String(updated.ai_status.model)
              : null,
          });
        }
        if (updated.status === "completed") {
          const fRes = await fetchFindings(updated.id);
          setFindings(fRes.findings);
          if (fRes.findings.length > 0 && !selectedFindingId) {
            setSelectedFindingId(fRes.findings[0].id);
          }
          setUploadModalOpen(false);
        } else if (updated.status === "failed") {
          setErrorBanner(updated.error_message || "Analysis job failed.");
        }
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Error polling analysis status."
        );
      }
    }, 650);

    return () => clearInterval(timer);
  }, [analysis, selectedFindingId]);

  const handleLoadDemo = async () => {
    setErrorBanner(null);
    setIsStartingAnalysis(true);
    setExecutiveSummary(null);
    setInvestigationPlan(null);
    setChatHistory([]);
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setMinScore(0);
    setActiveTab("findings");

    try {
      const demo = await startDemoAnalysis();
      setAnalysis(demo);
      if (demo.ai_status) {
        setAiStatus({
          enabled: Boolean(demo.ai_status.enabled),
          configured: Boolean(demo.ai_status.configured),
          provider: String(demo.ai_status.provider || ""),
          model: demo.ai_status.model ? String(demo.ai_status.model) : null,
        });
      }
      if (demo.status === "completed") {
        const fRes = await fetchFindings(demo.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        setUploadModalOpen(false);
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to load demo dataset."
      );
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);

    if (!openapiFile && !routesFile && !logsFile) {
      setErrorBanner(
        "Upload at least one source file (OpenAPI spec, route inventory, or request logs)."
      );
      return;
    }

    setIsStartingAnalysis(true);
    setExecutiveSummary(null);
    setInvestigationPlan(null);
    setChatHistory([]);
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setMinScore(0);
    setActiveTab("findings");

    try {
      const formData = new FormData();
      if (openapiFile) formData.append("openapi_file", openapiFile);
      if (routesFile) formData.append("routes_file", routesFile);
      if (logsFile) formData.append("logs_file", logsFile);
      if (analysisName.trim()) {
        formData.append("analysis_name", analysisName.trim());
      }

      const created = await createCustomAnalysis(formData);
      setAnalysis(created);
      if (created.status === "completed") {
        const fRes = await fetchFindings(created.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        setUploadModalOpen(false);
      } else if (created.status === "failed") {
        setErrorBanner(created.error_message || "Analysis validation failed.");
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to start analysis."
      );
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (selectedCategory !== "all" && f.category !== selectedCategory) {
        return false;
      }
      if (
        selectedMethod !== "all" &&
        f.method.toUpperCase() !== selectedMethod.toUpperCase()
      ) {
        return false;
      }
      if (f.review_priority_score < minScore) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${f.id} ${f.method} ${f.path} ${f.category} ${f.evidence.join(
          " "
        )}`.toLowerCase();
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

  const handleSelectFinding = (fid: string) => {
    setSelectedFindingId(fid);
    setMobileInspectorOpen(true);
  };

  const handleJumpToFindingFromOtherTab = (fid: string) => {
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setMinScore(0);
    setSelectedFindingId(fid);
    setActiveTab("findings");
    setMobileInspectorOpen(true);
  };

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
        err instanceof Error
          ? err.message
          : "Failed to generate executive summary."
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
        err instanceof Error
          ? err.message
          : "Failed to generate investigation plan."
      );
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const handleAskQuestion = async (preset?: string) => {
    if (!analysis) return;
    const q = (preset ?? chatQuestion).trim();
    if (!q) return;
    setIsAskingChat(true);
    setErrorBanner(null);
    try {
      const res = await askAnalysisQuestion(analysis.id, q);
      setChatHistory((prev) => [res.response, ...prev]);
      if (!preset) setChatQuestion("");
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
    <div className="min-h-screen flex flex-col bg-[#0a0a0c] text-zinc-200">
      <Header
        analysis={analysis}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        aiStatus={aiStatus}
        redisConnected={redisConnected}
        isStartingAnalysis={isStartingAnalysis}
        onLoadDemo={handleLoadDemo}
        onOpenUploadModal={() => setUploadModalOpen(true)}
      />

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 sm:px-6 py-5 space-y-4">
        {/* Error Banner */}
        {errorBanner && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 flex items-center justify-between gap-3 text-xs text-rose-200">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-rose-300 hover:text-white p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Upload Modal when an analysis is already open */}
        {uploadModalOpen && analysis && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
            <div className="w-full max-w-4xl my-auto">
              <UploadAndLanding
                isModal
                onCloseModal={() => setUploadModalOpen(false)}
                analysisName={analysisName}
                setAnalysisName={setAnalysisName}
                openapiFile={openapiFile}
                setOpenapiFile={setOpenapiFile}
                routesFile={routesFile}
                setRoutesFile={setRoutesFile}
                logsFile={logsFile}
                setLogsFile={setLogsFile}
                isStartingAnalysis={isStartingAnalysis}
                onLoadDemo={handleLoadDemo}
                onSubmitCustom={handleCustomSubmit}
              />
            </div>
          </div>
        )}

        {/* Initial Landing State (No analysis loaded yet) */}
        {!analysis && (
          <UploadAndLanding
            analysisName={analysisName}
            setAnalysisName={setAnalysisName}
            openapiFile={openapiFile}
            setOpenapiFile={setOpenapiFile}
            routesFile={routesFile}
            setRoutesFile={setRoutesFile}
            logsFile={logsFile}
            setLogsFile={setLogsFile}
            isStartingAnalysis={isStartingAnalysis}
            onLoadDemo={handleLoadDemo}
            onSubmitCustom={handleCustomSubmit}
          />
        )}

        {/* Progress State (Queued / Processing) */}
        {analysis &&
          (analysis.status === "queued" || analysis.status === "processing") && (
            <div className="rounded-lg border border-zinc-800 bg-[#111113] p-6 max-w-2xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 text-zinc-300 animate-spin" />
                  <div>
                    <div className="text-sm font-medium text-zinc-100">
                      Processing {analysis.name}
                    </div>
                    <div className="text-xs font-mono text-zinc-400 uppercase mt-0.5">
                      Stage: {analysis.stage}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-300">
                  {analysis.progress_percent}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="h-full bg-zinc-200 transition-all duration-300"
                  style={{ width: `${analysis.progress_percent}%` }}
                />
              </div>
            </div>
          )}

        {/* Completed Analysis Workspace */}
        {analysis && analysis.status === "completed" && analysis.summary && (
          <>
            {/* Tab 1: Findings & Evidence Workspace */}
            {activeTab === "findings" && (
              <div className="space-y-4">
                {/* Compact Telemetry & Source Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="rounded-md border border-zinc-800/90 bg-[#111113] px-3.5 py-2.5">
                    <div className="text-[11px] text-zinc-400">
                      Declared (OpenAPI)
                    </div>
                    <div className="text-lg font-mono font-semibold text-zinc-100 tabular-nums mt-0.5">
                      {analysis.summary.openapi_endpoint_count}
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800/90 bg-[#111113] px-3.5 py-2.5">
                    <div className="text-[11px] text-zinc-400">
                      Implemented (Routes)
                    </div>
                    <div className="text-lg font-mono font-semibold text-zinc-100 tabular-nums mt-0.5">
                      {analysis.summary.routes_endpoint_count}
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800/90 bg-[#111113] px-3.5 py-2.5">
                    <div className="text-[11px] text-zinc-400">
                      Observed (Logs)
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-lg font-mono font-semibold text-zinc-100 tabular-nums">
                        {analysis.summary.logs_endpoint_count}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">
                        ({analysis.summary.total_log_requests} reqs)
                      </span>
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800/90 bg-[#111113] px-3.5 py-2.5">
                    <div className="text-[11px] text-zinc-400">
                      Unique Surface
                    </div>
                    <div className="text-lg font-mono font-semibold text-zinc-100 tabular-nums mt-0.5">
                      {analysis.summary.total_unique_endpoints}
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800/90 bg-[#111113] px-3.5 py-2.5 col-span-2 sm:col-span-1">
                    <div className="text-[11px] text-zinc-400">
                      Flagged Findings
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-0.5">
                      <span className="text-lg font-mono font-semibold text-zinc-100 tabular-nums">
                        {analysis.summary.total_findings}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">
                        {analysis.summary.observation_window_days !== null
                          ? `${analysis.summary.observation_window_days}d window`
                          : "No window"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Category Quick-Filter Pills + Guardrail Notice */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 max-w-full">
                    <button
                      onClick={() => setSelectedCategory("all")}
                      className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap border transition ${
                        selectedCategory === "all"
                          ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                          : "bg-[#111113] text-zinc-400 border-zinc-800 hover:text-zinc-200"
                      }`}
                    >
                      All ({findings.length})
                    </button>
                    {Object.entries(analysis.summary.findings_by_category).map(
                      ([cat, count]) => {
                        const active = selectedCategory === cat;
                        return (
                          <button
                            key={cat}
                            onClick={() =>
                              setSelectedCategory(active ? "all" : cat)
                            }
                            className={`px-2.5 py-1 rounded text-xs whitespace-nowrap border transition ${
                              active
                                ? "bg-zinc-100 text-zinc-950 border-zinc-100 font-medium"
                                : "bg-[#111113] text-zinc-400 border-zinc-800 hover:text-zinc-200"
                            }`}
                          >
                            {cat}{" "}
                            <span className="font-mono text-[11px] opacity-75">
                              ({count})
                            </span>
                          </button>
                        );
                      }
                    )}
                  </div>

                  <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <span>
                      &ldquo;Not observed&rdquo; means absent from log sample,
                      not safe to delete.
                    </span>
                  </div>
                </div>

                {/* Search & Filter Toolbar */}
                <div className="rounded-lg border border-zinc-800 bg-[#111113] p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
                    {/* Search Input */}
                    <div className="relative flex-1 max-w-md">
                      <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter by path (/users), ID (FND-001), or evidence..."
                        className="w-full rounded-md bg-zinc-950 border border-zinc-800 pl-8 pr-7 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Method Pills */}
                    <div className="flex items-center gap-1 overflow-x-auto">
                      {HTTP_METHODS.map((m) => (
                        <button
                          key={m}
                          onClick={() => setSelectedMethod(m)}
                          className={`px-2 py-1 rounded text-[11px] font-mono uppercase border transition ${
                            selectedMethod === m
                              ? "bg-zinc-800 text-zinc-100 border-zinc-600"
                              : "bg-zinc-950 text-zinc-500 border-zinc-800/80 hover:text-zinc-300"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Priority Slider & Count */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t md:border-t-0 border-zinc-800/80 pt-2 md:pt-0 text-xs">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" />
                      <span>Min Priority:</span>
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={5}
                        value={minScore}
                        onChange={(e) => setMinScore(Number(e.target.value))}
                        className="w-20 accent-zinc-200 cursor-pointer"
                      />
                      <span className="font-mono text-zinc-200 tabular-nums w-6">
                        {minScore}
                      </span>
                    </div>

                    <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                      {filteredFindings.length}/{findings.length} shown
                    </span>
                  </div>
                </div>

                {/* Split View: Findings List (Left 7 cols) + Sticky Desktop Inspector (Right 5 cols) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left: Findings List */}
                  <div className="lg:col-span-7 rounded-lg border border-zinc-800 bg-[#111113] overflow-hidden">
                    {filteredFindings.length === 0 ? (
                      <div className="p-10 text-center space-y-2">
                        <p className="text-xs text-zinc-400">
                          No findings match the active filter criteria.
                        </p>
                        <button
                          onClick={() => {
                            setSelectedCategory("all");
                            setSelectedMethod("all");
                            setSearchQuery("");
                            setMinScore(0);
                          }}
                          className="text-xs text-zinc-200 underline hover:text-white"
                        >
                          Clear filters
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Desktop Table Header */}
                        <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/60 text-[11px] font-mono text-zinc-500 uppercase">
                          <div className="col-span-5">Endpoint</div>
                          <div className="col-span-3">Category</div>
                          <div className="col-span-3">Sources</div>
                          <div className="col-span-1 text-right">Priority</div>
                        </div>

                        <div className="divide-y divide-zinc-800/70">
                          {filteredFindings.map((f) => {
                            const isSelected = selectedFinding?.id === f.id;
                            return (
                              <div
                                key={f.id}
                                onClick={() => handleSelectFinding(f.id)}
                                className={`px-3.5 sm:px-4 py-3 cursor-pointer transition ${
                                  isSelected
                                    ? "bg-zinc-800/65"
                                    : "hover:bg-zinc-900/60"
                                }`}
                              >
                                {/* Desktop Row Layout */}
                                <div className="hidden sm:grid sm:grid-cols-12 gap-2 items-center">
                                  <div className="col-span-5 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <MethodBadge method={f.method} />
                                      <span className="font-mono text-xs text-zinc-100 truncate font-medium">
                                        {f.path}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                                      <span>{f.id}</span>
                                      {f.request_count > 0 && (
                                        <span>• {f.request_count} reqs</span>
                                      )}
                                      {f.ai_explanation && (
                                        <span className="text-emerald-400">
                                          • AI Note
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="col-span-3 pr-2">
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`h-2 w-2 rounded-full shrink-0 ${getSeverityDot(
                                          f.severity
                                        )}`}
                                      />
                                      <span className="text-xs text-zinc-300 leading-tight">
                                        {f.category}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="col-span-3">
                                    <SourceMatrixPills
                                      sourcesPresent={f.sources_present}
                                      sourcesSupplied={
                                        analysis.summary?.sources_supplied
                                      }
                                    />
                                  </div>

                                  <div className="col-span-1 text-right">
                                    <span className="font-mono text-xs font-semibold tabular-nums text-zinc-100">
                                      {f.review_priority_score}
                                    </span>
                                  </div>
                                </div>

                                {/* Mobile / Compact Card Layout */}
                                <div className="sm:hidden space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] font-mono text-zinc-500">
                                        {f.id}
                                      </span>
                                      <span
                                        className={`h-2 w-2 rounded-full ${getSeverityDot(
                                          f.severity
                                        )}`}
                                      />
                                      <span className="text-xs text-zinc-300 font-medium">
                                        {f.category}
                                      </span>
                                    </div>
                                    <span className="text-xs font-mono font-bold tabular-nums text-zinc-100 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                                      {f.review_priority_score}/100
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2 break-all">
                                    <MethodBadge method={f.method} />
                                    <span className="font-mono text-xs text-zinc-100 font-medium">
                                      {f.path}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between gap-2 pt-0.5">
                                    <SourceMatrixPills
                                      sourcesPresent={f.sources_present}
                                      sourcesSupplied={
                                        analysis.summary?.sources_supplied
                                      }
                                    />
                                    <span className="text-[11px] text-zinc-400">
                                      Tap to inspect →
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right: Desktop Sticky Inspector */}
                  <div className="hidden lg:block lg:col-span-5 sticky top-28">
                    <FindingInspector
                      finding={selectedFinding}
                      sourcesSupplied={analysis.summary.sources_supplied}
                      checkedSteps={checkedSteps}
                      onToggleChecklist={toggleChecklistStep}
                      isInvestigating={isInvestigatingFinding}
                      onInvestigate={handleInvestigateFinding}
                      onCloseMobileDrawer={() => setMobileInspectorOpen(false)}
                    />
                  </div>
                </div>

                {/* Mobile & Tablet Slide-Over Inspector Drawer */}
                {mobileInspectorOpen && selectedFinding && (
                  <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex justify-end">
                    <div className="w-full max-w-lg bg-[#111113] h-full overflow-y-auto shadow-2xl">
                      <FindingInspector
                        finding={selectedFinding}
                        sourcesSupplied={analysis.summary.sources_supplied}
                        checkedSteps={checkedSteps}
                        onToggleChecklist={toggleChecklistStep}
                        isInvestigating={isInvestigatingFinding}
                        onInvestigate={handleInvestigateFinding}
                        onCloseMobileDrawer={() =>
                          setMobileInspectorOpen(false)
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Verification Plan & Executive Summary */}
            {activeTab === "plan" && (
              <PlanAndSummaryTab
                executiveSummary={executiveSummary}
                investigationPlan={investigationPlan}
                isGeneratingSummary={isGeneratingSummary}
                isGeneratingPlan={isGeneratingPlan}
                onGenerateSummary={handleGenerateExecutiveSummary}
                onGeneratePlan={handleGeneratePlan}
                onJumpToFinding={handleJumpToFindingFromOtherTab}
              />
            )}

            {/* Tab 3: Grounded Q&A */}
            {activeTab === "chat" && (
              <AskAnalysisTab
                chatQuestion={chatQuestion}
                setChatQuestion={setChatQuestion}
                isAskingChat={isAskingChat}
                chatHistory={chatHistory}
                onAskQuestion={handleAskQuestion}
                onJumpToFinding={handleJumpToFindingFromOtherTab}
              />
            )}

            {/* Tab 4: Sources & Export */}
            {activeTab === "sources" && (
              <SourcesAndExportTab
                analysisId={analysis.id}
                sourceMetadata={analysis.source_metadata}
                summary={analysis.summary}
                logStart={analysis.log_start}
                logEnd={analysis.log_end}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-zinc-900 py-3.5 px-4 sm:px-6 text-[11px] text-zinc-500 flex flex-wrap items-center justify-between gap-2 max-w-[1600px] w-full mx-auto">
        <span>
          API Graveyard Autopsy • Evidence-based API lifecycle investigator
        </span>
        <span className="font-mono">
          Nginx • Next.js • FastAPI • Worker • Redis • Gemini
        </span>
      </footer>
    </div>
  );
}

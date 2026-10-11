"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  askAnalysisQuestion,
  createCustomAnalysis,
  createLiveAnalysis,
  deleteAnalysisRecord,
  fetchAnalysis,
  fetchAnalysisHistory,
  fetchFindings,
  generateExecutiveSummary,
  generateInvestigationPlan,
  investigateFinding,
  simulateLiveTraffic,
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
  getSeverityStyle,
} from "@/components/Badges";
import { ActiveTab, AppViewMode, Header } from "@/components/Header";
import {
  LiveScanFormParams,
  UploadAndLanding,
} from "@/components/UploadAndLanding";
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

const SHORT_CATEGORY_LABELS: Record<string, string> = {
  all: "All Issues",
  "Documented but not implemented": "Missing in Code (Ghost)",
  "Implemented but undocumented": "Undocumented in Code",
  "Observed but undocumented": "Undocumented Traffic",
  "Implemented but not observed": "No Traffic (In Code)",
  "Documented but not observed": "No Traffic (In Docs)",
  "Data-quality issue": "Data Quality",
};

const HTTP_METHODS = ["all", "GET", "POST", "PUT", "PATCH", "DELETE"];

interface EndpointGroup {
  key: string;
  primary: Finding;
  allFindings: Finding[];
  categories: string[];
}

export default function AutopsyWorkbench() {
  // Unified Top-Level Navigation Mode: "live" | "files" | "history" | "report"
  const [appView, setAppView] = useState<AppViewMode>("live");

  // Analysis & workspace state
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    null
  );
  const [mobileInspectorOpen, setMobileInspectorOpen] =
    useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("findings");

  // SQLite History state
  const [historyAnalyses, setHistoryAnalyses] = useState<AnalysisResponse[]>(
    []
  );

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

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetchAnalysisHistory(30);
      setHistoryAnalyses(res.analyses || []);
    } catch {
      // Ignore background history refresh errors
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

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
        if (updated.status === "completed") {
          const fRes = await fetchFindings(updated.id);
          setFindings(fRes.findings);
          if (fRes.findings.length > 0 && !selectedFindingId) {
            setSelectedFindingId(fRes.findings[0].id);
          }
          setAppView("report");
          refreshHistory();
        } else if (updated.status === "failed") {
          setErrorBanner(updated.error_message || "Analysis job failed.");
          refreshHistory();
        }
      } catch (err) {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : "Error polling analysis status."
        );
      }
    }, 650);

    return () => clearInterval(timer);
  }, [analysis, selectedFindingId, refreshHistory]);

  const handleSelectHistoryAnalysis = async (record: AnalysisResponse) => {
    setErrorBanner(null);
    setIsStartingAnalysis(true);
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setActiveTab("findings");
    setChatHistory([]);

    try {
      const fullRecord = await fetchAnalysis(record.id);
      setAnalysis(fullRecord);
      setExecutiveSummary(fullRecord.executive_summary || null);
      setInvestigationPlan(fullRecord.investigation_plan || null);
      if (fullRecord.status === "completed") {
        const fRes = await fetchFindings(fullRecord.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
      }
      setAppView("report");
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to load saved report."
      );
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const handleDeleteHistoryAnalysis = async (analysisId: string) => {
    try {
      await deleteAnalysisRecord(analysisId);
      setHistoryAnalyses((prev) =>
        prev.filter((item) => item.id !== analysisId)
      );
      if (analysis?.id === analysisId) {
        setAnalysis(null);
        setFindings([]);
        setSelectedFindingId(null);
        setAppView("history");
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to delete saved report."
      );
    }
  };

  const handleLoadDemo = async () => {
    setErrorBanner(null);
    setIsStartingAnalysis(true);
    setExecutiveSummary(null);
    setInvestigationPlan(null);
    setChatHistory([]);
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setActiveTab("findings");

    try {
      const demo = await startDemoAnalysis();
      setAnalysis(demo);
      setAppView("report");
      if (demo.status === "completed") {
        const fRes = await fetchFindings(demo.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        refreshHistory();
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
        "Please select at least one file (OpenAPI spec, backend routes, or traffic logs)."
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
      setAppView("report");
      if (created.status === "completed") {
        const fRes = await fetchFindings(created.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        refreshHistory();
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

  const handleLiveScanSubmit = async (params: LiveScanFormParams) => {
    setErrorBanner(null);

    if (!params.targetBaseUrl.trim()) {
      setErrorBanner("Target API Base URL is required.");
      return;
    }

    setIsStartingAnalysis(true);
    setExecutiveSummary(null);
    setInvestigationPlan(null);
    setChatHistory([]);
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setActiveTab("findings");

    try {
      const formData = new FormData();
      formData.append("target_base_url", params.targetBaseUrl.trim());
      formData.append(
        "openapi_path",
        params.openapiPath.trim() || "/openapi.json"
      );
      if (params.analysisName.trim()) {
        formData.append("analysis_name", params.analysisName.trim());
      }
      formData.append("auth_type", params.authType);
      formData.append("auth_token", params.authToken);
      formData.append("auth_header_name", params.authHeaderName);
      formData.append("auth_query_param", params.authQueryParam);
      formData.append("basic_username", params.basicUsername);
      formData.append("basic_password", params.basicPassword);
      formData.append("custom_headers_json", params.customHeadersJson);
      formData.append("probe_endpoints", String(params.probeEndpoints));
      formData.append(
        "include_shadow_wordlist",
        String(params.includeShadowWordlist)
      );
      if (params.extraProbePaths.trim()) {
        formData.append("extra_probe_paths", params.extraProbePaths.trim());
      }
      if (params.openapiFile) {
        formData.append("openapi_file", params.openapiFile);
      }
      if (params.logsFile) {
        formData.append("logs_file", params.logsFile);
      }

      const created = await createLiveAnalysis(formData);
      setAnalysis(created);
      setAppView("report");
      if (created.status === "completed") {
        const fRes = await fetchFindings(created.id);
        setFindings(fRes.findings);
        setSelectedFindingId(fRes.findings[0]?.id || null);
        refreshHistory();
      } else if (created.status === "failed") {
        setErrorBanner(created.error_message || "Live API scan failed.");
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to scan live API."
      );
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const handleSimulateTraffic = async (
    targetBaseUrl: string
  ): Promise<string | null> => {
    setErrorBanner(null);
    try {
      const res = await simulateLiveTraffic(targetBaseUrl);
      return (
        res.message ||
        `Simulated ${res.added_requests} live requests (total logs: ${res.total_logs}).`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Failed to simulate live traffic burst."
      );
      return null;
    }
  };

  // Group all raw findings by unique (method, path) so the same endpoint never appears twice in the list!
  const allEndpointGroups = useMemo<EndpointGroup[]>(() => {
    const map = new Map<string, Finding[]>();
    for (const f of findings) {
      const key = `${f.method.toUpperCase()} ${f.path}`;
      const existing = map.get(key);
      if (existing) {
        existing.push(f);
      } else {
        map.set(key, [f]);
      }
    }
    const groups: EndpointGroup[] = [];
    map.forEach((list, key) => {
      const sorted = [...list].sort(
        (a, b) => b.review_priority_score - a.review_priority_score
      );
      groups.push({
        key,
        primary: sorted[0],
        allFindings: sorted,
        categories: Array.from(new Set(sorted.map((item) => item.category))),
      });
    });
    return groups;
  }, [findings]);

  // Filtered Endpoint Groups
  const filteredGroups = useMemo<EndpointGroup[]>(() => {
    return allEndpointGroups.filter((g) => {
      if (
        selectedCategory !== "all" &&
        !g.categories.includes(selectedCategory)
      ) {
        return false;
      }
      if (
        selectedMethod !== "all" &&
        g.primary.method.toUpperCase() !== selectedMethod.toUpperCase()
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${g.allFindings.map((f) => f.id).join(" ")} ${
          g.primary.method
        } ${g.primary.path} ${g.categories.join(" ")} ${g.allFindings
          .flatMap((f) => f.evidence)
          .join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allEndpointGroups, selectedCategory, selectedMethod, searchQuery]);

  // Currently selected Endpoint Group
  const selectedGroup = useMemo<EndpointGroup | null>(() => {
    if (!selectedFindingId) return filteredGroups[0] || null;
    const match = allEndpointGroups.find((g) =>
      g.allFindings.some((f) => f.id === selectedFindingId)
    );
    return match || filteredGroups[0] || null;
  }, [allEndpointGroups, filteredGroups, selectedFindingId]);

  const handleSelectFinding = (fid: string) => {
    setSelectedFindingId(fid);
    setMobileInspectorOpen(true);
  };

  const handleJumpToFindingFromOtherTab = (fid: string) => {
    setSelectedCategory("all");
    setSelectedMethod("all");
    setSearchQuery("");
    setSelectedFindingId(fid);
    setActiveTab("findings");
    setAppView("report");
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

  const hasActiveFilters =
    selectedCategory !== "all" ||
    selectedMethod !== "all" ||
    searchQuery.trim() !== "";

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0c] text-zinc-200">
      <Header
        analysis={analysis}
        appView={appView}
        setAppView={(v) => {
          if (v === "history") refreshHistory();
          setAppView(v);
        }}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isStartingAnalysis={isStartingAnalysis}
        onLoadDemo={handleLoadDemo}
        historyCount={historyAnalyses.length}
        uniqueEndpointCount={allEndpointGroups.length}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Error Banner */}
        {errorBanner && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3.5 flex items-center justify-between gap-3 text-sm text-rose-200">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-rose-300 hover:text-white p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Top-Level Modes: Live API Scan, Upload Files, or Saved Reports */}
        {appView !== "report" && (
          <UploadAndLanding
            mode={appView}
            setMode={(m) => {
              if (m === "history") refreshHistory();
              setAppView(m);
            }}
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
            onSubmitLiveScan={handleLiveScanSubmit}
            onSimulateTraffic={handleSimulateTraffic}
            historyAnalyses={historyAnalyses}
            onSelectHistoryAnalysis={handleSelectHistoryAnalysis}
            onDeleteHistoryAnalysis={handleDeleteHistoryAnalysis}
          />
        )}

        {/* Progress State (Queued / Processing) */}
        {appView === "report" &&
          analysis &&
          (analysis.status === "queued" || analysis.status === "processing") && (
            <div className="rounded-xl border border-zinc-800 bg-[#111113] p-8 max-w-2xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                  <div>
                    <div className="text-base font-medium text-white">
                      Scanning {analysis.name}...
                    </div>
                    <div className="text-sm text-zinc-400 capitalize mt-0.5">
                      Step: {analysis.stage}
                    </div>
                  </div>
                </div>
                <span className="text-sm font-mono tabular-nums text-zinc-300">
                  {analysis.progress_percent}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${analysis.progress_percent}%` }}
                />
              </div>
            </div>
          )}

        {/* Completed Analysis Report Workspace */}
        {appView === "report" &&
          analysis &&
          analysis.status === "completed" &&
          analysis.summary && (
            <>
              {/* Tab 1: Endpoints & Issues Workspace */}
              {activeTab === "findings" && (
                <div className="space-y-4">
                  {/* 4-Card KPI Summary Bar */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-4">
                      <div className="text-xs sm:text-sm text-zinc-400">
                        Flagged Endpoints
                      </div>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-semibold text-white tabular-nums">
                          {allEndpointGroups.length}
                        </span>
                        {analysis.summary.total_findings >
                          allEndpointGroups.length && (
                          <span className="text-xs text-zinc-400">
                            ({analysis.summary.total_findings} total checks)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-4">
                      <div className="text-xs sm:text-sm text-zinc-400">
                        1. Documented (OpenAPI)
                      </div>
                      <div className="text-2xl font-semibold text-white tabular-nums mt-1">
                        {analysis.summary.openapi_endpoint_count}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-4">
                      <div className="text-xs sm:text-sm text-zinc-400">
                        2. Implemented (Code)
                      </div>
                      <div className="text-2xl font-semibold text-white tabular-nums mt-1">
                        {analysis.summary.routes_endpoint_count}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-4">
                      <div className="text-xs sm:text-sm text-zinc-400">
                        3. Seen in Traffic Logs
                      </div>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-semibold text-white tabular-nums">
                          {analysis.summary.logs_endpoint_count}
                        </span>
                        <span className="text-xs text-zinc-400">
                          ({analysis.summary.total_log_requests} reqs)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Filter Bar: Search + 1-Click Category Pills + Method Filter */}
                  <div className="rounded-xl border border-zinc-800 bg-[#111113] p-3.5 space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
                        {/* Search Input */}
                        <div className="relative flex-1 max-w-md">
                          <Search className="h-4 w-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search endpoint path (e.g. /users, /latest)..."
                            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 pl-10 pr-8 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => setSearchQuery("")}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        {/* HTTP Method Filter */}
                        <select
                          value={selectedMethod}
                          onChange={(e) => setSelectedMethod(e.target.value)}
                          className="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                        >
                          {HTTP_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {m === "all" ? "All HTTP Methods" : m}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 text-xs sm:text-sm text-zinc-400">
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCategory("all");
                              setSelectedMethod("all");
                              setSearchQuery("");
                            }}
                            className="text-emerald-400 hover:underline font-medium"
                          >
                            Reset Filters
                          </button>
                        )}
                        <span>
                          Showing{" "}
                          <strong className="text-white">
                            {filteredGroups.length}
                          </strong>{" "}
                          of {allEndpointGroups.length} endpoints
                        </span>
                      </div>
                    </div>

                    {/* 1-Click Issue Type Filter Pills */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
                      {CATEGORIES.map((cat) => {
                        const count =
                          cat === "all"
                            ? allEndpointGroups.length
                            : allEndpointGroups.filter((g) =>
                                g.categories.includes(cat)
                              ).length;
                        if (cat !== "all" && count === 0) return null;
                        const active = selectedCategory === cat;
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedCategory(cat)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition ${
                              active
                                ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                                : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white"
                            }`}
                          >
                            <span>{SHORT_CATEGORY_LABELS[cat] || cat}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[11px] font-mono leading-none ${
                                active
                                  ? "bg-zinc-900/20 text-zinc-950"
                                  : "bg-zinc-900 text-zinc-400"
                              }`}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Split View: Unique Endpoints List (Left 7 cols) + Inspector (Right 5 cols) */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    {/* Left: Deduplicated Endpoints List */}
                    <div className="lg:col-span-7 rounded-xl border border-zinc-800 bg-[#111113] overflow-hidden">
                      {filteredGroups.length === 0 ? (
                        <div className="p-12 text-center space-y-3">
                          <p className="text-base text-zinc-300">
                            No endpoints match your current filters.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCategory("all");
                              setSelectedMethod("all");
                              setSearchQuery("");
                            }}
                            className="text-sm text-emerald-400 underline hover:text-emerald-300"
                          >
                            Clear all filters
                          </button>
                        </div>
                      ) : (
                        <div className="divide-y divide-zinc-800/70">
                          {filteredGroups.map((group) => {
                            const f = group.primary;
                            const isSelected = selectedGroup?.key === group.key;

                            // Friendly combined summary label when both Implemented & Observed undocumented apply
                            const friendlyIssueLabel =
                              group.categories.includes(
                                "Implemented but undocumented"
                              ) &&
                              group.categories.includes(
                                "Observed but undocumented"
                              )
                                ? "Undocumented in OpenAPI (In Code & Active Traffic)"
                                : group.categories.join(" • ");

                            return (
                              <div
                                key={group.key}
                                onClick={() => handleSelectFinding(f.id)}
                                className={`p-4 sm:px-5 cursor-pointer transition border-l-4 ${
                                  isSelected
                                    ? "bg-zinc-800/65 border-l-emerald-400"
                                    : "border-l-transparent hover:bg-zinc-900/60"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <MethodBadge method={f.method} />
                                    <span className="font-mono text-sm sm:text-base text-white truncate font-medium">
                                      {f.path}
                                    </span>
                                  </div>

                                  <span
                                    className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-md border ${getSeverityStyle(
                                      f.severity
                                    )}`}
                                  >
                                    {f.severity}
                                  </span>
                                </div>

                                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs sm:text-sm text-zinc-300 font-medium">
                                    {friendlyIssueLabel}
                                  </span>

                                  <SourceMatrixPills
                                    sourcesPresent={f.sources_present}
                                    sourcesSupplied={
                                      analysis.summary?.sources_supplied
                                    }
                                    requestCount={f.request_count}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Right: Desktop Sticky Inspector */}
                    <div className="hidden lg:block lg:col-span-5 sticky top-28">
                      <FindingInspector
                        finding={selectedGroup?.primary || null}
                        relatedFindings={selectedGroup?.allFindings}
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
                  {mobileInspectorOpen && selectedGroup && (
                    <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex justify-end">
                      <div className="w-full max-w-lg bg-[#111113] h-full overflow-y-auto shadow-2xl">
                        <FindingInspector
                          finding={selectedGroup.primary}
                          relatedFindings={selectedGroup.allFindings}
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

              {/* Tab 2: Action Plan & Executive Summary */}
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

      <footer className="border-t border-zinc-900 py-4 px-4 sm:px-6 text-xs text-zinc-500 max-w-7xl w-full mx-auto flex flex-wrap items-center justify-between gap-2">
        <span>
          API Graveyard Autopsy — Evidence-based API lifecycle investigator
        </span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          Deterministic detection + Grounded Gemini AI explanations
        </span>
      </footer>
    </div>
  );
}

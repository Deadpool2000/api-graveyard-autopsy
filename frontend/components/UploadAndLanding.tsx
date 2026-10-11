"use client";

import React, { useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileCode,
  FileSpreadsheet,
  FolderOpen,
  Globe,
  History,
  KeyRound,
  Loader2,
  Play,
  Radio,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AnalysisResponse } from "@/lib/types";
import { getReportDownloadUrl } from "@/lib/api";

export type LiveAuthType =
  | "none"
  | "bearer"
  | "api_key_header"
  | "api_key_query"
  | "basic"
  | "custom_headers";

export interface LiveScanFormParams {
  targetBaseUrl: string;
  openapiPath: string;
  analysisName: string;
  authType: LiveAuthType;
  authToken: string;
  authHeaderName: string;
  authQueryParam: string;
  basicUsername: string;
  basicPassword: string;
  customHeadersJson: string;
  probeEndpoints: boolean;
  includeShadowWordlist: boolean;
  extraProbePaths: string;
  openapiFile: File | null;
  logsFile: File | null;
}

interface UploadAndLandingProps {
  isModal?: boolean;
  onCloseModal?: () => void;
  analysisName: string;
  setAnalysisName: (v: string) => void;
  openapiFile: File | null;
  setOpenapiFile: (f: File | null) => void;
  routesFile: File | null;
  setRoutesFile: (f: File | null) => void;
  logsFile: File | null;
  setLogsFile: (f: File | null) => void;
  isStartingAnalysis: boolean;
  onLoadDemo: () => void;
  onSubmitCustom: (e: React.FormEvent) => void;
  onSubmitLiveScan?: (params: LiveScanFormParams) => void;
  onSimulateTraffic?: (targetBaseUrl: string) => Promise<string | null>;
  historyAnalyses?: AnalysisResponse[];
  onSelectHistoryAnalysis?: (record: AnalysisResponse) => void;
  onDeleteHistoryAnalysis?: (analysisId: string) => void;
}

export function UploadAndLanding({
  isModal = false,
  onCloseModal,
  analysisName,
  setAnalysisName,
  openapiFile,
  setOpenapiFile,
  routesFile,
  setRoutesFile,
  logsFile,
  setLogsFile,
  isStartingAnalysis,
  onLoadDemo,
  onSubmitCustom,
  onSubmitLiveScan,
  onSimulateTraffic,
  historyAnalyses = [],
  onSelectHistoryAnalysis,
  onDeleteHistoryAnalysis,
}: UploadAndLandingProps) {
  const [inputMode, setInputMode] = useState<"files" | "live" | "history">(
    "files"
  );

  // Live API Scanner states
  const [targetBaseUrl, setTargetBaseUrl] = useState<string>(
    "http://target-api:8090"
  );
  const [openapiPath, setOpenapiPath] = useState<string>("/openapi.json");
  const [authType, setAuthType] = useState<LiveAuthType>("none");
  const [authToken, setAuthToken] = useState<string>("");
  const [authHeaderName, setAuthHeaderName] = useState<string>("X-API-Key");
  const [authQueryParam, setAuthQueryParam] = useState<string>("api_key");
  const [basicUsername, setBasicUsername] = useState<string>("");
  const [basicPassword, setBasicPassword] = useState<string>("");
  const [customHeadersJson, setCustomHeadersJson] = useState<string>("");
  const [probeEndpoints, setProbeEndpoints] = useState<boolean>(true);
  const [includeShadowWordlist, setIncludeShadowWordlist] =
    useState<boolean>(true);
  const [extraProbePaths, setExtraProbePaths] = useState<string>("");
  const [liveOpenapiFile, setLiveOpenapiFile] = useState<File | null>(null);
  const [liveLogsFile, setLiveLogsFile] = useState<File | null>(null);

  const [isSimulatingTraffic, setIsSimulatingTraffic] =
    useState<boolean>(false);
  const [trafficToast, setTrafficToast] = useState<string | null>(null);

  const handleSelectBuiltinContainer = () => {
    setInputMode("live");
    setTargetBaseUrl("http://target-api:8090");
    setOpenapiPath("/openapi.json");
    setAnalysisName("NexusPay Core API (Live Container Autopsy)");
    setProbeEndpoints(true);
    setIncludeShadowWordlist(true);
    setTrafficToast(null);
  };

  const handleQuickStartLiveContainerScan = () => {
    if (!onSubmitLiveScan) return;
    onSubmitLiveScan({
      targetBaseUrl: "http://target-api:8090",
      openapiPath: "/openapi.json",
      analysisName:
        analysisName.trim() || "NexusPay Core API (Live Container Autopsy)",
      authType: "api_key_header",
      authToken: "zombie-demo-key-2026",
      authHeaderName: "X-API-Key",
      authQueryParam: "api_key",
      basicUsername: "",
      basicPassword: "",
      customHeadersJson: "",
      probeEndpoints: true,
      includeShadowWordlist: true,
      extraProbePaths: "",
      openapiFile: null,
      logsFile: null,
    });
  };

  const handleTriggerTraffic = async () => {
    if (!onSimulateTraffic) return;
    setIsSimulatingTraffic(true);
    setTrafficToast(null);
    try {
      const msg = await onSimulateTraffic(targetBaseUrl);
      if (msg) {
        setTrafficToast(msg);
      }
    } finally {
      setIsSimulatingTraffic(false);
    }
  };

  const handleLiveFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmitLiveScan) return;
    onSubmitLiveScan({
      targetBaseUrl,
      openapiPath,
      analysisName,
      authType,
      authToken,
      authHeaderName,
      authQueryParam,
      basicUsername,
      basicPassword,
      customHeadersJson,
      probeEndpoints,
      includeShadowWordlist,
      extraProbePaths,
      openapiFile: liveOpenapiFile,
      logsFile: liveLogsFile,
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 py-2">
      {/* Simple, Clean Hero Card */}
      {!isModal && (
        <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 sm:p-10">
          <div className="max-w-3xl space-y-5">
            <h1 className="text-2xl sm:text-4xl font-semibold text-white tracking-tight leading-tight">
              Find unused, undocumented, or broken API endpoints.
            </h1>

            <p className="text-base sm:text-lg text-zinc-400 leading-relaxed">
              Compare your{" "}
              <strong className="text-zinc-200 font-medium">
                OpenAPI spec
              </strong>
              ,{" "}
              <strong className="text-zinc-200 font-medium">
                backend routes
              </strong>
              , and{" "}
              <strong className="text-zinc-200 font-medium">
                traffic logs
              </strong>{" "}
              — or scan a{" "}
              <strong className="text-zinc-200 font-medium">
                live running API
              </strong>{" "}
              with authentication to spot missing route handlers, zombie v1
              routes, and retirement candidates with clear evidence.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={onLoadDemo}
                disabled={isStartingAnalysis}
                className="inline-flex items-center gap-2.5 px-5 py-3 rounded-lg text-sm sm:text-base font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
              >
                {isStartingAnalysis ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                <span>Explore Sample Demo</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              {onSubmitLiveScan && (
                <button
                  type="button"
                  onClick={handleQuickStartLiveContainerScan}
                  disabled={isStartingAnalysis}
                  className="inline-flex items-center gap-2.5 px-5 py-3 rounded-lg text-sm sm:text-base font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition disabled:opacity-50"
                >
                  <Radio className="h-4 w-4 text-emerald-400" />
                  <span>Scan Live Zombie API Container</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setInputMode("live")}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition"
              >
                <Globe className="h-4 w-4 text-sky-400" />
                <span>Connect External API</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mode Switcher Card (Upload Files vs Scan Live API vs Saved History) */}
      <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-semibold text-white">
              {inputMode === "files"
                ? "Upload Your Own Files"
                : inputMode === "live"
                ? "Scan a Live Target or External API"
                : "Saved Autopsy Reports (SQLite History)"}
            </h2>
            <p className="text-sm text-zinc-400">
              {inputMode === "files"
                ? "Upload any combination of static files below to compare them offline."
                : inputMode === "live"
                ? "Connect to our built-in Zombie API container or any external API URL with authentication."
                : "Browse, reopen, export, or delete past API autopsy reports persisted in SQLite."}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => setInputMode("files")}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
                  inputMode === "files"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Upload Files</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode("live")}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
                  inputMode === "live"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Radio className="h-3.5 w-3.5 text-emerald-400" />
                <span>Scan Live API</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode("history")}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs sm:text-sm font-medium transition ${
                  inputMode === "history"
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <History className="h-3.5 w-3.5 text-sky-400" />
                <span>History ({historyAnalyses.length})</span>
              </button>
            </div>

            {isModal && onCloseModal && (
              <button
                type="button"
                onClick={onCloseModal}
                className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* MODE 1: STATIC FILE UPLOAD FORM (Existing functionality preserved 100%) */}
        {inputMode === "files" && (
          <form onSubmit={onSubmitCustom} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* 1. OpenAPI Input */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                      <FileCode className="h-4 w-4 text-emerald-400" />
                      1. API Spec
                    </span>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      .json / .yaml
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Your OpenAPI 3.x specification listing documented endpoints.
                  </p>
                </div>

                <div>
                  <input
                    type="file"
                    accept=".json,.yaml,.yml"
                    onChange={(e) =>
                      setOpenapiFile(e.target.files?.[0] || null)
                    }
                    className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-zinc-700 file:text-sm file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
                  />
                  {openapiFile && (
                    <div className="mt-3 flex items-center justify-between text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1.5 rounded-lg">
                      <span className="truncate">{openapiFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setOpenapiFile(null)}
                        className="text-zinc-400 hover:text-white ml-2 text-sm"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Route Inventory Input */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                      <FileSpreadsheet className="h-4 w-4 text-sky-400" />
                      2. Backend Routes
                    </span>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      .csv / .json
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Routes registered in code (needs{" "}
                    <code className="text-zinc-300">method</code> and{" "}
                    <code className="text-zinc-300">path</code>).
                  </p>
                </div>

                <div>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) => setRoutesFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-zinc-700 file:text-sm file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
                  />
                  {routesFile && (
                    <div className="mt-3 flex items-center justify-between text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1.5 rounded-lg">
                      <span className="truncate">{routesFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setRoutesFile(null)}
                        className="text-zinc-400 hover:text-white ml-2 text-sm"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Request Logs Input */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                      <FileSpreadsheet className="h-4 w-4 text-amber-400" />
                      3. Traffic Logs
                    </span>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      .csv / .json
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    Observed traffic logs (
                    <code className="text-zinc-300">
                      timestamp, method, path, status_code
                    </code>
                    ).
                  </p>
                </div>

                <div>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) => setLogsFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-zinc-700 file:text-sm file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
                  />
                  {logsFile && (
                    <div className="mt-3 flex items-center justify-between text-xs font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1.5 rounded-lg">
                      <span className="truncate">{logsFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setLogsFile(null)}
                        className="text-zinc-400 hover:text-white ml-2 text-sm"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Bar: Label + Submit */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-4 border-t border-zinc-800/80">
              <div className="w-full sm:max-w-xs">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Analysis Name{" "}
                  <span className="text-zinc-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={analysisName}
                  onChange={(e) => setAnalysisName(e.target.value)}
                  placeholder="e.g., Payments API Audit"
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {isModal && onCloseModal && (
                  <button
                    type="button"
                    onClick={onCloseModal}
                    className="px-4 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isStartingAnalysis}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
                >
                  {isStartingAnalysis ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span>Run Analysis</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* MODE 2: LIVE API SCANNER (Built-in Container + External Authenticated APIs) */}
        {inputMode === "live" && (
          <form onSubmit={handleLiveFormSubmit} className="space-y-6">
            {/* Built-in Zombie Container Preset Banner */}
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                  <Server className="h-4 w-4 text-emerald-400" />
                  <span>
                    Built-in Test Container: NexusPay Zombie API (
                    <code className="font-mono text-emerald-200">
                      http://target-api:8090
                    </code>
                    )
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  A live FastAPI microservice running in Docker with active v2
                  routes, undocumented Zombie v1 endpoints, shadow debug routes,
                  and 404 Ghost OpenAPI contracts.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleSelectBuiltinContainer}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition"
                >
                  Fill Container Preset
                </button>
                {onSimulateTraffic && (
                  <button
                    type="button"
                    onClick={handleTriggerTraffic}
                    disabled={isSimulatingTraffic}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 transition disabled:opacity-50"
                  >
                    {isSimulatingTraffic ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Activity className="h-3.5 w-3.5" />
                    )}
                    <span>Simulate Live Traffic Burst</span>
                  </button>
                )}
              </div>
            </div>

            {trafficToast && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm text-emerald-200">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  {trafficToast}
                </span>
                <button
                  type="button"
                  onClick={() => setTrafficToast(null)}
                  className="text-emerald-300 hover:text-white ml-3"
                >
                  ×
                </button>
              </div>
            )}

            {/* Target URL & OpenAPI Path */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-200 mb-1.5">
                  Target API Base URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={targetBaseUrl}
                  onChange={(e) => setTargetBaseUrl(e.target.value)}
                  placeholder="http://target-api:8090 or https://api.yourdomain.com"
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  Use <code className="text-zinc-400">http://target-api:8090</code>{" "}
                  for the built-in container,{" "}
                  <code className="text-zinc-400">http://localhost:PORT</code>{" "}
                  for an API on your host machine, or any{" "}
                  <code className="text-zinc-400">https://</code> URL.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-200 mb-1.5">
                  OpenAPI Spec Path
                </label>
                <input
                  type="text"
                  value={openapiPath}
                  onChange={(e) => setOpenapiPath(e.target.value)}
                  placeholder="/openapi.json"
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  Auto-checks <code className="text-zinc-400">/openapi.json</code>
                  , <code className="text-zinc-400">/swagger.json</code>,{" "}
                  <code className="text-zinc-400">/v3/api-docs</code>.
                </p>
              </div>
            </div>

            {/* Authentication Configuration Card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <KeyRound className="h-4 w-4 text-amber-400" />
                  <span>API Authentication (For Protected / External APIs)</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  In-memory only — never saved to SQLite, Redis, or AI
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Authentication Method
                  </label>
                  <select
                    value={authType}
                    onChange={(e) =>
                      setAuthType(e.target.value as LiveAuthType)
                    }
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
                  >
                    <option value="none">No Authentication (Public)</option>
                    <option value="bearer">
                      Bearer Token (JWT / OAuth2)
                    </option>
                    <option value="api_key_header">
                      API Key in Request Header
                    </option>
                    <option value="api_key_query">
                      API Key in Query Parameter
                    </option>
                    <option value="basic">HTTP Basic Auth (User / Pass)</option>
                    <option value="custom_headers">
                      Custom HTTP Headers (JSON)
                    </option>
                  </select>
                </div>

                {authType === "bearer" && (
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-zinc-400">
                        Bearer Token (
                        <code className="text-zinc-300">
                          Authorization: Bearer ...
                        </code>
                        )
                      </label>
                      <button
                        type="button"
                        onClick={() => setAuthToken("zombie-demo-token-2026")}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        Use Demo Container Token
                      </button>
                    </div>
                    <input
                      type="password"
                      value={authToken}
                      onChange={(e) => setAuthToken(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIs..."
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                )}

                {authType === "api_key_header" && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Header Name
                      </label>
                      <input
                        type="text"
                        value={authHeaderName}
                        onChange={(e) => setAuthHeaderName(e.target.value)}
                        placeholder="X-API-Key"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium text-zinc-400">
                          API Key Value
                        </label>
                        <button
                          type="button"
                          onClick={() => setAuthToken("zombie-demo-key-2026")}
                          className="text-xs text-emerald-400 hover:underline"
                        >
                          Fill Demo Key
                        </button>
                      </div>
                      <input
                        type="password"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        placeholder="Enter API key..."
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                  </>
                )}

                {authType === "api_key_query" && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Query Parameter Name
                      </label>
                      <input
                        type="text"
                        value={authQueryParam}
                        onChange={(e) => setAuthQueryParam(e.target.value)}
                        placeholder="api_key"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        API Key Value
                      </label>
                      <input
                        type="password"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        placeholder="Enter API key..."
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                  </>
                )}

                {authType === "basic" && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Username
                      </label>
                      <input
                        type="text"
                        value={basicUsername}
                        onChange={(e) => setBasicUsername(e.target.value)}
                        placeholder="api-user"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        Password
                      </label>
                      <input
                        type="password"
                        value={basicPassword}
                        onChange={(e) => setBasicPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
                      />
                    </div>
                  </>
                )}

                {authType === "custom_headers" && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Custom Headers (JSON Object)
                    </label>
                    <input
                      type="text"
                      value={customHeadersJson}
                      onChange={(e) => setCustomHeadersJson(e.target.value)}
                      placeholder='{"X-Tenant-ID": "acme-prod", "X-Access-Token": "secret"}'
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Probing & Hybrid File Overrides */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
                <div className="text-sm font-semibold text-zinc-100">
                  Active Endpoint Probing
                </div>

                <label className="flex items-start gap-2.5 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={probeEndpoints}
                    onChange={(e) => setProbeEndpoints(e.target.checked)}
                    className="mt-1 rounded border-zinc-700 bg-zinc-900"
                  />
                  <span>
                    <strong className="text-zinc-100">
                      Probe OpenAPI endpoints for live status
                    </strong>
                    <span className="block text-xs text-zinc-400 mt-0.5">
                      Verifies which documented routes are actually implemented
                      vs returning <code className="text-zinc-300">404</code>{" "}
                      (Ghost routes).
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-sm text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeShadowWordlist}
                    onChange={(e) =>
                      setIncludeShadowWordlist(e.target.checked)
                    }
                    className="mt-1 rounded border-zinc-700 bg-zinc-900"
                  />
                  <span>
                    <strong className="text-zinc-100">
                      Check common Zombie v1 &amp; Shadow paths
                    </strong>
                    <span className="block text-xs text-zinc-400 mt-0.5">
                      Probes common undocumented paths (
                      <code className="text-zinc-300">/api/v1/legacy/*</code>,{" "}
                      <code className="text-zinc-300">/api/internal/*</code>).
                    </span>
                  </span>
                </label>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Extra Candidate Paths to Probe{" "}
                    <span className="text-zinc-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={extraProbePaths}
                    onChange={(e) => setExtraProbePaths(e.target.value)}
                    placeholder="GET /api/v1/old-users, POST /api/internal/sync"
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">
                    Hybrid File Overrides{" "}
                    <span className="text-xs font-normal text-zinc-400">
                      (Optional for External APIs)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    If your external API doesn&apos;t expose{" "}
                    <code className="text-zinc-300">/openapi.json</code> publicly
                    or you want to include exported production logs, attach them
                    here:
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Local OpenAPI Spec Override (.json / .yaml)
                  </label>
                  <input
                    type="file"
                    accept=".json,.yaml,.yml"
                    onChange={(e) =>
                      setLiveOpenapiFile(e.target.files?.[0] || null)
                    }
                    className="block w-full text-xs text-zinc-400 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-md file:border file:border-zinc-700 file:text-xs file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Attach Traffic Logs (.csv / .json)
                  </label>
                  <input
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) =>
                      setLiveLogsFile(e.target.files?.[0] || null)
                    }
                    className="block w-full text-xs text-zinc-400 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-md file:border file:border-zinc-700 file:text-xs file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Bottom Bar: Label + Submit Live Scan */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-4 border-t border-zinc-800/80">
              <div className="w-full sm:max-w-xs">
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Analysis Name{" "}
                  <span className="text-zinc-500 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={analysisName}
                  onChange={(e) => setAnalysisName(e.target.value)}
                  placeholder="e.g., Live Zombie API Scan"
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {isModal && onCloseModal && (
                  <button
                    type="button"
                    onClick={onCloseModal}
                    className="px-4 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isStartingAnalysis}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-emerald-400 hover:bg-emerald-300 text-zinc-950 transition disabled:opacity-50"
                >
                  {isStartingAnalysis ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Radio className="h-4 w-4" />
                  )}
                  <span>Scan Live Target API</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* MODE 3: SAVED REPORTS HISTORY (SQLite Database) */}
        {inputMode === "history" && (
          <div className="space-y-4">
            {historyAnalyses.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-10 text-center space-y-2">
                <Database className="h-7 w-7 text-zinc-500 mx-auto" />
                <div className="text-sm font-medium text-zinc-200">
                  No saved autopsy reports in SQLite yet
                </div>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  Run a Sample Demo, upload static files, or scan a Live API.
                  Every completed analysis is automatically saved to the
                  persistent SQLite database.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
                {historyAnalyses.map((item) => {
                  const totalFindings = item.summary?.total_findings ?? 0;
                  const sources = item.summary?.sources_supplied ?? [];
                  return (
                    <div
                      key={item.id}
                      className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-900/50 transition"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-sm sm:text-base font-medium text-white truncate">
                            {item.name}
                          </span>
                          <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                            {totalFindings} findings
                          </span>
                          {item.is_demo && (
                            <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              Demo
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                          <span>
                            Created:{" "}
                            <code className="text-zinc-300">
                              {item.created_at.replace("T", " ").slice(0, 19)} UTC
                            </code>
                          </span>
                          {sources.length > 0 && (
                            <span>
                              Sources:{" "}
                              <strong className="text-zinc-300">
                                {sources.join(", ")}
                              </strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {onSelectHistoryAnalysis && (
                          <button
                            type="button"
                            onClick={() => onSelectHistoryAnalysis(item)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            <span>Open Report</span>
                          </button>
                        )}
                        <a
                          href={getReportDownloadUrl(item.id, "markdown")}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                          title="Download Markdown Report"
                        >
                          <Download className="h-3 w-3" />
                          <span>.MD</span>
                        </a>
                        <a
                          href={getReportDownloadUrl(item.id, "json")}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                          title="Download JSON Report"
                        >
                          <Download className="h-3 w-3" />
                          <span>.JSON</span>
                        </a>
                        {onDeleteHistoryAnalysis && (
                          <button
                            type="button"
                            onClick={() => onDeleteHistoryAnalysis(item.id)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Delete from SQLite history"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Recent Saved Reports Bar on Landing Page (when in Files or Live mode) */}
      {!isModal && inputMode !== "history" && historyAnalyses.length > 0 && (
        <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <Database className="h-4 w-4 text-sky-400" />
              <span>Recent Saved Reports (SQLite Database)</span>
            </div>
            <button
              type="button"
              onClick={() => setInputMode("history")}
              className="text-xs text-sky-400 hover:underline"
            >
              View all ({historyAnalyses.length}) →
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {historyAnalyses.slice(0, 4).map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate">
                    {item.name}
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {item.summary?.total_findings ?? 0} findings •{" "}
                    {item.created_at.slice(0, 10)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {onSelectHistoryAnalysis && (
                    <button
                      type="button"
                      onClick={() => onSelectHistoryAnalysis(item)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition"
                    >
                      Open
                    </button>
                  )}
                  {onDeleteHistoryAnalysis && (
                    <button
                      type="button"
                      onClick={() => onDeleteHistoryAnalysis(item.id)}
                      className="p-1.5 rounded-md text-zinc-500 hover:text-rose-400 transition"
                      title="Delete report"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileCheck2,
  FileCode,
  FileSpreadsheet,
  FolderOpen,
  Globe,
  History,
  KeyRound,
  Loader2,
  Play,
  Plus,
  Radio,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
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
  mode: "live" | "files" | "history";
  setMode: (mode: "live" | "files" | "history") => void;
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

const AUTH_LABELS: Record<LiveAuthType, string> = {
  none: "Public (No Auth)",
  bearer: "Bearer Token",
  api_key_header: "API Key (Header)",
  api_key_query: "API Key (Query)",
  basic: "HTTP Basic Auth",
  custom_headers: "Custom Headers",
};

export function UploadAndLanding({
  mode,
  setMode,
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

  // Progressive disclosure for Advanced Live Scan settings
  const [showAdvancedLive, setShowAdvancedLive] = useState<boolean>(false);

  const [isSimulatingTraffic, setIsSimulatingTraffic] =
    useState<boolean>(false);
  const [trafficToast, setTrafficToast] = useState<string | null>(null);

  const handleSelectPresetUrl = (
    url: string,
    name: string,
    presetAuthType: LiveAuthType = "none",
    presetToken: string = ""
  ) => {
    setTargetBaseUrl(url);
    setOpenapiPath("/openapi.json");
    setAnalysisName(name);
    setAuthType(presetAuthType);
    setAuthToken(presetToken);
    setTrafficToast(null);
  };

  const handleQuickStartLiveContainerScan = () => {
    if (!onSubmitLiveScan) return;
    onSubmitLiveScan({
      targetBaseUrl: "http://target-api:8090",
      openapiPath: "/openapi.json",
      analysisName: "NexusPay Core API (Live Container Autopsy)",
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
      const msg = await onSimulateTraffic("http://target-api:8090");
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

  const uploadedFilesCount = [openapiFile, routesFile, logsFile].filter(
    Boolean
  ).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Compact, Clear Top Mode Cards — Easy 1-Click Navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setMode("live")}
          className={`text-left rounded-xl p-4 border transition flex items-start gap-3.5 ${
            mode === "live"
              ? "bg-emerald-500/10 border-emerald-500/50 ring-1 ring-emerald-500/30"
              : "bg-[#111113] border-zinc-800/90 hover:border-zinc-700 hover:bg-zinc-900/60"
          }`}
        >
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              mode === "live"
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-zinc-900 text-emerald-400"
            }`}
          >
            <Radio className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              1. Scan Live API
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Enter any URL or test our built-in Zombie API container.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMode("files")}
          className={`text-left rounded-xl p-4 border transition flex items-start gap-3.5 ${
            mode === "files"
              ? "bg-sky-500/10 border-sky-500/50 ring-1 ring-sky-500/30"
              : "bg-[#111113] border-zinc-800/90 hover:border-zinc-700 hover:bg-zinc-900/60"
          }`}
        >
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              mode === "files"
                ? "bg-sky-500/20 text-sky-300"
                : "bg-zinc-900 text-sky-400"
            }`}
          >
            <Upload className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              2. Upload Static Files
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Compare OpenAPI spec, code routes, and traffic logs offline.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMode("history")}
          className={`text-left rounded-xl p-4 border transition flex items-start gap-3.5 ${
            mode === "history"
              ? "bg-amber-500/10 border-amber-500/50 ring-1 ring-amber-500/30"
              : "bg-[#111113] border-zinc-800/90 hover:border-zinc-700 hover:bg-zinc-900/60"
          }`}
        >
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              mode === "history"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-zinc-900 text-amber-400"
            }`}
          >
            <History className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white flex items-center gap-2">
              <span>3. Saved Reports</span>
              <span className="px-1.5 py-0.5 rounded-full text-[11px] font-mono bg-zinc-800 text-zinc-300">
                {historyAnalyses.length}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Reopen, compare, or download past autopsy scans.
            </p>
          </div>
        </button>
      </div>

      {/* =====================================================================
          MODE 1: SCAN LIVE API (Streamlined URL-first UX + Collapsible Advanced)
         ===================================================================== */}
      {mode === "live" && (
        <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 sm:p-8 space-y-6">
          {/* Header + 1-Click Presets */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-semibold text-white">
                Scan a Live API Endpoint or Server
              </h1>
              <p className="text-sm text-zinc-400">
                Paste any API URL below, or use a 1-click preset to discover
                undocumented &amp; ghost endpoints automatically.
              </p>
            </div>

            {/* Quick 1-Click Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleQuickStartLiveContainerScan}
                disabled={isStartingAnalysis}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span>1-Click Scan Zombie Container</span>
              </button>

              <button
                type="button"
                onClick={onLoadDemo}
                disabled={isStartingAnalysis}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs sm:text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5 text-zinc-300 fill-current" />
                <span>Try Synthetic Demo</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleLiveFormSubmit} className="space-y-5">
            {/* Quick Target Preset Pills */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-zinc-400">
                Quick Target Presets (click to fill URL):
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleSelectPresetUrl(
                      "http://target-api:8090",
                      "NexusPay Zombie API Container",
                      "api_key_header",
                      "zombie-demo-key-2026"
                    )
                  }
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    targetBaseUrl === "http://target-api:8090"
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                      : "bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <Server className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Built-in Zombie Container (http://target-api:8090)</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleSelectPresetUrl(
                      "https://api.frankfurter.dev",
                      "Frankfurter Currency API (Live)",
                      "none",
                      ""
                    )
                  }
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    targetBaseUrl === "https://api.frankfurter.dev"
                      ? "bg-sky-500/15 border-sky-500/40 text-sky-200"
                      : "bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5 text-sky-400" />
                  <span>Public Currency API (https://api.frankfurter.dev)</span>
                </button>

                {targetBaseUrl.includes("target-api") && onSimulateTraffic && (
                  <button
                    type="button"
                    onClick={handleTriggerTraffic}
                    disabled={isSimulatingTraffic}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-emerald-300 border border-zinc-800 transition disabled:opacity-50"
                  >
                    {isSimulatingTraffic ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Activity className="h-3.5 w-3.5" />
                    )}
                    <span>Simulate Traffic Burst on Container</span>
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

            {/* Main URL Bar + Primary Scan CTA */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-200">
                Target API URL <span className="text-rose-400">*</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Globe className="h-4 w-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={targetBaseUrl}
                    onChange={(e) => setTargetBaseUrl(e.target.value)}
                    placeholder="https://api.yourdomain.com or http://target-api:8090"
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-700/90 pl-10 pr-4 py-3 text-sm sm:text-base font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isStartingAnalysis}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl text-sm sm:text-base font-semibold bg-emerald-400 hover:bg-emerald-300 text-zinc-950 transition disabled:opacity-50 shrink-0 shadow-xs"
                >
                  {isStartingAnalysis ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Radio className="h-4 w-4" />
                  )}
                  <span>Scan API Now</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Progressive Disclosure Toggle for Auth & Advanced Settings */}
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvancedLive((prev) => !prev)}
                className="w-full px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-zinc-900/50 transition"
              >
                <div className="flex items-center gap-2.5 text-sm font-medium text-zinc-200">
                  <Settings2 className="h-4 w-4 text-zinc-400" />
                  <span>
                    Authentication &amp; Advanced Scan Options{" "}
                    <span className="text-zinc-500 font-normal">(optional)</span>
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
                    Auth: <strong>{AUTH_LABELS[authType]}</strong>
                  </span>
                  <span className="hidden sm:inline-block px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono">
                    Spec: {openapiPath || "/openapi.json"}
                  </span>
                  {showAdvancedLive ? (
                    <ChevronUp className="h-4 w-4 text-zinc-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-zinc-400" />
                  )}
                </div>
              </button>

              {showAdvancedLive && (
                <div className="p-5 border-t border-zinc-800/80 space-y-5 bg-zinc-950/90">
                  {/* 1. API Authentication */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                        <KeyRound className="h-4 w-4 text-amber-400" />
                        <span>API Authentication</span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        In-memory only — never saved to database
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                          Auth Method
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
                          <option value="basic">
                            HTTP Basic Auth (User / Pass)
                          </option>
                          <option value="custom_headers">
                            Custom HTTP Headers (JSON)
                          </option>
                        </select>
                      </div>

                      {authType === "bearer" && (
                        <div className="md:col-span-2">
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-zinc-400">
                              Bearer Token
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                setAuthToken("zombie-demo-token-2026")
                              }
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
                              onChange={(e) =>
                                setAuthHeaderName(e.target.value)
                              }
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
                                onClick={() =>
                                  setAuthToken("zombie-demo-key-2026")
                                }
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
                              onChange={(e) =>
                                setAuthQueryParam(e.target.value)
                              }
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
                              onChange={(e) =>
                                setBasicUsername(e.target.value)
                              }
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
                              onChange={(e) =>
                                setBasicPassword(e.target.value)
                              }
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
                            onChange={(e) =>
                              setCustomHeadersJson(e.target.value)
                            }
                            placeholder='{"X-Tenant-ID": "acme-prod", "X-Access-Token": "secret"}'
                            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 2. Spec Path, Report Name & Probing */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-zinc-800/80">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">
                          OpenAPI Spec Path (auto-detects /openapi.json,
                          /swagger.json)
                        </label>
                        <input
                          type="text"
                          value={openapiPath}
                          onChange={(e) => setOpenapiPath(e.target.value)}
                          placeholder="/openapi.json"
                          className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">
                          Custom Report Name (optional)
                        </label>
                        <input
                          type="text"
                          value={analysisName}
                          onChange={(e) => setAnalysisName(e.target.value)}
                          placeholder="e.g., Production Gateway Audit"
                          className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">
                          Extra Paths to Probe (optional)
                        </label>
                        <input
                          type="text"
                          value={extraProbePaths}
                          onChange={(e) => setExtraProbePaths(e.target.value)}
                          placeholder="GET /api/v1/old-users, POST /api/internal/sync"
                          className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-medium text-zinc-300">
                        Probing &amp; Local File Overrides
                      </div>

                      <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={probeEndpoints}
                          onChange={(e) => setProbeEndpoints(e.target.checked)}
                          className="mt-0.5 rounded border-zinc-700 bg-zinc-900"
                        />
                        <span>
                          <strong className="text-zinc-100">
                            Probe OpenAPI endpoints for live status
                          </strong>{" "}
                          — checks if documented routes return 200 vs 404.
                        </span>
                      </label>

                      <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeShadowWordlist}
                          onChange={(e) =>
                            setIncludeShadowWordlist(e.target.checked)
                          }
                          className="mt-0.5 rounded border-zinc-700 bg-zinc-900"
                        />
                        <span>
                          <strong className="text-zinc-100">
                            Check common Zombie v1 &amp; Shadow paths
                          </strong>{" "}
                          — probes legacy paths (
                          <code className="text-zinc-400">/api/v1/legacy/*</code>
                          ).
                        </span>
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        <label className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 p-2.5 block">
                          <span className="block text-[11px] font-medium text-zinc-300 truncate">
                            {liveOpenapiFile
                              ? `✓ ${liveOpenapiFile.name}`
                              : "+ Override OpenAPI (.json/.yaml)"}
                          </span>
                          <input
                            type="file"
                            accept=".json,.yaml,.yml"
                            onChange={(e) =>
                              setLiveOpenapiFile(e.target.files?.[0] || null)
                            }
                            className="hidden"
                          />
                        </label>

                        <label className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 p-2.5 block">
                          <span className="block text-[11px] font-medium text-zinc-300 truncate">
                            {liveLogsFile
                              ? `✓ ${liveLogsFile.name}`
                              : "+ Attach Traffic Logs (.csv/.json)"}
                          </span>
                          <input
                            type="file"
                            accept=".csv,.json"
                            onChange={(e) =>
                              setLiveLogsFile(e.target.files?.[0] || null)
                            }
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODE 2: UPLOAD STATIC FILES (Clean Interactive Dropzones)
         ===================================================================== */}
      {mode === "files" && (
        <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-semibold text-white">
                Compare Static API Files Offline
              </h1>
              <p className="text-sm text-zinc-400">
                Select at least 1 file below (upload all 3 to cross-check
                OpenAPI docs, backend code, and traffic logs).
              </p>
            </div>

            <button
              type="button"
              onClick={onLoadDemo}
              disabled={isStartingAnalysis}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition shrink-0"
            >
              <Play className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400" />
              <span>No files handy? Load Sample Demo</span>
            </button>
          </div>

          <form onSubmit={onSubmitCustom} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: OpenAPI Spec */}
              <div
                className={`rounded-xl border p-5 flex flex-col justify-between transition ${
                  openapiFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-white">
                      <FileCode className="h-4 w-4 text-emerald-400" />
                      1. OpenAPI Spec
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      .json / .yaml
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                    Your documented API contract listing public routes.
                  </p>
                </div>

                <div className="pt-4">
                  {openapiFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-2.5 text-xs text-emerald-200">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCheck2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="font-mono truncate">
                          {openapiFile.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenapiFile(null)}
                        className="p-1 text-emerald-300 hover:text-white shrink-0"
                        title="Remove file"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex items-center justify-center gap-2 w-full rounded-lg border border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-900 py-3 px-4 text-xs sm:text-sm font-medium text-zinc-200 transition">
                      <Plus className="h-4 w-4 text-emerald-400" />
                      <span>Select OpenAPI File</span>
                      <input
                        type="file"
                        accept=".json,.yaml,.yml"
                        onChange={(e) =>
                          setOpenapiFile(e.target.files?.[0] || null)
                        }
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Card 2: Backend Routes */}
              <div
                className={`rounded-xl border p-5 flex flex-col justify-between transition ${
                  routesFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-white">
                      <FileSpreadsheet className="h-4 w-4 text-sky-400" />
                      2. Backend Routes
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      .csv / .json
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                    Routes implemented in code (with{" "}
                    <code className="text-zinc-300">method</code> &amp;{" "}
                    <code className="text-zinc-300">path</code>).
                  </p>
                </div>

                <div className="pt-4">
                  {routesFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-2.5 text-xs text-emerald-200">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCheck2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="font-mono truncate">
                          {routesFile.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRoutesFile(null)}
                        className="p-1 text-emerald-300 hover:text-white shrink-0"
                        title="Remove file"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex items-center justify-center gap-2 w-full rounded-lg border border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-900 py-3 px-4 text-xs sm:text-sm font-medium text-zinc-200 transition">
                      <Plus className="h-4 w-4 text-sky-400" />
                      <span>Select Routes File</span>
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={(e) =>
                          setRoutesFile(e.target.files?.[0] || null)
                        }
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Card 3: Traffic Logs */}
              <div
                className={`rounded-xl border p-5 flex flex-col justify-between transition ${
                  logsFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-semibold text-white">
                      <FileSpreadsheet className="h-4 w-4 text-amber-400" />
                      3. Traffic Logs
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      .csv / .json
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                    Observed gateway/access logs (
                    <code className="text-zinc-300">
                      timestamp, method, path, status_code
                    </code>
                    ).
                  </p>
                </div>

                <div className="pt-4">
                  {logsFile ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-2.5 text-xs text-emerald-200">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCheck2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="font-mono truncate">
                          {logsFile.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLogsFile(null)}
                        className="p-1 text-emerald-300 hover:text-white shrink-0"
                        title="Remove file"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex items-center justify-center gap-2 w-full rounded-lg border border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-900 py-3 px-4 text-xs sm:text-sm font-medium text-zinc-200 transition">
                      <Plus className="h-4 w-4 text-amber-400" />
                      <span>Select Traffic Logs</span>
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={(e) =>
                          setLogsFile(e.target.files?.[0] || null)
                        }
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Submit Bar */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-4 border-t border-zinc-800/80">
              <div className="w-full sm:max-w-xs">
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Report Name{" "}
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

              <button
                type="submit"
                disabled={isStartingAnalysis}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
              >
                {isStartingAnalysis ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span>
                  Run Analysis
                  {uploadedFilesCount > 0
                    ? ` (${uploadedFilesCount} file${
                        uploadedFilesCount > 1 ? "s" : ""
                      })`
                    : ""}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODE 3: SAVED REPORTS HISTORY
         ===================================================================== */}
      {mode === "history" && (
        <div className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 sm:p-8 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-semibold text-white">
                Saved Autopsy Reports
              </h1>
              <p className="text-sm text-zinc-400">
                Open any previous scan saved in the local SQLite database or
                export its audit report.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMode("live")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium bg-emerald-400 hover:bg-emerald-300 text-zinc-950 transition shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Start New Scan</span>
            </button>
          </div>

          {historyAnalyses.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-10 text-center space-y-3">
              <Database className="h-7 w-7 text-zinc-500 mx-auto" />
              <div className="text-base font-medium text-zinc-200">
                No saved autopsy reports yet
              </div>
              <p className="text-sm text-zinc-400 max-w-md mx-auto">
                Run a Live API scan, upload static files, or load the Sample
                Demo. Completed reports are saved automatically.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onLoadDemo}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Load Sample Demo</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
              {historyAnalyses.map((item) => {
                const totalFindings = item.summary?.total_findings ?? 0;
                const totalEndpoints =
                  item.summary?.total_unique_endpoints ?? totalFindings;
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
                          {totalEndpoints} endpoints • {totalFindings} issues
                        </span>
                        {item.is_demo && (
                          <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            Demo
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400">
                        Scanned:{" "}
                        <code className="text-zinc-300">
                          {item.created_at.replace("T", " ").slice(0, 19)} UTC
                        </code>
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
                          title="Delete report"
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

      {/* Compact Recent Reports Strip when on Live or Files mode */}
      {mode !== "history" && historyAnalyses.length > 0 && (
        <div className="rounded-xl border border-zinc-800/80 bg-[#111113]/80 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm text-zinc-300 min-w-0">
            <History className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="font-medium text-white shrink-0">
              Recent Scans:
            </span>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              {historyAnalyses.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    onSelectHistoryAnalysis && onSelectHistoryAnalysis(item)
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 whitespace-nowrap transition"
                >
                  <span className="truncate max-w-[180px]">{item.name}</span>
                  <span className="text-zinc-400 font-mono">→</span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMode("history")}
            className="text-xs font-medium text-amber-400 hover:underline shrink-0 self-end sm:self-auto"
          >
            View all ({historyAnalyses.length}) →
          </button>
        </div>
      )}
    </div>
  );
}

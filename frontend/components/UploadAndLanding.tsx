"use client";

import React from "react";
import {
  ArrowRight,
  FileCode,
  FileSpreadsheet,
  Loader2,
  Play,
  Upload,
  X,
} from "lucide-react";

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
}: UploadAndLandingProps) {
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
              Compare your <strong className="text-zinc-200 font-medium">OpenAPI spec</strong>,{" "}
              <strong className="text-zinc-200 font-medium">backend routes</strong>, and{" "}
              <strong className="text-zinc-200 font-medium">traffic logs</strong> in one place.
              Spot missing route handlers, shadow endpoints, and retirement candidates with
              clear evidence.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-4">
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
              <span className="text-sm text-zinc-500">
                Loads a ready-to-explore sample dataset in one click
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Clean Upload Form Card */}
      <form
        onSubmit={onSubmitCustom}
        className="rounded-xl border border-zinc-800/90 bg-[#111113] p-6 sm:p-8 space-y-6"
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-white">
              {isModal ? "Start a New Analysis" : "Or Upload Your Own Files"}
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Upload any combination of files below to compare them.
            </p>
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

        {/* 3 Upload Cards */}
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
                onChange={(e) => setOpenapiFile(e.target.files?.[0] || null)}
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
                Routes registered in code (needs <code className="text-zinc-300">method</code> and{" "}
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
                Observed traffic logs (<code className="text-zinc-300">timestamp, method, path, status_code</code>).
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
              Analysis Name <span className="text-zinc-500 font-normal">(optional)</span>
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
    </div>
  );
}

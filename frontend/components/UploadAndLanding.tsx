"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  FileCode,
  FileSpreadsheet,
  GitCompare,
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
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Hero / Quick Start Card */}
      {!isModal && (
        <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 sm:p-8">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded">
              <GitCompare className="h-3.5 w-3.5 text-emerald-400" />
              <span>CONTRACT vs IMPLEMENTATION vs TRAFFIC</span>
            </div>

            <h1 className="text-xl sm:text-3xl font-semibold text-zinc-100 tracking-tight">
              Investigate API drift and retirement candidates with source evidence.
            </h1>

            <p className="text-sm text-zinc-400 leading-relaxed">
              Compare your declared <strong className="text-zinc-200">OpenAPI 3.x spec</strong>,
              implemented <strong className="text-zinc-200">backend route inventory</strong>, and
              observed <strong className="text-zinc-200">request logs</strong>. API Graveyard
              Autopsy flags undocumented endpoints, missing route handlers, and unobserved
              endpoints—while preserving strict guardrails so &ldquo;not observed in logs&rdquo;
              is never conflated with &ldquo;safe to delete.&rdquo;
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={onLoadDemo}
                disabled={isStartingAnalysis}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-xs sm:text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
              >
                {isStartingAnalysis ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                <span>Try Built-in Demo Dataset</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-zinc-500 font-mono">
                Loads sample-data/ (9 OpenAPI paths, 12 routes, 14-day logs)
              </span>
            </div>
          </div>

          {/* 3-Column Source Explanation */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-zinc-800/80 text-xs">
            <div className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-800/80 space-y-1">
              <div className="font-mono font-semibold text-zinc-200 flex items-center justify-between">
                <span>1. Declared (OpenAPI)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  JSON / YAML
                </span>
              </div>
              <p className="text-zinc-400">
                What your API documentation promises to clients and SDKs.
              </p>
            </div>

            <div className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-800/80 space-y-1">
              <div className="font-mono font-semibold text-zinc-200 flex items-center justify-between">
                <span>2. Implemented (Routes)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  CSV / JSON
                </span>
              </div>
              <p className="text-zinc-400">
                Routes actually registered in your backend framework routers.
              </p>
            </div>

            <div className="p-3.5 rounded-md bg-zinc-950/70 border border-zinc-800/80 space-y-1">
              <div className="font-mono font-semibold text-zinc-200 flex items-center justify-between">
                <span>3. Observed (Traffic Logs)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  CSV / JSON
                </span>
              </div>
              <p className="text-zinc-400">
                Requests captured during a specific log observation window.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload Form Card */}
      <form
        onSubmit={onSubmitCustom}
        className="rounded-lg border border-zinc-800 bg-[#111113] p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3.5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Upload Custom Inventory & Logs
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Provide at least one source file (max 5 MB per file). Partial comparisons are
              supported if a source is omitted.
            </p>
          </div>
          {isModal && onCloseModal && (
            <button
              type="button"
              onClick={onCloseModal}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            Analysis Label <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            type="text"
            value={analysisName}
            onChange={(e) => setAnalysisName(e.target.value)}
            placeholder="e.g., Payments Service v2 Audit"
            className="w-full sm:max-w-md rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* OpenAPI Input */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                <span className="flex items-center gap-1.5">
                  <FileCode className="h-3.5 w-3.5 text-zinc-400" />
                  OpenAPI 3.x Spec
                </span>
                <span className="text-[10px] font-mono text-zinc-500">.json / .yaml</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Extracts declared HTTP methods, path templates, and owner metadata.
              </p>
            </div>

            <div>
              <input
                type="file"
                accept=".json,.yaml,.yml"
                onChange={(e) => setOpenapiFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-zinc-400 file:mr-2.5 file:py-1.5 file:px-2.5 file:rounded file:border file:border-zinc-700 file:text-xs file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
              />
              {openapiFile && (
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                  <span className="truncate">{openapiFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setOpenapiFile(null)}
                    className="text-zinc-400 hover:text-white ml-2"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Route Inventory Input */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-zinc-400" />
                  Route Inventory
                </span>
                <span className="text-[10px] font-mono text-zinc-500">.csv / .json</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Required fields: <code className="text-zinc-400">method, path</code>. Optional:{" "}
                <code className="text-zinc-400">framework, source_file, line_number</code>.
              </p>
            </div>

            <div>
              <input
                type="file"
                accept=".csv,.json"
                onChange={(e) => setRoutesFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-zinc-400 file:mr-2.5 file:py-1.5 file:px-2.5 file:rounded file:border file:border-zinc-700 file:text-xs file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
              />
              {routesFile && (
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                  <span className="truncate">{routesFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setRoutesFile(null)}
                    className="text-zinc-400 hover:text-white ml-2"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Request Logs Input */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-zinc-400" />
                  Request Logs
                </span>
                <span className="text-[10px] font-mono text-zinc-500">.csv / .json</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Required fields:{" "}
                <code className="text-zinc-400">timestamp, method, path, status_code</code>.
              </p>
            </div>

            <div>
              <input
                type="file"
                accept=".csv,.json"
                onChange={(e) => setLogsFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-zinc-400 file:mr-2.5 file:py-1.5 file:px-2.5 file:rounded file:border file:border-zinc-700 file:text-xs file:font-medium file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800 cursor-pointer"
              />
              {logsFile && (
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                  <span className="truncate">{logsFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setLogsFile(null)}
                    className="text-zinc-400 hover:text-white ml-2"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-zinc-800/80">
          <div className="flex items-start sm:items-center gap-2 text-[11px] text-zinc-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              Files are parsed as data and never executed. Avoid uploading unredacted
              production credentials.
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isModal && onCloseModal && (
              <button
                type="button"
                onClick={onCloseModal}
                className="px-3 py-2 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isStartingAnalysis}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              <span>Run Autopsy Analysis</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

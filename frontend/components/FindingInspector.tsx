"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Terminal,
  X,
} from "lucide-react";
import { Finding } from "@/lib/types";
import { MethodBadge, getSeverityStyle } from "./Badges";

interface FindingInspectorProps {
  finding: Finding | null;
  sourcesSupplied: string[];
  checkedSteps: Record<string, boolean>;
  onToggleChecklist: (findingId: string, idx: number) => void;
  isInvestigating: boolean;
  onInvestigate: (finding: Finding) => void;
  onCloseMobileDrawer: () => void;
}

export function FindingInspector({
  finding,
  sourcesSupplied,
  checkedSteps,
  onToggleChecklist,
  isInvestigating,
  onInvestigate,
  onCloseMobileDrawer,
}: FindingInspectorProps) {
  if (!finding) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-[#111113] p-8 text-center text-xs text-zinc-500">
        Select a finding from the list to inspect source evidence and verification steps.
      </div>
    );
  }

  const completedChecks = finding.recommended_checks.filter(
    (_, idx) => !!checkedSteps[`${finding.id}:${idx}`]
  ).length;

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#111113] flex flex-col overflow-hidden">
      {/* Mobile/Tablet Sticky Top Bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <button
          onClick={onCloseMobileDrawer}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Findings</span>
        </button>
        <button
          onClick={onCloseMobileDrawer}
          className="p-1 rounded text-zinc-400 hover:text-white"
          aria-label="Close inspector"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Inspector Header */}
      <div className="p-4 sm:p-5 border-b border-zinc-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-zinc-400">
              {finding.id}
            </span>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded border ${getSeverityStyle(
                finding.severity
              )}`}
            >
              {finding.severity}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Review Priority</span>
            <span className="text-sm font-mono font-bold tabular-nums text-zinc-100 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded">
              {finding.review_priority_score}/100
            </span>
          </div>
        </div>

        <div className="flex items-start gap-2.5 break-all">
          <div className="mt-0.5 shrink-0">
            <MethodBadge method={finding.method} />
          </div>
          <h3 className="text-sm sm:text-base font-mono font-semibold text-zinc-100 leading-snug">
            {finding.path}
          </h3>
        </div>

        <div className="text-xs font-medium text-zinc-300">
          {finding.category}
        </div>
      </div>

      {/* Inspector Body */}
      <div className="p-4 sm:p-5 space-y-5 text-xs">
        {/* 3-Source Evidence Matrix */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
            Cross-Source Presence
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { key: "openapi", label: "OpenAPI Spec" },
                { key: "routes", label: "Route Inventory" },
                { key: "logs", label: "Request Logs" },
              ] as const
            ).map((src) => {
              const isSupplied = sourcesSupplied.includes(src.key);
              const isPresent = finding.sources_present.includes(src.key);
              const origPaths = finding.original_paths[src.key] || [];

              return (
                <div
                  key={src.key}
                  className={`rounded-md p-2.5 border ${
                    !isSupplied
                      ? "bg-zinc-950 border-zinc-900 text-zinc-600"
                      : isPresent
                      ? "bg-zinc-900/90 border-zinc-700 text-zinc-200"
                      : "bg-zinc-950/80 border-zinc-800/80 text-zinc-500"
                  }`}
                >
                  <div className="flex items-center justify-between font-medium">
                    <span>{src.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                        !isSupplied
                          ? "text-zinc-600"
                          : isPresent
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {!isSupplied
                        ? "N/A"
                        : isPresent
                        ? "PRESENT"
                        : "ABSENT"}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono mt-1.5 truncate text-zinc-400">
                    {!isSupplied
                      ? "Source not uploaded"
                      : isPresent
                      ? origPaths[0] || finding.path
                      : "Not found in source"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Traffic Telemetry Bar (when logs uploaded) */}
        {sourcesSupplied.includes("logs") && (
          <div className="rounded-md border border-zinc-800/90 bg-zinc-950 p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-zinc-500">Observed Requests: </span>
              <span className="font-mono font-semibold text-zinc-200 tabular-nums">
                {finding.request_count}
              </span>
            </div>
            {finding.last_seen && (
              <div>
                <span className="text-zinc-500">Last Seen: </span>
                <span className="font-mono text-zinc-300">
                  {finding.last_seen.slice(0, 19).replace("T", " ")}Z
                </span>
              </div>
            )}
            {Object.keys(finding.status_code_counts).length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500">Status:</span>
                {Object.entries(finding.status_code_counts).map(([code, cnt]) => (
                  <span
                    key={code}
                    className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px]"
                  >
                    {code}: {cnt}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deterministic Source Evidence */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
            Deterministic Evidence
          </h4>
          <ul className="space-y-1.5 rounded-md border border-zinc-800/90 bg-zinc-950 p-3 text-zinc-300">
            {finding.evidence.map((ev, i) => (
              <li key={i} className="flex items-start gap-2 leading-relaxed">
                <span className="text-emerald-400 font-mono shrink-0 mt-0.5">
                  •
                </span>
                <span>{ev}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Score Breakdown */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              Review Priority Score Factors ({finding.review_priority_score}/100)
            </h4>
          </div>
          <ul className="space-y-1.5 rounded-md border border-zinc-800/90 bg-zinc-950 p-3 text-zinc-300">
            {finding.score_reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 font-mono text-[11px]">
                <span className="text-zinc-500 shrink-0">-</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Limitations & Caveats */}
        <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Interpretation Caveats (What This Cannot Prove)</span>
          </div>
          <ul className="space-y-1 text-zinc-300 pl-5 list-disc">
            {finding.limitations.map((lim, i) => (
              <li key={i} className="leading-relaxed">
                {lim}
              </li>
            ))}
          </ul>
        </div>

        {/* Interactive Human Verification Checklist */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              Human Verification Checklist
            </h4>
            <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
              {completedChecks}/{finding.recommended_checks.length} verified
            </span>
          </div>

          <div className="divide-y divide-zinc-800/70 rounded-md border border-zinc-800/90 bg-zinc-950">
            {finding.recommended_checks.map((chk, idx) => {
              const checked = !!checkedSteps[`${finding.id}:${idx}`];
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onToggleChecklist(finding.id, idx)}
                  className="w-full text-left p-2.5 flex items-start gap-2.5 hover:bg-zinc-900/60 transition"
                >
                  <span
                    className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition ${
                      checked
                        ? "bg-emerald-500 border-emerald-500 text-zinc-950"
                        : "border-zinc-700 bg-zinc-900"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3 stroke-[3]" />}
                  </span>
                  <span
                    className={`leading-relaxed ${
                      checked ? "line-through text-zinc-500" : "text-zinc-200"
                    }`}
                  >
                    {chk}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grounded AI Investigation Section */}
        <div className="pt-3 border-t border-zinc-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                <span>AI Evidence Investigation</span>
              </h4>
              <p className="text-[11px] text-zinc-500">
                Analyzes sanitized finding metadata. Cannot alter deterministic scores.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onInvestigate(finding)}
              disabled={isInvestigating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50 shrink-0"
            >
              {isInvestigating && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              <span>
                {finding.ai_explanation
                  ? "Re-run Investigation"
                  : "Investigate with AI"}
              </span>
            </button>
          </div>

          {finding.ai_explanation && (
            <div className="rounded-md border border-zinc-700/80 bg-zinc-950 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                      finding.ai_explanation.is_fallback
                        ? "bg-amber-500/10 text-amber-300 border-amber-500/25"
                        : "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                    }`}
                  >
                    {finding.ai_explanation.is_fallback
                      ? "DETERMINISTIC FALLBACK"
                      : `GEMINI (${finding.ai_explanation.model})`}
                  </span>
                  {finding.ai_explanation.cached && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-800">
                      REDIS CACHED
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-500">
                  {finding.ai_explanation.status_message}
                </span>
              </div>

              <p className="text-zinc-200 leading-relaxed">
                {finding.ai_explanation.summary}
              </p>

              <div className="space-y-1">
                <div className="text-[11px] font-mono text-zinc-400">
                  Evidence Interpretation:
                </div>
                <ul className="space-y-1 text-zinc-300 pl-4 list-disc">
                  {finding.ai_explanation.evidence_interpretation.map(
                    (item, i) => (
                      <li key={i}>{item}</li>
                    )
                  )}
                </ul>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-mono text-zinc-400">
                  Caveats & Uncertainties:
                </div>
                <ul className="space-y-1 text-amber-200/80 pl-4 list-disc">
                  {finding.ai_explanation.caveats.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

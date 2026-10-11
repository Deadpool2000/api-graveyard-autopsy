"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Sparkles,
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
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-10 text-center text-sm text-zinc-400">
        Select an endpoint from the list to view its details and verification steps.
      </div>
    );
  }

  const completedChecks = finding.recommended_checks.filter(
    (_, idx) => !!checkedSteps[`${finding.id}:${idx}`]
  ).length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111113] flex flex-col overflow-hidden">
      {/* Mobile/Tablet Sticky Top Bar */}
      <div className="lg:hidden flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950">
        <button
          type="button"
          onClick={onCloseMobileDrawer}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Findings</span>
        </button>
        <button
          type="button"
          onClick={onCloseMobileDrawer}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
          aria-label="Close inspector"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Inspector Header */}
      <div className="p-5 sm:p-6 border-b border-zinc-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-md border ${getSeverityStyle(
              finding.severity
            )}`}
          >
            {finding.severity} Priority
          </span>

          <span className="text-sm font-mono text-zinc-400">
            Score:{" "}
            <strong className="text-zinc-100">{finding.review_priority_score}/100</strong>
          </span>
        </div>

        <div className="flex items-start gap-3 break-all pt-1">
          <div className="mt-0.5 shrink-0">
            <MethodBadge method={finding.method} />
          </div>
          <h3 className="text-base sm:text-lg font-mono font-semibold text-white leading-snug">
            {finding.path}
          </h3>
        </div>

        <div className="text-sm font-medium text-zinc-300">
          {finding.category}
        </div>
      </div>

      {/* Inspector Body */}
      <div className="p-5 sm:p-6 space-y-6 text-sm">
        {/* 1. Where was it found? */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Source Status
          </h4>
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { key: "openapi", label: "API Docs" },
                { key: "routes", label: "Backend Code" },
                { key: "logs", label: "Traffic Logs" },
              ] as const
            ).map((src) => {
              const isSupplied = sourcesSupplied.includes(src.key);
              const isPresent = finding.sources_present.includes(src.key);

              return (
                <div
                  key={src.key}
                  className={`rounded-lg p-3 border ${
                    !isSupplied
                      ? "bg-zinc-950 border-zinc-900 text-zinc-600"
                      : isPresent
                      ? "bg-emerald-500/10 border-emerald-500/30 text-zinc-100"
                      : "bg-zinc-950 border-zinc-800 text-zinc-400"
                  }`}
                >
                  <div className="text-xs text-zinc-400">{src.label}</div>
                  <div className="font-semibold mt-1 text-sm">
                    {!isSupplied ? (
                      "Not uploaded"
                    ) : src.key === "logs" && isPresent ? (
                      <span className="text-emerald-300">
                        {finding.request_count} reqs
                      </span>
                    ) : isPresent ? (
                      <span className="text-emerald-300">Found</span>
                    ) : (
                      <span className="text-zinc-500">Missing</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Key Evidence */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Why This Was Flagged
          </h4>
          <ul className="space-y-2 rounded-lg border border-zinc-800/90 bg-zinc-950 p-4 text-zinc-200">
            {finding.evidence.map((ev, i) => (
              <li key={i} className="flex items-start gap-2.5 leading-relaxed">
                <span className="text-emerald-400 font-bold shrink-0">•</span>
                <span>{ev}</span>
              </li>
            ))}
            {finding.last_seen && (
              <li className="flex items-start gap-2.5 leading-relaxed text-zinc-400 pt-1 border-t border-zinc-900">
                <span className="text-zinc-500 shrink-0">•</span>
                <span>
                  Last seen in logs:{" "}
                  <code className="text-zinc-300">
                    {finding.last_seen.slice(0, 19).replace("T", " ")} UTC
                  </code>
                </span>
              </li>
            )}
          </ul>
        </div>

        {/* 3. Verification Checklist */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Recommended Next Steps
            </h4>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              {completedChecks}/{finding.recommended_checks.length} done
            </span>
          </div>

          <div className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800/90 bg-zinc-950">
            {finding.recommended_checks.map((chk, idx) => {
              const checked = !!checkedSteps[`${finding.id}:${idx}`];
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onToggleChecklist(finding.id, idx)}
                  className="w-full text-left p-3.5 flex items-start gap-3 hover:bg-zinc-900/60 transition"
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

        {/* 4. Caveats */}
        {finding.limitations.length > 0 && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Keep in Mind</span>
            </div>
            <ul className="space-y-1.5 text-zinc-300 pl-5 list-disc leading-relaxed">
              {finding.limitations.map((lim, i) => (
                <li key={i}>{lim}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 5. AI Explanation */}
        <div className="pt-4 border-t border-zinc-800 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-zinc-100">
                AI Assistant
              </h4>
              <p className="text-xs text-zinc-400">
                Get a plain-English explanation of this finding.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onInvestigate(finding)}
              disabled={isInvestigating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50 shrink-0"
            >
              {isInvestigating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>
                {finding.ai_explanation ? "Refresh Explanation" : "Explain Finding"}
              </span>
            </button>
          </div>

          {finding.ai_explanation && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
              <p className="text-zinc-100 leading-relaxed">
                {finding.ai_explanation.summary}
              </p>

              {finding.ai_explanation.evidence_interpretation.length > 0 && (
                <ul className="space-y-1.5 text-zinc-300 pl-5 list-disc leading-relaxed">
                  {finding.ai_explanation.evidence_interpretation.map(
                    (item, i) => (
                      <li key={i}>{item}</li>
                    )
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

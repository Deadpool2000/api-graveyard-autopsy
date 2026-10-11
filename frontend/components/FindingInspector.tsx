"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Finding } from "@/lib/types";
import { MethodBadge, getSeverityStyle } from "./Badges";

interface FindingInspectorProps {
  finding: Finding | null;
  relatedFindings?: Finding[];
  sourcesSupplied: string[];
  checkedSteps: Record<string, boolean>;
  onToggleChecklist: (findingId: string, idx: number) => void;
  isInvestigating: boolean;
  onInvestigate: (finding: Finding) => void;
  onCloseMobileDrawer: () => void;
}

export function FindingInspector({
  finding,
  relatedFindings,
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
        Select an endpoint from the list on the left to inspect its status,
        evidence, and next steps.
      </div>
    );
  }

  const group =
    relatedFindings && relatedFindings.length > 0 ? relatedFindings : [finding];

  // Unique categories for this endpoint
  const categories = Array.from(new Set(group.map((f) => f.category)));

  // Deduplicated evidence lines across grouped findings
  const mergedEvidence = Array.from(
    new Set(group.flatMap((f) => f.evidence))
  );

  // Deduplicated recommended checks
  const mergedChecks = Array.from(
    new Set(group.flatMap((f) => f.recommended_checks))
  );

  // Deduplicated caveats
  const mergedLimitations = Array.from(
    new Set(group.flatMap((f) => f.limitations))
  );

  // Find any existing AI explanation in the group
  const activeAiExplanation =
    group.find((f) => f.ai_explanation)?.ai_explanation ||
    finding.ai_explanation;

  const completedChecks = mergedChecks.filter(
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
          <span>Back to Endpoints</span>
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

      {/* Inspector Header with Top-Level AI Explain CTA */}
      <div className="p-5 border-b border-zinc-800/90 bg-zinc-950/40 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-md border ${getSeverityStyle(
                finding.severity
              )}`}
            >
              {finding.severity} Priority
            </span>
            <span className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
              Score: <strong className="text-white">{finding.review_priority_score}/100</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={() => onInvestigate(finding)}
            disabled={isInvestigating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-400 hover:bg-emerald-300 text-zinc-950 transition disabled:opacity-50 shrink-0"
          >
            {isInvestigating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>
              {activeAiExplanation ? "Refresh AI Explain" : "AI Explain"}
            </span>
          </button>
        </div>

        <div className="flex items-start gap-2.5 break-all">
          <div className="mt-0.5 shrink-0">
            <MethodBadge method={finding.method} />
          </div>
          <h3 className="text-base sm:text-lg font-mono font-semibold text-white leading-snug">
            {finding.path}
          </h3>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <span
              key={cat}
              className="text-xs font-medium px-2.5 py-1 rounded-md bg-zinc-900 text-zinc-200 border border-zinc-800"
            >
              {cat}
            </span>
          ))}
        </div>
      </div>

      {/* Inspector Body */}
      <div className="p-5 space-y-5 text-sm">
        {/* AI Explanation Card (Shown right at the top when generated!) */}
        {activeAiExplanation && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Plain-English Explanation</span>
            </div>
            <p className="text-zinc-100 leading-relaxed text-sm">
              {activeAiExplanation.summary}
            </p>
            {activeAiExplanation.evidence_interpretation.length > 0 && (
              <ul className="space-y-1 text-xs text-zinc-300 pl-4 list-disc leading-relaxed">
                {activeAiExplanation.evidence_interpretation.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 1. Visual 3-Column Source Comparison */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Where Was This Endpoint Found?
          </h4>
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { key: "openapi", label: "1. OpenAPI Docs" },
                { key: "routes", label: "2. Backend Code" },
                { key: "logs", label: "3. Traffic Logs" },
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
                      : "bg-rose-500/5 border-rose-500/20 text-zinc-300"
                  }`}
                >
                  <div className="text-[11px] font-medium text-zinc-400">
                    {src.label}
                  </div>
                  <div className="font-semibold mt-1.5 text-xs sm:text-sm flex items-center gap-1.5">
                    {!isSupplied ? (
                      <span className="text-zinc-500">Not uploaded</span>
                    ) : src.key === "logs" && isPresent ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-emerald-300">
                          {finding.request_count} req
                          {finding.request_count === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : isPresent ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-emerald-300">Found</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                        <span className="text-rose-300">Missing</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Key Evidence */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Why This Was Flagged
          </h4>
          <ul className="space-y-2 rounded-lg border border-zinc-800/90 bg-zinc-950 p-3.5 text-xs sm:text-sm text-zinc-200">
            {mergedEvidence.map((ev, i) => (
              <li key={i} className="flex items-start gap-2 leading-relaxed">
                <span className="text-emerald-400 font-bold shrink-0">•</span>
                <span>{ev}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 3. Interactive Verification Checklist */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Recommended Verification Steps
            </h4>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              {completedChecks}/{mergedChecks.length} done
            </span>
          </div>

          <div className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800/90 bg-zinc-950">
            {mergedChecks.map((chk, idx) => {
              const checked = !!checkedSteps[`${finding.id}:${idx}`];
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onToggleChecklist(finding.id, idx)}
                  className="w-full text-left p-3 flex items-start gap-3 hover:bg-zinc-900/60 transition text-xs sm:text-sm"
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

        {/* 4. Compact Caveat Footer */}
        {mergedLimitations.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Keep in Mind Before Removing Code</span>
            </div>
            <ul className="space-y-1 text-zinc-300 pl-4 list-disc leading-relaxed">
              {mergedLimitations.slice(0, 2).map((lim, i) => (
                <li key={i}>{lim}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

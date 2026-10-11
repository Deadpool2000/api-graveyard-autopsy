"use client";

import React from "react";
import {
  AlertCircle,
  Loader2,
  Send,
} from "lucide-react";
import {
  AnalysisSummary,
  ChatResponseRecord,
  ExecutiveSummaryRecord,
  InvestigationPlanRecord,
  SourceFileMetadata,
} from "@/lib/types";
import { getReportDownloadUrl } from "@/lib/api";

const PRESET_QUESTIONS = [
  "Which findings should I investigate first, and why?",
  "Which undocumented endpoints are actively receiving traffic?",
  "Why aren't unobserved endpoints automatically safe to delete?",
];

export function PlanAndSummaryTab({
  executiveSummary,
  investigationPlan,
  isGeneratingSummary,
  isGeneratingPlan,
  onGenerateSummary,
  onGeneratePlan,
  onJumpToFinding,
}: {
  executiveSummary: ExecutiveSummaryRecord | null;
  investigationPlan: InvestigationPlanRecord | null;
  isGeneratingSummary: boolean;
  isGeneratingPlan: boolean;
  onGenerateSummary: () => void;
  onGeneratePlan: () => void;
  onJumpToFinding: (findingId: string) => void;
}) {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Action Header */}
      <div className="rounded-lg border border-zinc-800 bg-[#111113] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-100">
            Verification Plan & Executive Summary
          </h2>
          <p className="text-xs text-zinc-400">
            Generate a prioritized human verification plan or executive summary grounded
            in deterministic findings. Never executes automatic deletions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onGeneratePlan}
            disabled={isGeneratingPlan}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
          >
            {isGeneratingPlan && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>
              {investigationPlan
                ? "Regenerate Verification Plan"
                : "Generate Verification Plan"}
            </span>
          </button>

          <button
            onClick={onGenerateSummary}
            disabled={isGeneratingSummary}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition disabled:opacity-50"
          >
            {isGeneratingSummary && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            <span>
              {executiveSummary
                ? "Regenerate Executive Summary"
                : "Generate Executive Summary"}
            </span>
          </button>
        </div>
      </div>

      {!investigationPlan && !executiveSummary && (
        <div className="rounded-lg border border-zinc-800/80 bg-[#111113] p-8 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-300">
            No verification plan or summary generated yet for this session.
          </p>
          <p className="text-xs text-zinc-500">
            AI calls are strictly user-triggered to respect Gemini free-tier quotas. Click{" "}
            <strong className="text-zinc-300">Generate Verification Plan</strong> above to
            build a step-by-step review checklist.
          </p>
        </div>
      )}

      {/* Executive Summary Card */}
      {executiveSummary && (
        <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-300">
                Executive Summary
              </h3>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  executiveSummary.is_fallback
                    ? "bg-amber-500/10 border-amber-500/25 text-amber-300"
                    : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                }`}
              >
                {executiveSummary.is_fallback
                  ? "DETERMINISTIC FALLBACK"
                  : `GEMINI (${executiveSummary.model})`}
              </span>
              {executiveSummary.cached && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  REDIS CACHED
                </span>
              )}
            </div>
            <span className="text-[11px] text-zinc-500">
              {executiveSummary.status_message}
            </span>
          </div>

          <p className="text-sm font-medium text-zinc-100">
            {executiveSummary.headline}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="rounded-md bg-zinc-950 border border-zinc-800/80 p-3.5 space-y-2">
              <div className="font-mono text-[11px] text-zinc-400">
                Key Cross-Source Observations
              </div>
              <ul className="space-y-1.5 text-zinc-300 list-disc pl-4">
                {executiveSummary.key_observations.map((obs, idx) => (
                  <li key={idx}>{obs}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-md bg-zinc-950 border border-zinc-800/80 p-3.5 space-y-2">
              <div className="font-mono text-[11px] text-zinc-400">
                Priority Focus Areas
              </div>
              <ul className="space-y-1.5 text-zinc-300 list-disc pl-4">
                {executiveSummary.priority_focus_areas.map((fa, idx) => (
                  <li key={idx}>{fa}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Prioritized Investigation Plan */}
      {investigationPlan && (
        <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-300">
                Prioritized Human Verification Plan
              </h3>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  investigationPlan.is_fallback
                    ? "bg-amber-500/10 border-amber-500/25 text-amber-300"
                    : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                }`}
              >
                {investigationPlan.is_fallback
                  ? "DETERMINISTIC PLAN"
                  : `GEMINI (${investigationPlan.model})`}
              </span>
              {investigationPlan.cached && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  REDIS CACHED
                </span>
              )}
            </div>
            <span className="text-[11px] text-zinc-500">
              {investigationPlan.status_message}
            </span>
          </div>

          <p className="text-xs text-zinc-300">{investigationPlan.overview}</p>

          <div className="space-y-3">
            {investigationPlan.steps.map((step) => (
              <div
                key={step.priority_order}
                className="rounded-md border border-zinc-800 bg-zinc-950 p-4 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-100">
                    Phase {step.priority_order}: {step.title}
                  </span>
                  {step.finding_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {step.finding_ids.map((fid) => (
                        <button
                          key={fid}
                          onClick={() => onJumpToFinding(fid)}
                          className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition"
                        >
                          {fid} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-zinc-400">{step.rationale}</p>

                <ul className="space-y-1 text-zinc-300 list-disc pl-4 pt-1">
                  {step.verification_criteria.map((vc, i) => (
                    <li key={i}>{vc}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AskAnalysisTab({
  chatQuestion,
  setChatQuestion,
  isAskingChat,
  chatHistory,
  onAskQuestion,
  onJumpToFinding,
}: {
  chatQuestion: string;
  setChatQuestion: (v: string) => void;
  isAskingChat: boolean;
  chatHistory: ChatResponseRecord[];
  onAskQuestion: (preset?: string) => void;
  onJumpToFinding: (findingId: string) => void;
}) {
  return (
    <div className="max-w-4xl space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-100">
            Ask This Analysis (Grounded Q&A)
          </h2>
          <p className="text-xs text-zinc-400">
            Answers are grounded strictly in the structured findings and metadata of the
            current analysis. Click any referenced finding ID to inspect its source evidence.
          </p>
        </div>

        {/* Preset Question Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAskQuestion(q)}
              disabled={isAskingChat}
              className="text-xs px-2.5 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition disabled:opacity-50 text-left"
            >
              {q}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAskQuestion();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            placeholder="Ask a question about endpoints, traffic coverage, or findings..."
            maxLength={500}
            className="flex-1 rounded-md bg-zinc-950 border border-zinc-800 px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={isAskingChat || !chatQuestion.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50 shrink-0"
          >
            {isAskingChat ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            <span>Ask</span>
          </button>
        </form>
      </div>

      {/* Chat Thread */}
      <div className="space-y-3">
        {chatHistory.length === 0 ? (
          <div className="rounded-lg border border-zinc-800/80 bg-[#111113] p-8 text-center text-xs text-zinc-500">
            Select a preset question above or type your own question to query this analysis.
          </div>
        ) : (
          chatHistory.map((item, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-zinc-800 bg-[#111113] p-4 space-y-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
                <span className="font-semibold text-zinc-100">
                  Q: {item.question}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                      item.is_fallback
                        ? "bg-amber-500/10 text-amber-300 border-amber-500/25"
                        : "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                    }`}
                  >
                    {item.is_fallback
                      ? "DETERMINISTIC LOOKUP"
                      : `GEMINI (${item.model})`}
                  </span>
                  {item.cached && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-800">
                      CACHED
                    </span>
                  )}
                </div>
              </div>

              <p className="text-zinc-200 leading-relaxed">{item.answer}</p>

              {item.referenced_finding_ids.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-zinc-500 font-mono">
                    Referenced Findings:
                  </span>
                  {item.referenced_finding_ids.map((fid) => (
                    <button
                      key={fid}
                      onClick={() => onJumpToFinding(fid)}
                      className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition"
                    >
                      {fid} →
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SourcesAndExportTab({
  analysisId,
  sourceMetadata,
  summary,
  logStart,
  logEnd,
}: {
  analysisId: string;
  sourceMetadata: SourceFileMetadata[];
  summary: AnalysisSummary;
  logStart: string | null;
  logEnd: string | null;
}) {
  return (
    <div className="max-w-4xl space-y-5 text-xs">
      <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Uploaded Input Sources & Observation Window
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-[11px] font-mono text-zinc-400 uppercase">
                <th className="py-2 pr-4">Source Type</th>
                <th className="py-2 px-4">Filename</th>
                <th className="py-2 px-4">Format</th>
                <th className="py-2 px-4">Size</th>
                <th className="py-2 pl-4 text-right">Parsed Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 font-mono">
              {sourceMetadata.map((src, i) => (
                <tr key={i} className="text-zinc-200">
                  <td className="py-2.5 pr-4 uppercase">{src.source_type}</td>
                  <td className="py-2.5 px-4">{src.filename}</td>
                  <td className="py-2.5 px-4 uppercase text-zinc-400">
                    {src.format}
                  </td>
                  <td className="py-2.5 px-4 tabular-nums text-zinc-400">
                    {src.size_bytes.toLocaleString()} B
                  </td>
                  <td className="py-2.5 pl-4 text-right tabular-nums">
                    {src.record_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3.5 space-y-1">
          <div className="font-mono text-[11px] text-zinc-400">
            Log Observation Period
          </div>
          <p className="text-zinc-200">{summary.observation_window_note}</p>
          {logStart && logEnd && (
            <p className="font-mono text-[11px] text-zinc-500">
              Range: {logStart} → {logEnd}
            </p>
          )}
        </div>
      </div>

      {/* Report Export Card */}
      <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-100">
            Export Audit Report
          </h3>
          <p className="text-zinc-400">
            Includes source metadata, deterministic findings, score factors, caveats, and
            any generated AI commentary. Raw payloads and secrets are excluded.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={getReportDownloadUrl(analysisId, "markdown")}
            download
            className="px-3.5 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition"
          >
            Download Markdown (.md)
          </a>
          <a
            href={getReportDownloadUrl(analysisId, "json")}
            download
            className="px-3.5 py-2 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition"
          >
            Download JSON (.json)
          </a>
        </div>
      </div>

      {/* Methodology & Guardrails Note */}
      <div className="rounded-lg border border-zinc-800 bg-[#111113] p-5 space-y-2">
        <div className="flex items-center gap-2 text-zinc-200 font-semibold">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          <span>Methodology & Retirement Guardrails</span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-zinc-400 leading-relaxed">
          <li>
            <strong>Not Observed ≠ Unused:</strong> Absence from a request log sample never
            proves an endpoint is dead. Seasonal reports, quarterly compliance jobs,
            disaster-recovery hooks, and internal admin workflows may not appear in a 14-day
            window.
          </li>
          <li>
            <strong>Conservative Route Normalization:</strong> Static paths like{" "}
            <code className="text-zinc-200">/api/v1/users/me</code> are preserved as
            distinct routes and never merged into parameterized templates like{" "}
            <code className="text-zinc-200">/api/v1/users/&#123;param&#125;</code>.
          </li>
          <li>
            <strong>Grounded AI:</strong> Google Gemini only interprets structured finding
            metadata upon explicit user request and cannot alter deterministic scores or
            categories.
          </li>
        </ul>
      </div>
    </div>
  );
}

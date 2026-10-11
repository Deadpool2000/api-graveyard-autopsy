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
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">
            Action Plan & Executive Summary
          </h2>
          <p className="text-sm text-zinc-400">
            Generate a step-by-step verification plan or high-level summary of your findings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onGeneratePlan}
            disabled={isGeneratingPlan}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
          >
            {isGeneratingPlan && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>
              {investigationPlan ? "Refresh Action Plan" : "Generate Action Plan"}
            </span>
          </button>

          <button
            type="button"
            onClick={onGenerateSummary}
            disabled={isGeneratingSummary}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition disabled:opacity-50"
          >
            {isGeneratingSummary && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            <span>
              {executiveSummary ? "Refresh Summary" : "Generate Summary"}
            </span>
          </button>
        </div>
      </div>

      {!investigationPlan && !executiveSummary && (
        <div className="rounded-xl border border-zinc-800/80 bg-[#111113] p-10 text-center space-y-2">
          <p className="text-base font-medium text-zinc-200">
            No plan or summary generated yet.
          </p>
          <p className="text-sm text-zinc-400">
            Click <strong className="text-zinc-200">Generate Action Plan</strong> above to create a prioritized checklist for your team.
          </p>
        </div>
      )}

      {/* Executive Summary Card */}
      {executiveSummary && (
        <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-5">
          <h3 className="text-base font-semibold text-white border-b border-zinc-800 pb-3">
            Executive Summary
          </h3>

          <p className="text-base font-medium text-zinc-100 leading-relaxed">
            {executiveSummary.headline}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
            <div className="rounded-lg bg-zinc-950 border border-zinc-800/80 p-4 space-y-2.5">
              <div className="font-semibold text-zinc-300">
                Key Observations
              </div>
              <ul className="space-y-2 text-zinc-300 list-disc pl-5 leading-relaxed">
                {executiveSummary.key_observations.map((obs, idx) => (
                  <li key={idx}>{obs}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg bg-zinc-950 border border-zinc-800/80 p-4 space-y-2.5">
              <div className="font-semibold text-zinc-300">
                Priority Focus Areas
              </div>
              <ul className="space-y-2 text-zinc-300 list-disc pl-5 leading-relaxed">
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
        <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-5">
          <h3 className="text-base font-semibold text-white border-b border-zinc-800 pb-3">
            Prioritized Action Plan
          </h3>

          <p className="text-sm text-zinc-300 leading-relaxed">
            {investigationPlan.overview}
          </p>

          <div className="space-y-4">
            {investigationPlan.steps.map((step) => (
              <div
                key={step.priority_order}
                className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 space-y-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-semibold text-white">
                    Step {step.priority_order}: {step.title}
                  </span>
                  {step.finding_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {step.finding_ids.map((fid) => (
                        <button
                          key={fid}
                          type="button"
                          onClick={() => onJumpToFinding(fid)}
                          className="text-xs font-mono px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition"
                        >
                          {fid} →
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-zinc-400 leading-relaxed">{step.rationale}</p>

                <ul className="space-y-1.5 text-zinc-200 list-disc pl-5 pt-1 leading-relaxed">
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
    <div className="max-w-4xl space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">
            Ask About This Analysis
          </h2>
          <p className="text-sm text-zinc-400">
            Ask questions about your endpoints, traffic logs, or where to start.
          </p>
        </div>

        {/* Preset Question Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAskQuestion(q)}
              disabled={isAskingChat}
              className="text-sm px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition disabled:opacity-50 text-left"
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
          className="flex items-center gap-3 pt-1"
        >
          <input
            type="text"
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            placeholder="Ask a question about endpoints, traffic, or findings..."
            maxLength={500}
            className="flex-1 rounded-lg bg-zinc-950 border border-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={isAskingChat || !chatQuestion.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50 shrink-0"
          >
            {isAskingChat ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span>Ask</span>
          </button>
        </form>
      </div>

      {/* Chat Thread */}
      <div className="space-y-4">
        {chatHistory.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/80 bg-[#111113] p-10 text-center text-sm text-zinc-400">
            Pick a suggested question above or type your own question.
          </div>
        ) : (
          chatHistory.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-zinc-800 bg-[#111113] p-5 space-y-3 text-sm"
            >
              <div className="font-semibold text-white border-b border-zinc-800/80 pb-3">
                Q: {item.question}
              </div>

              <p className="text-zinc-200 leading-relaxed">{item.answer}</p>

              {item.referenced_finding_ids.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="text-xs text-zinc-400">
                    Related Endpoints:
                  </span>
                  {item.referenced_finding_ids.map((fid) => (
                    <button
                      key={fid}
                      type="button"
                      onClick={() => onJumpToFinding(fid)}
                      className="font-mono text-xs px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition"
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
    <div className="max-w-4xl space-y-6 text-sm">
      {/* Report Export Card */}
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">
            Download Audit Report
          </h2>
          <p className="text-zinc-400">
            Export all findings, evidence, and recommendations as Markdown or JSON.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <a
            href={getReportDownloadUrl(analysisId, "markdown")}
            download
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition"
          >
            Download Markdown (.md)
          </a>
          <a
            href={getReportDownloadUrl(analysisId, "json")}
            download
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition"
          >
            Download JSON (.json)
          </a>
        </div>
      </div>

      {/* Uploaded Sources Table */}
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-4">
        <h3 className="text-base font-semibold text-white">
          Uploaded Source Files
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-xs font-semibold text-zinc-400 uppercase">
                <th className="py-3 pr-4">Source</th>
                <th className="py-3 px-4">Filename</th>
                <th className="py-3 px-4">Format</th>
                <th className="py-3 pl-4 text-right">Records Parsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {sourceMetadata.map((src, i) => (
                <tr key={i} className="text-zinc-200">
                  <td className="py-3 pr-4 font-medium uppercase">
                    {src.source_type}
                  </td>
                  <td className="py-3 px-4 font-mono">{src.filename}</td>
                  <td className="py-3 px-4 uppercase text-zinc-400">
                    {src.format}
                  </td>
                  <td className="py-3 pl-4 text-right font-mono tabular-nums">
                    {src.record_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-4 space-y-1">
          <div className="text-xs font-semibold uppercase text-zinc-400">
            Log Observation Window
          </div>
          <p className="text-zinc-200">{summary.observation_window_note}</p>
          {logStart && logEnd && (
            <p className="font-mono text-xs text-zinc-400 pt-1">
              Range: {logStart} → {logEnd}
            </p>
          )}
        </div>
      </div>

      {/* Methodology Note */}
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-3">
        <div className="flex items-center gap-2 text-white font-semibold">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          <span>How to Read These Results</span>
        </div>
        <ul className="list-disc pl-5 space-y-2 text-zinc-300 leading-relaxed">
          <li>
            <strong>Not Observed ≠ Safe to Delete:</strong> Zero traffic in a short log window
            does not prove an endpoint is dead. Always check for scheduled jobs, webhooks, or
            admin tools before removing code.
          </li>
          <li>
            <strong>Exact Route Matching:</strong> Static paths like{" "}
            <code className="text-zinc-100">/api/v1/users/me</code> are kept separate from
            parameterized routes like{" "}
            <code className="text-zinc-100">/api/v1/users/&#123;param&#125;</code>.
          </li>
        </ul>
      </div>
    </div>
  );
}

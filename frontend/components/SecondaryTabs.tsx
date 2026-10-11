"use client";

import React from "react";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import {
  AnalysisSummary,
  ChatResponseRecord,
  ExecutiveSummaryRecord,
  Finding,
  InvestigationPlanRecord,
  SourceFileMetadata,
  SuggestedQuestionsRecord,
} from "@/lib/types";
import { getReportDownloadUrl } from "@/lib/api";

function buildFindingBasedQuestions(findings: Finding[]): string[] {
  if (!findings || findings.length === 0) {
    return [
      "What sources were compared in this analysis?",
      "Why were zero discrepancies detected across the supplied API sources?",
      "What additional logs or route inventories should we supply to expand coverage?",
    ];
  }

  const questions: string[] = [];
  const top = findings[0];
  questions.push(
    `Why is ${top.method} ${top.path} (${top.id}) scored at ${top.review_priority_score}/100 and what should we verify first?`
  );

  const undoc = findings.filter(
    (f) =>
      f.category === "Observed but undocumented" ||
      f.category === "Implemented but undocumented"
  );
  if (undoc.length > 0) {
    const target = undoc[0].id === top.id && undoc.length > 1 ? undoc[1] : undoc[0];
    if (target.request_count > 0) {
      questions.push(
        `What are the security and contract risks of undocumented route ${target.method} ${target.path} (${target.request_count} requests)?`
      );
    } else {
      questions.push(
        `Why is ${target.method} ${target.path} (${target.id}) implemented in code but missing from OpenAPI?`
      );
    }
  }

  const ghosts = findings.filter(
    (f) => f.category === "Documented but not implemented"
  );
  if (ghosts.length > 0) {
    const target =
      ghosts[0].id === top.id && ghosts.length > 1 ? ghosts[1] : ghosts[0];
    questions.push(
      `Why is ${target.method} ${target.path} (${target.id}) declared in OpenAPI but missing from the route inventory?`
    );
  }

  const unobserved = findings.filter(
    (f) =>
      f.category === "Implemented but not observed" ||
      f.category === "Documented but not observed"
  );
  if (unobserved.length > 0) {
    const target =
      unobserved[0].id === top.id && unobserved.length > 1
        ? unobserved[1]
        : unobserved[0];
    questions.push(
      `Why had ${target.method} ${target.path} (${target.id}) zero observed requests, and what checks are needed before retirement?`
    );
  }

  const unique = Array.from(new Set(questions));
  for (const extra of findings.slice(1, 5)) {
    if (unique.length >= 4) break;
    const candidate = `What evidence and verification steps apply to ${extra.method} ${extra.path} (${extra.id} — ${extra.category})?`;
    if (!unique.includes(candidate)) {
      unique.push(candidate);
    }
  }

  if (unique.length < 3) {
    unique.push(
      "Why aren't endpoints with zero observed traffic automatically safe to delete?"
    );
  }

  return unique.slice(0, 4);
}

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
            Generate a step-by-step verification plan or high-level summary of your findings using Gemini AI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onGeneratePlan}
            disabled={isGeneratingPlan}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
          >
            {isGeneratingPlan ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 text-emerald-600" />
            )}
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
            {isGeneratingSummary ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 text-emerald-400" />
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
            Click <strong className="text-zinc-200">Generate Action Plan</strong> or <strong className="text-zinc-200">Generate Summary</strong> above to run Gemini AI over your findings.
          </p>
        </div>
      )}

      {/* Executive Summary Card */}
      {executiveSummary && (
        <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <h3 className="text-base font-semibold text-white">
              Executive Summary
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border ${
                !executiveSummary.is_fallback
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {!executiveSummary.is_fallback
                  ? `Gemini AI (${executiveSummary.model || "live"})`
                  : "Deterministic Fallback"}
              </span>
            </span>
          </div>

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

          {executiveSummary.status_message && (
            <p className="text-xs text-zinc-500">
              {executiveSummary.status_message}
            </p>
          )}
        </div>
      )}

      {/* Prioritized Investigation Plan */}
      {investigationPlan && (
        <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <h3 className="text-base font-semibold text-white">
              Prioritized Action Plan
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border ${
                !investigationPlan.is_fallback
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-300"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {!investigationPlan.is_fallback
                  ? `Gemini AI (${investigationPlan.model || "live"})`
                  : "Deterministic Fallback"}
              </span>
            </span>
          </div>

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

          {investigationPlan.status_message && (
            <p className="text-xs text-zinc-500">
              {investigationPlan.status_message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AskAnalysisTab({
  findings = [],
  suggestedQuestions,
  isGeneratingQuestions = false,
  onRefreshQuestions,
  chatQuestion,
  setChatQuestion,
  isAskingChat,
  chatHistory,
  onAskQuestion,
  onJumpToFinding,
}: {
  findings?: Finding[];
  suggestedQuestions?: SuggestedQuestionsRecord | null;
  isGeneratingQuestions?: boolean;
  onRefreshQuestions?: () => void;
  chatQuestion: string;
  setChatQuestion: (v: string) => void;
  isAskingChat: boolean;
  chatHistory: ChatResponseRecord[];
  onAskQuestion: (preset?: string) => void;
  onJumpToFinding: (findingId: string) => void;
}) {
  const activeQuestions =
    suggestedQuestions?.questions && suggestedQuestions.questions.length > 0
      ? suggestedQuestions.questions
      : buildFindingBasedQuestions(findings);

  const isLiveAiQuestions =
    suggestedQuestions && !suggestedQuestions.is_fallback;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Ask About This Analysis
            </h2>
            <p className="text-sm text-zinc-400">
              Click an AI-generated question tailored to your detected API findings, or ask your own.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border ${
                isLiveAiQuestions
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-zinc-900 border-zinc-800 text-zinc-300"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                {isGeneratingQuestions
                  ? "Generating AI Questions..."
                  : isLiveAiQuestions
                  ? `Gemini AI Questions (${suggestedQuestions?.model || "live"})`
                  : "Finding-Based Questions"}
              </span>
            </span>

            {onRefreshQuestions && (
              <button
                type="button"
                onClick={onRefreshQuestions}
                disabled={isGeneratingQuestions}
                title="Regenerate suggested questions with Gemini AI"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isGeneratingQuestions ? "animate-spin text-emerald-400" : ""
                  }`}
                />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>

        {/* Dynamic AI / Finding Question Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {activeQuestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onAskQuestion(q)}
              disabled={isAskingChat}
              className="text-sm px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-emerald-500/40 transition disabled:opacity-50 text-left"
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                <div className="font-semibold text-white">
                  Q: {item.question}
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${
                    !item.is_fallback
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>
                    {!item.is_fallback
                      ? `Gemini AI (${item.model || "live"})`
                      : "Deterministic Lookup"}
                  </span>
                </span>
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

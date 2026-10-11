"use client";

import React from "react";
import {
  Download,
  FileUp,
  Loader2,
  Play,
  Terminal,
} from "lucide-react";
import { getReportDownloadUrl } from "@/lib/api";
import { AnalysisResponse } from "@/lib/types";

export type ActiveTab = "findings" | "plan" | "chat" | "sources";

interface HeaderProps {
  analysis: AnalysisResponse | null;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  aiStatus: {
    enabled: boolean;
    configured: boolean;
    provider: string;
    model: string | null;
  } | null;
  redisConnected: boolean;
  isStartingAnalysis: boolean;
  onLoadDemo: () => void;
  onOpenUploadModal: () => void;
}

export function Header({
  analysis,
  activeTab,
  setActiveTab,
  aiStatus,
  redisConnected,
  isStartingAnalysis,
  onLoadDemo,
  onOpenUploadModal,
}: HeaderProps) {
  const isCompleted = analysis?.status === "completed";
  const findingCount = analysis?.summary?.total_findings ?? 0;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/90 bg-[#0a0a0c]/95 backdrop-blur-sm">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6">
        {/* Top Row */}
        <div className="h-14 flex items-center justify-between gap-2">
          {/* Brand & Active Analysis Name */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-7 w-7 rounded-md bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-zinc-200">
                <Terminal className="h-4 w-4" />
              </div>
              <span className="font-semibold text-sm tracking-tight text-zinc-100">
                API Graveyard Autopsy
              </span>
            </div>

            {analysis && (
              <>
                <span className="text-zinc-700 hidden sm:inline">/</span>
                <span className="text-xs font-mono text-zinc-400 truncate max-w-[140px] sm:max-w-[260px] hidden sm:inline">
                  {analysis.name}
                </span>
              </>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* System Status Pill */}
            <div
              className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400"
              title={
                aiStatus?.configured
                  ? `Google Gemini active (${aiStatus.model})`
                  : "Gemini API key not configured in .env — deterministic fallback active"
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  aiStatus?.configured ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span>
                {aiStatus?.configured
                  ? `Gemini (${aiStatus.model})`
                  : "Fallback Mode"}
              </span>
              <span className="text-zinc-700">•</span>
              <span>{redisConnected ? "Redis OK" : "Memory"}</span>
            </div>

            <button
              onClick={onLoadDemo}
              disabled={isStartingAnalysis}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3 w-3 fill-current" />
              )}
              <span>{analysis ? "Reload Demo" : "Load Demo"}</span>
            </button>

            <button
              onClick={onOpenUploadModal}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition"
            >
              <FileUp className="h-3.5 w-3.5 text-zinc-400" />
              <span>Upload</span>
            </button>

            {isCompleted && analysis && (
              <div className="hidden sm:flex items-center gap-1 border-l border-zinc-800 pl-2">
                <a
                  href={getReportDownloadUrl(analysis.id, "markdown")}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-mono text-zinc-300 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
                  title="Download Markdown Audit Report"
                >
                  <Download className="h-3.5 w-3.5 text-zinc-400" />
                  .MD
                </a>
                <a
                  href={getReportDownloadUrl(analysis.id, "json")}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-mono text-zinc-300 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
                  title="Download JSON Report"
                >
                  <Download className="h-3.5 w-3.5 text-zinc-400" />
                  .JSON
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Second Row: Workspace Navigation Tabs (Visible when an analysis is completed) */}
        {isCompleted && analysis && (
          <div className="flex items-center justify-between gap-2 border-t border-zinc-900 overflow-x-auto no-scrollbar">
            <nav className="flex items-center gap-1 -mb-px">
              {(
                [
                  {
                    id: "findings",
                    label: "Findings & Evidence",
                    count: findingCount,
                  },
                  {
                    id: "plan",
                    label: "Verification Plan & Summary",
                  },
                  {
                    id: "chat",
                    label: "Ask This Analysis",
                  },
                  {
                    id: "sources",
                    label: "Input Sources & Export",
                  },
                ] as const
              ).map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-b-2 whitespace-nowrap transition ${
                      isActive
                        ? "border-zinc-100 text-zinc-100"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {"count" in tab && tab.count !== undefined && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums ${
                          isActive
                            ? "bg-zinc-800 text-zinc-100"
                            : "bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Mobile Export Links */}
            <div className="flex sm:hidden items-center gap-1 pr-1 shrink-0">
              <a
                href={getReportDownloadUrl(analysis.id, "markdown")}
                download
                className="px-2 py-1 rounded text-[11px] font-mono bg-zinc-900 text-zinc-300 border border-zinc-800"
              >
                .MD
              </a>
              <a
                href={getReportDownloadUrl(analysis.id, "json")}
                download
                className="px-2 py-1 rounded text-[11px] font-mono bg-zinc-900 text-zinc-300 border border-zinc-800"
              >
                .JSON
              </a>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

"use client";

import React from "react";
import {
  History,
  Loader2,
  Play,
  Terminal,
} from "lucide-react";
import { AnalysisResponse } from "@/lib/types";

export type ActiveTab = "findings" | "plan" | "chat" | "sources";

interface HeaderProps {
  analysis: AnalysisResponse | null;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isStartingAnalysis: boolean;
  onLoadDemo: () => void;
  onOpenUploadModal: () => void;
  onGoHome: () => void;
  historyCount?: number;
}

export function Header({
  analysis,
  activeTab,
  setActiveTab,
  isStartingAnalysis,
  onLoadDemo,
  onOpenUploadModal,
  onGoHome,
  historyCount = 0,
}: HeaderProps) {
  const isCompleted = analysis?.status === "completed";
  const findingCount = analysis?.summary?.total_findings ?? 0;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0a0a0c]/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Top Row */}
        <div className="h-16 flex items-center justify-between gap-4">
          {/* Clickable Brand Logo -> Goes to Home / Landing */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onGoHome}
              title="Go to Home"
              className="flex items-center gap-2.5 shrink-0 text-left group focus:outline-none"
            >
              <div className="h-9 w-9 rounded-lg bg-zinc-900 border border-zinc-700/80 group-hover:border-zinc-500 flex items-center justify-center text-zinc-100 transition">
                <Terminal className="h-4 w-4" />
              </div>
              <span className="font-semibold text-base tracking-tight text-zinc-100 group-hover:text-white transition">
                API Graveyard Autopsy
              </span>
            </button>

            {analysis && (
              <>
                <span className="text-zinc-700 hidden sm:inline">/</span>
                <span className="text-sm text-zinc-400 truncate max-w-[180px] sm:max-w-[300px] hidden sm:inline">
                  {analysis.name}
                </span>
              </>
            )}
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onLoadDemo}
              disabled={isStartingAnalysis}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-zinc-100 hover:bg-white text-zinc-950 transition disabled:opacity-50"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span>{analysis ? "Reload Demo" : "Try Demo"}</span>
            </button>

            {analysis && (
              <button
                type="button"
                onClick={onOpenUploadModal}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition"
              >
                <History className="h-4 w-4 text-zinc-400" />
                <span>New Scan / History</span>
                {historyCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs font-mono bg-zinc-800 text-zinc-300">
                    {historyCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Second Row: Workspace Navigation Tabs */}
        {isCompleted && analysis && (
          <div className="flex items-center justify-between gap-2 border-t border-zinc-900 overflow-x-auto no-scrollbar">
            <nav className="flex items-center gap-2 -mb-px">
              {(
                [
                  {
                    id: "findings",
                    label: "Findings",
                    count: findingCount,
                  },
                  {
                    id: "plan",
                    label: "Action Plan & Summary",
                  },
                  {
                    id: "chat",
                    label: "Ask AI",
                  },
                  {
                    id: "sources",
                    label: "Sources & Export",
                  },
                ] as const
              ).map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                      isActive
                        ? "border-zinc-100 text-white"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {"count" in tab && tab.count !== undefined && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-mono tabular-nums ${
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
          </div>
        )}
      </div>
    </header>
  );
}

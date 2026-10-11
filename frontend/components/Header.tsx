"use client";

import React from "react";
import {
  Download,
  FileSearch,
  FileText,
  History,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Radio,
  Sparkles,
  Terminal,
  Upload,
} from "lucide-react";
import { AnalysisResponse } from "@/lib/types";
import { getReportDownloadUrl } from "@/lib/api";

export type ActiveTab = "findings" | "plan" | "chat" | "sources";
export type AppViewMode = "live" | "files" | "history" | "report";

interface HeaderProps {
  analysis: AnalysisResponse | null;
  appView: AppViewMode;
  setAppView: (view: AppViewMode) => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isStartingAnalysis: boolean;
  onLoadDemo: () => void;
  historyCount?: number;
  uniqueEndpointCount?: number;
}

export function Header({
  analysis,
  appView,
  setAppView,
  activeTab,
  setActiveTab,
  isStartingAnalysis,
  onLoadDemo,
  historyCount = 0,
  uniqueEndpointCount,
}: HeaderProps) {
  const isCompleted = analysis?.status === "completed";
  const badgeCount =
    uniqueEndpointCount ?? analysis?.summary?.total_findings ?? 0;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/90 bg-[#0a0a0c]/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Primary Navigation Row — Always Consistent & Easy to Access */}
        <div className="min-h-16 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Brand Logo */}
          <button
            type="button"
            onClick={() => setAppView("live")}
            title="Go to Scanner Home"
            className="flex items-center gap-2.5 shrink-0 text-left group focus:outline-none"
          >
            <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 group-hover:border-emerald-400 flex items-center justify-center text-emerald-400 transition">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-base tracking-tight text-white block leading-none">
                API Graveyard Autopsy
              </span>
              <span className="text-[11px] text-zinc-400 hidden sm:block mt-1">
                Endpoint Lifecycle &amp; Zombie Route Scanner
              </span>
            </div>
          </button>

          {/* Center: Unified Top-Level Mode Switcher (1-Click Access Everywhere) */}
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 p-1 rounded-xl bg-zinc-900/90 border border-zinc-800 overflow-x-auto max-w-full"
          >
            <button
              type="button"
              onClick={() => setAppView("live")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition ${
                appView === "live"
                  ? "bg-zinc-100 text-zinc-950 shadow-xs"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800/70"
              }`}
            >
              <Radio
                className={`h-3.5 w-3.5 ${
                  appView === "live" ? "text-emerald-600" : "text-emerald-400"
                }`}
              />
              <span>Scan Live API</span>
            </button>

            <button
              type="button"
              onClick={() => setAppView("files")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition ${
                appView === "files"
                  ? "bg-zinc-100 text-zinc-950 shadow-xs"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800/70"
              }`}
            >
              <Upload
                className={`h-3.5 w-3.5 ${
                  appView === "files" ? "text-sky-600" : "text-sky-400"
                }`}
              />
              <span>Upload Files</span>
            </button>

            <button
              type="button"
              onClick={() => setAppView("history")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition ${
                appView === "history"
                  ? "bg-zinc-100 text-zinc-950 shadow-xs"
                  : "text-zinc-300 hover:text-white hover:bg-zinc-800/70"
              }`}
            >
              <History
                className={`h-3.5 w-3.5 ${
                  appView === "history" ? "text-amber-600" : "text-amber-400"
                }`}
              />
              <span>Saved Reports</span>
              {historyCount > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[11px] font-mono leading-none ${
                    appView === "history"
                      ? "bg-zinc-900/15 text-zinc-900"
                      : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {historyCount}
                </span>
              )}
            </button>

            {analysis && (
              <button
                type="button"
                onClick={() => setAppView("report")}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition ${
                  appView === "report"
                    ? "bg-emerald-400 text-zinc-950 shadow-xs"
                    : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                }`}
              >
                <FileSearch className="h-3.5 w-3.5" />
                <span>Active Report</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[11px] font-mono leading-none ${
                    appView === "report"
                      ? "bg-zinc-950/20 text-zinc-950 font-semibold"
                      : "bg-emerald-500/20 text-emerald-200"
                  }`}
                >
                  {badgeCount}
                </span>
              </button>
            )}
          </nav>

          {/* Right: 1-Click Sample Demo */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onLoadDemo}
              disabled={isStartingAnalysis}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-700/80 transition disabled:opacity-50"
              title="Load sample e-commerce dataset with 21 findings"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
              ) : (
                <Play className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400" />
              )}
              <span>Try Sample Demo</span>
            </button>
          </div>
        </div>

        {/* Secondary Row: Shown Only When Viewing an Active Report */}
        {appView === "report" && isCompleted && analysis && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-zinc-800/80 pt-1">
            {/* Report Sub-Tabs */}
            <nav
              aria-label="Report sections"
              className="flex items-center gap-1 -mb-px overflow-x-auto no-scrollbar"
            >
              {(
                [
                  {
                    id: "findings",
                    label: "Endpoints & Issues",
                    icon: FileSearch,
                    count: badgeCount,
                  },
                  {
                    id: "plan",
                    label: "AI Summary & Plan",
                    icon: Sparkles,
                  },
                  {
                    id: "chat",
                    label: "Ask AI",
                    icon: MessageSquare,
                  },
                  {
                    id: "sources",
                    label: "Sources & Export",
                    icon: FileText,
                  },
                ] as const
              ).map((tab) => {
                const isActive = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition ${
                      isActive
                        ? "border-emerald-400 text-white"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        isActive ? "text-emerald-400" : "text-zinc-400"
                      }`}
                    />
                    <span>{tab.label}</span>
                    {"count" in tab && tab.count !== undefined && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-mono tabular-nums ${
                          isActive
                            ? "bg-emerald-500/20 text-emerald-300"
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

            {/* Active Report Context + Quick Actions */}
            <div className="flex items-center justify-between sm:justify-end gap-2 pb-2 sm:pb-1 text-xs">
              <span
                className="text-zinc-400 truncate max-w-[200px] md:max-w-[260px]"
                title={analysis.name}
              >
                Report: <strong className="text-zinc-200">{analysis.name}</strong>
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={getReportDownloadUrl(analysis.id, "markdown")}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-mono text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition"
                  title="Download Markdown Report"
                >
                  <Download className="h-3 w-3" />
                  <span>.MD</span>
                </a>
                <a
                  href={getReportDownloadUrl(analysis.id, "json")}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-mono text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition"
                  title="Download JSON Report"
                >
                  <Download className="h-3 w-3" />
                  <span>.JSON</span>
                </a>
                <button
                  type="button"
                  onClick={() => setAppView("live")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 transition"
                >
                  <Plus className="h-3 w-3" />
                  <span>New Scan</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

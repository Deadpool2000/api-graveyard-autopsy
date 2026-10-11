import React from "react";
import { Check, Minus, X } from "lucide-react";

export function getMethodStyle(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-300 bg-emerald-500/15 border-emerald-500/30";
    case "POST":
      return "text-sky-300 bg-sky-500/15 border-sky-500/30";
    case "PUT":
    case "PATCH":
      return "text-amber-300 bg-amber-500/15 border-amber-500/30";
    case "DELETE":
      return "text-rose-300 bg-rose-500/15 border-rose-500/30";
    default:
      return "text-zinc-300 bg-zinc-800 border-zinc-700";
  }
}

export function getSeverityDot(severity: string): string {
  switch (severity) {
    case "High":
      return "bg-rose-500";
    case "Medium":
      return "bg-amber-500";
    case "Review":
      return "bg-sky-400";
    default:
      return "bg-zinc-500";
  }
}

export function getSeverityStyle(severity: string): string {
  switch (severity) {
    case "High":
      return "text-rose-300 bg-rose-500/15 border-rose-500/30";
    case "Medium":
      return "text-amber-300 bg-amber-500/15 border-amber-500/30";
    case "Review":
      return "text-sky-300 bg-sky-500/15 border-sky-500/30";
    default:
      return "text-zinc-300 bg-zinc-800 border-zinc-700";
  }
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2.5 py-1 text-xs font-mono font-semibold rounded-md border leading-none ${getMethodStyle(
        method
      )}`}
    >
      {method}
    </span>
  );
}

export function SourceMatrixPills({
  sourcesPresent,
  sourcesSupplied,
  requestCount,
}: {
  sourcesPresent: string[];
  sourcesSupplied?: string[];
  requestCount?: number;
}) {
  const items = [
    { key: "openapi", label: "Docs", title: "OpenAPI Specification" },
    { key: "routes", label: "Code", title: "Backend Route Inventory" },
    { key: "logs", label: "Traffic", title: "Runtime Traffic Logs" },
  ];

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const isSupplied =
          !sourcesSupplied || sourcesSupplied.includes(item.key);
        const isPresent = sourcesPresent.includes(item.key);

        if (!isSupplied) {
          return (
            <span
              key={item.key}
              title={`${item.title}: Not uploaded`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border bg-zinc-950 text-zinc-600 border-zinc-900"
            >
              <Minus className="h-3 w-3 text-zinc-600" />
              <span>{item.label}</span>
            </span>
          );
        }

        if (isPresent) {
          const extra =
            item.key === "logs" &&
            typeof requestCount === "number" &&
            requestCount > 0
              ? ` (${requestCount})`
              : "";
          return (
            <span
              key={item.key}
              title={`${item.title}: Found${extra}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
            >
              <Check className="h-3 w-3 text-emerald-400 stroke-[2.5]" />
              <span>
                {item.label}
                {extra}
              </span>
            </span>
          );
        }

        return (
          <span
            key={item.key}
            title={`${item.title}: Missing`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border bg-zinc-900/90 text-zinc-400 border-zinc-800"
          >
            <X className="h-3 w-3 text-rose-400/80 stroke-[2.5]" />
            <span>No {item.label}</span>
          </span>
        );
      })}
    </div>
  );
}

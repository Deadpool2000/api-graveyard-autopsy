import React from "react";

export function getMethodStyle(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "POST":
      return "text-sky-400 bg-sky-500/10 border-sky-500/25";
    case "PUT":
    case "PATCH":
      return "text-amber-400 bg-amber-500/10 border-amber-500/25";
    case "DELETE":
      return "text-rose-400 bg-rose-500/10 border-rose-500/25";
    default:
      return "text-zinc-400 bg-zinc-800 border-zinc-700";
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
      return "text-rose-300 bg-rose-500/10 border-rose-500/25";
    case "Medium":
      return "text-amber-300 bg-amber-500/10 border-amber-500/25";
    case "Review":
      return "text-sky-300 bg-sky-500/10 border-sky-500/25";
    default:
      return "text-zinc-300 bg-zinc-800/80 border-zinc-700";
  }
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded border leading-none ${getMethodStyle(
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
}: {
  sourcesPresent: string[];
  sourcesSupplied?: string[];
}) {
  const items = [
    { key: "openapi", short: "SPEC", title: "OpenAPI Contract" },
    { key: "routes", short: "CODE", title: "Backend Route Inventory" },
    { key: "logs", short: "LOGS", title: "Observed Request Logs" },
  ];

  return (
    <div className="inline-flex items-center gap-1" title="Source Presence: SPEC (OpenAPI) | CODE (Route Inventory) | LOGS (Traffic)">
      {items.map((item) => {
        const isSupplied = !sourcesSupplied || sourcesSupplied.includes(item.key);
        const isPresent = sourcesPresent.includes(item.key);

        let cls = "bg-zinc-900 text-zinc-600 border-zinc-800";
        if (!isSupplied) {
          cls = "bg-zinc-950 text-zinc-700 border-zinc-900 line-through";
        } else if (isPresent) {
          cls = "bg-zinc-800 text-zinc-100 border-zinc-700";
        }

        return (
          <span
            key={item.key}
            title={`${item.title}: ${
              !isSupplied ? "Not uploaded" : isPresent ? "Present" : "Absent"
            }`}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border leading-none ${cls}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                !isSupplied
                  ? "bg-zinc-700"
                  : isPresent
                  ? "bg-emerald-400"
                  : "bg-zinc-600"
              }`}
            />
            {item.short}
          </span>
        );
      })}
    </div>
  );
}

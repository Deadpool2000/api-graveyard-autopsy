import React from "react";

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
}: {
  sourcesPresent: string[];
  sourcesSupplied?: string[];
}) {
  const items = [
    { key: "openapi", label: "Docs", title: "OpenAPI Spec" },
    { key: "routes", label: "Code", title: "Backend Routes" },
    { key: "logs", label: "Logs", title: "Traffic Logs" },
  ];

  return (
    <div className="inline-flex items-center gap-1.5">
      {items.map((item) => {
        const isSupplied = !sourcesSupplied || sourcesSupplied.includes(item.key);
        const isPresent = sourcesPresent.includes(item.key);

        let cls = "bg-zinc-900 text-zinc-500 border-zinc-800";
        if (!isSupplied) {
          cls = "bg-zinc-950 text-zinc-600 border-zinc-900 line-through";
        } else if (isPresent) {
          cls = "bg-zinc-800/90 text-zinc-200 border-zinc-700";
        }

        return (
          <span
            key={item.key}
            title={`${item.title}: ${
              !isSupplied ? "Not uploaded" : isPresent ? "Found" : "Missing"
            }`}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${cls}`}
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
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

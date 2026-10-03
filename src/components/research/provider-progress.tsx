"use client";

import { elapsed } from "@/lib/format";
import { PROVIDER_LABELS, type ProviderRunView } from "@/lib/research-types";
import { RunBadge } from "../status-badge";

const ACCENT = { openai: "border-l-teal-600", gemini: "border-l-blue-600" } as const;

export function ProviderProgress({ runs, now }: { runs: ProviderRunView[]; now: number }) {
  const order = ["openai", "gemini"] as const;
  const sorted = order.map((p) => runs.find((r) => r.provider === p)).filter((r): r is ProviderRunView => Boolean(r));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sorted.map((run) => (
        <div key={run.provider} className={`rounded-2xl border border-l-4 border-slate-200 bg-white p-4 shadow-sm ${ACCENT[run.provider]}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">{PROVIDER_LABELS[run.provider]}</h3>
            <RunBadge status={run.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Elapsed</dt>
            <dd className="text-right font-medium tabular-nums text-slate-800">{elapsed(run.startedAt, run.completedAt, now)}</dd>
            <dt className="text-slate-500">Model</dt>
            <dd className="truncate text-right text-slate-700" title={run.model ?? undefined}>
              {run.model ?? "—"}
            </dd>
            {run.status === "completed" && (
              <>
                <dt className="text-slate-500">Sources</dt>
                <dd className="text-right font-medium text-slate-800">{run.sourceCount}</dd>
              </>
            )}
          </dl>
          {run.progressNote && run.status === "running" && <p className="mt-3 text-sm text-indigo-700">{run.progressNote}</p>}
          {run.status === "pending" && <p className="mt-3 text-sm text-slate-500">{run.lastError ? `Retrying: ${run.lastError}` : "Starting…"}</p>}
          {run.status === "failed" && run.lastError && <p className="mt-3 break-words text-sm text-rose-700">{run.lastError}</p>}
          {run.status === "running" && run.lastError && <p className="mt-2 break-words text-xs text-amber-700">Recovering from: {run.lastError}</p>}
        </div>
      ))}
    </div>
  );
}

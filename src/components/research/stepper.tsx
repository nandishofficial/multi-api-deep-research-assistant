import type { ResearchStatus } from "@/lib/research-types";

const STEPS = [
  { key: "refine", label: "Refine", statuses: ["clarifying", "awaiting_answers", "refining"] },
  { key: "approve", label: "Approve", statuses: ["awaiting_approval"] },
  { key: "research", label: "Research", statuses: ["researching"] },
  { key: "report", label: "Report", statuses: ["reporting", "emailing"] },
  { key: "done", label: "Delivered", statuses: ["completed"] },
] as const;

export function Stepper({ status, failedAt }: { status: ResearchStatus; failedAt?: number }) {
  const current = status === "failed" || status === "cancelled" ? (failedAt ?? 0) : STEPS.findIndex((s) => (s.statuses as readonly string[]).includes(status));
  const done = status === "completed";
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((step, i) => {
        const complete = done || i < current;
        const active = !done && i === current;
        const bad = active && (status === "failed" || status === "cancelled");
        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className={`h-1.5 rounded-full ${
                bad ? "bg-rose-400" : complete ? "bg-emerald-500" : active ? "bg-brand-500" : "bg-slate-200"
              } ${active && !bad ? "pulse-dot" : ""}`}
            />
            <span className={`truncate text-[11px] font-medium sm:text-xs ${active ? "text-slate-900" : complete ? "text-slate-600" : "text-slate-400"}`}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

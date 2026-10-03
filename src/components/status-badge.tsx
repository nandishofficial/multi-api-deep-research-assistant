import { statusLabel, type ProviderRunStatus, type ResearchStatus } from "@/lib/research-types";

const RESEARCH_TONE: Record<ResearchStatus, string> = {
  clarifying: "bg-sky-50 text-sky-700 ring-sky-200",
  awaiting_answers: "bg-amber-50 text-amber-800 ring-amber-200",
  refining: "bg-sky-50 text-sky-700 ring-sky-200",
  awaiting_approval: "bg-amber-50 text-amber-800 ring-amber-200",
  researching: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  reporting: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emailing: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

const SHORT: Record<ResearchStatus, string> = {
  clarifying: "Preparing questions",
  awaiting_answers: "Awaiting OpenAI refinements",
  refining: "Refining brief",
  awaiting_approval: "Needs approval",
  researching: "Researching",
  reporting: "Building report",
  emailing: "Emailing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const WORKING: ResearchStatus[] = ["clarifying", "refining", "researching", "reporting", "emailing"];

export function StatusBadge({ status, long = false }: { status: ResearchStatus; long?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RESEARCH_TONE[status]}`}>
      {WORKING.includes(status) && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
      {long ? statusLabel(status) : SHORT[status]}
    </span>
  );
}

const RUN_TONE: Record<ProviderRunStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  running: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

export function RunBadge({ status }: { status: ProviderRunStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${RUN_TONE[status]}`}>
      {status === "running" && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
      {status === "pending" ? "Queued" : status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}

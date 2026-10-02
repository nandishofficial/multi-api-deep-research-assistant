"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { dateTime, elapsed, relativeTime, titleRepeatsQuery } from "@/lib/format";
import { isActive, PROVIDER_LABELS, type ProviderName, type ResearchDetail } from "@/lib/research-types";
import { StatusBadge } from "../status-badge";
import { BriefApproval } from "./brief-approval";
import { MarkdownView } from "./markdown-view";
import { ProviderProgress } from "./provider-progress";
import { RefinementWizard } from "./refinement-wizard";
import { Stepper } from "./stepper";

const POLL_MS: Partial<Record<ResearchDetail["status"], number>> = {
  clarifying: 1500,
  refining: 1500,
  researching: 4000,
  reporting: 2000,
  emailing: 2000,
};

export function ResearchView({ initial, userEmail }: { initial: ResearchDetail; userEmail: string }) {
  const router = useRouter();
  const [research, setResearch] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setResearch((await api.get(initial.id)).research);
    } catch {
      /* transient — next poll will retry */
    }
  }, [initial.id]);

  // Poll while the backend is working; slower when waiting on the user.
  useEffect(() => {
    if (!isActive(research.status)) return;
    const interval = POLL_MS[research.status] ?? 15_000;
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, interval);
    const onVisible = () => !document.hidden && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [research.status, refresh]);

  useEffect(() => {
    if (research.status !== "researching") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [research.status]);

  const act = useCallback(
    async (action: string, body: unknown = {}) => {
      setBusy(true);
      setError(null);
      try {
        setResearch((await api.action(research.id, action, body)).research);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [research.id, refresh],
  );

  const s = research.status;
  const failedStep = research.finalPrompt ? 2 : research.refinedPrompt ? 1 : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-4">
      <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-slate-500 hover:text-slate-800">
        ← All research
      </Link>

      <header className="mt-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={s} long />
          <span className="text-xs text-slate-500" title={dateTime(research.createdAt)}>
            Started {dateTime(research.createdAt)} ({relativeTime(research.createdAt, now)})
          </span>
        </div>
        {titleRepeatsQuery(research.title, research.query) ? (
          <h1 className="mt-2 text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">{research.query}</h1>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">{research.title}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{research.query}</p>
          </>
        )}
        <div className="mt-5">
          <Stepper status={s} failedAt={failedStep} />
        </div>
      </header>

      {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      <div className="mt-6 space-y-6">
        {(s === "clarifying" || s === "refining") && (
          <WorkingCard
            title={s === "clarifying" ? "OpenAI is reviewing your request" : "OpenAI is writing your research brief"}
            body={s === "clarifying" ? "Preparing refinement questions so the research targets exactly what you need." : "Combining your request and answers into detailed researcher instructions."}
          />
        )}

        {s === "awaiting_answers" && (
          <RefinementWizard
            questions={research.questions}
            busy={busy}
            onAnswer={(questionId, answer) => act("answers", { action: "answer", questionId, answer })}
            onSkip={(questionId) => act("answers", { action: "skip", questionId })}
            onBack={(questionId) => act("answers", { action: "reopen", questionId })}
            onSkipRemaining={() => act("answers", { action: "skip_remaining" })}
          />
        )}

        {s === "awaiting_approval" && research.refinedPrompt && (
          <BriefApproval
            key={research.refinedPrompt}
            brief={research.refinedPrompt}
            questions={research.questions}
            busy={busy}
            onApprove={(prompt) => act("approve", { prompt })}
            onRegenerate={() => act("regenerate")}
          />
        )}

        {(s === "researching" || s === "reporting" || s === "emailing") && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                {s === "researching" ? "Deep research in progress" : s === "reporting" ? "Compiling the PDF report" : "Emailing your report"}
              </h2>
              <span className="text-sm tabular-nums text-slate-500">{elapsed(research.researchStartedAt, null, now)}</span>
            </div>
            <ProviderProgress runs={research.runs} now={now} />
            <p className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
              Deep research usually takes 5–30 minutes. You can close this page — the PDF report will be emailed to <strong>{userEmail}</strong>.
            </p>
          </section>
        )}

        {s === "completed" && <CompletedPanel research={research} busy={busy} onResend={() => act("resend-email")} />}

        {s === "failed" && (
          <section className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="font-semibold text-rose-800">This research could not be completed</h2>
            {research.error && <p className="mt-1 break-words text-sm text-rose-700">{research.error}</p>}
            {research.runs.length > 0 && (
              <div className="mt-4">
                <ProviderProgress runs={research.runs} now={now} />
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => act("retry")}
              className="mt-4 min-h-11 w-full rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50 sm:w-auto"
            >
              {busy ? "Retrying…" : "Retry"}
            </button>
          </section>
        )}

        {s === "cancelled" && <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">This research was cancelled.</p>}

        {research.finalPrompt && s !== "awaiting_approval" && (
          <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-slate-700">
              Approved research brief
              <span className="text-slate-400 transition group-open:rotate-180">▾</span>
            </summary>
            <div className="border-t border-slate-100 px-4 py-3">
              {research.questions.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {research.questions.map((q) => (
                    <li key={q.id} className="text-slate-600">
                      <span className="text-slate-400">{q.question}</span> — {q.skipped ? <em className="text-slate-400">skipped</em> : q.answer}
                    </li>
                  ))}
                </ul>
              )}
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700">{research.finalPrompt}</pre>
            </div>
          </details>
        )}

        <ActivityLog research={research} />

        <div className="flex flex-wrap gap-2 pt-2">
          {isActive(s) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm("Cancel this research? Running provider jobs will be stopped.")) void act("cancel");
              }}
              className="min-h-11 rounded-xl px-4 text-sm font-medium text-rose-600 hover:bg-rose-50"
            >
              Cancel research
            </button>
          )}
          {(!isActive(s) || s === "awaiting_answers" || s === "awaiting_approval") && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirm("Delete this research and its results?")) return;
                try {
                  await api.remove(research.id);
                  router.push("/");
                  router.refresh();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not delete");
                }
              }}
              className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function WorkingCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5">
      <span className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" aria-hidden />
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{body}</p>
      </div>
    </section>
  );
}

function CompletedPanel({ research, busy, onResend }: { research: ResearchDetail; busy: boolean; onResend: () => void }) {
  const completedRuns = research.runs.filter((r) => r.status === "completed" && r.outputPreview);
  const [tab, setTab] = useState<ProviderName | null>(completedRuns[0]?.provider ?? null);
  const active = completedRuns.find((r) => r.provider === tab);
  const summary = research.summary;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-emerald-800">Report ready</h2>
            {research.emailStatus === "sent" && research.emailSentAt && (
              <p className="text-sm text-slate-600">Emailed {relativeTime(research.emailSentAt)} — check your Gmail inbox.</p>
            )}
            {research.emailStatus === "failed" && (
              <p className="break-words text-sm text-rose-700">Email delivery failed: {research.emailError}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={`/api/research/${research.id}/report`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"
            >
              View PDF
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={onResend}
              className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {research.emailStatus === "failed" ? "Retry email" : "Email again"}
            </button>
          </div>
        </div>
      </div>

      {summary && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Executive summary</p>
          <p className="mt-2 text-base font-semibold leading-snug text-slate-900">{summary.headline}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary.executiveSummary}</p>
          {summary.keyInsights.length > 0 && (
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              {summary.keyInsights.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          {summary.comparison && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{summary.comparison}</p>}
        </div>
      )}

      {completedRuns.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div role="tablist" className="flex border-b border-slate-200">
            {research.runs.map((run) => {
              const enabled = run.status === "completed";
              return (
                <button
                  key={run.provider}
                  role="tab"
                  type="button"
                  aria-selected={tab === run.provider}
                  disabled={!enabled}
                  onClick={() => setTab(run.provider)}
                  className={`min-h-12 flex-1 px-3 text-sm font-medium transition ${
                    tab === run.provider ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-800"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {PROVIDER_LABELS[run.provider]}
                  <span className="ml-1.5 text-xs text-slate-400">{enabled ? `${run.sourceCount} src` : run.status}</span>
                </button>
              );
            })}
          </div>
          {active?.outputPreview && (
            <div className="max-h-[70vh] overflow-y-auto p-4 sm:p-6">
              <MarkdownView markdown={active.outputPreview} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ActivityLog({ research }: { research: ResearchDetail }) {
  if (research.events.length === 0) return null;
  const tone = { info: "bg-slate-300", warn: "bg-amber-400", error: "bg-rose-500" } as const;
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm" open={research.status === "failed"}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-slate-700">
        Activity log <span className="text-xs font-normal text-slate-400">{research.events.length} events ▾</span>
      </summary>
      <ol className="space-y-2.5 border-t border-slate-100 px-4 py-3">
        {[...research.events].reverse().map((e) => (
          <li key={e.id} className="flex gap-2.5 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone[e.level]}`} />
            <div className="min-w-0">
              <p className={`break-words ${e.level === "error" ? "text-rose-700" : e.level === "warn" ? "text-amber-800" : "text-slate-700"}`}>{e.message}</p>
              <time className="text-xs text-slate-400">{dateTime(e.createdAt)}</time>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

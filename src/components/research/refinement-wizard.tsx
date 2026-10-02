"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefinementQuestion } from "@/lib/research-types";

interface Props {
  questions: RefinementQuestion[];
  busy: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onSkip: (questionId: string) => Promise<void>;
  onBack: (questionId: string) => Promise<void>;
  onSkipRemaining: () => Promise<void>;
}

/** Presents OpenAI's refinement questions one at a time (mobile-first). */
export function RefinementWizard({ questions, busy, onAnswer, onSkip, onBack, onSkipRemaining }: Props) {
  const index = useMemo(() => questions.findIndex((q) => !q.answer && !q.skipped), [questions]);
  const current = index >= 0 ? questions[index] : undefined;
  const previous = index > 0 ? questions[index - 1] : undefined;
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** When going back, restore the previous answer into the input. */
  const prefill = useRef<string | null>(null);

  useEffect(() => {
    setDraft(prefill.current ?? "");
    prefill.current = null;
    inputRef.current?.focus({ preventScroll: true });
  }, [current?.id]);

  if (!current) return null;
  const answeredCount = questions.filter((q) => q.answer || q.skipped).length;
  const pct = Math.round((answeredCount / questions.length) * 100);
  const isLast = index === questions.length - 1;

  return (
    <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between text-xs font-medium text-amber-800">
          <span>OpenAI refinement question</span>
          <span>
            {index + 1} of {questions.length}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100">
          <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
      </div>

      <form
        className="p-4 sm:p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (draft.trim()) await onAnswer(current.id, draft.trim());
        }}
      >
        <h2 className="text-lg font-semibold leading-snug text-slate-900">{current.question}</h2>
        {current.rationale && <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{current.rationale}</p>}

        {current.options.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {current.options.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={busy}
                onClick={() => setDraft(opt)}
                className={`min-h-11 rounded-xl border px-3.5 py-2.5 text-left text-sm transition active:scale-[0.99] ${
                  draft === opt ? "border-brand-500 bg-brand-50 font-medium text-brand-700 ring-2 ring-brand-100" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        <label htmlFor={`answer-${current.id}`} className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500">
          {current.options.length ? "Or write your own answer" : "Your answer"}
        </label>
        <textarea
          id={`answer-${current.id}`}
          ref={inputRef}
          rows={2}
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
              e.preventDefault();
              void onAnswer(current.id, draft.trim());
            }
          }}
          className="mt-1.5 block w-full resize-y rounded-xl border border-slate-300 px-3.5 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          placeholder="Type an answer…"
        />

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            {previous && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  prefill.current = previous.answer;
                  void onBack(previous.id);
                }}
                className="min-h-11 flex-1 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:flex-none"
              >
                ← Back
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onSkip(current.id)}
              className="min-h-11 flex-1 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:flex-none"
            >
              Skip
            </button>
          </div>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="min-h-11 rounded-xl bg-brand-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : isLast ? "Finish refinements" : "Next question"}
          </button>
        </div>

        {!isLast && (
          <button
            type="button"
            disabled={busy}
            onClick={onSkipRemaining}
            className="mt-3 w-full text-center text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
          >
            Skip remaining questions and continue
          </button>
        )}
      </form>

      {answeredCount > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Your answers so far</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {questions.slice(0, index).map((q) => (
              <li key={q.id} className="text-slate-600">
                <span className="text-slate-400">{q.question}</span> — {q.skipped ? <em className="text-slate-400">skipped</em> : <span className="font-medium text-slate-800">{q.answer}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

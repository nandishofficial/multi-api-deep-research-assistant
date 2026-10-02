"use client";

import { useState } from "react";
import type { RefinementQuestion } from "@/lib/research-types";

interface Props {
  brief: string;
  questions: RefinementQuestion[];
  busy: boolean;
  onApprove: (prompt: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
}

export function BriefApproval({ brief, questions, busy, onApprove, onRegenerate }: Props) {
  const [text, setText] = useState(brief);
  const edited = text.trim() !== brief.trim();
  return (
    <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-3 sm:px-5">
        <h2 className="font-semibold text-amber-900">Review the refined research brief</h2>
        <p className="mt-0.5 text-sm text-amber-800/80">
          OpenAI rewrote your request{questions.length ? " and answers" : ""} into detailed instructions. Edit anything, then approve — the same brief goes to
          OpenAI Deep Research and Gemini.
        </p>
      </div>
      <div className="p-4 sm:p-5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          maxLength={20_000}
          className="block max-h-[60vh] min-h-64 w-full resize-y rounded-xl border border-slate-300 bg-slate-50/50 px-3.5 py-3 font-mono text-[13px] leading-relaxed outline-none focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
        />
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>{edited ? "Edited — your version will be used" : "Unedited OpenAI brief"}</span>
          {edited && (
            <button type="button" onClick={() => setText(brief)} className="font-medium text-slate-500 hover:text-slate-700">
              Reset
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onRegenerate}
            className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Regenerate brief
          </button>
          <button
            type="button"
            disabled={busy || text.trim().length < 10}
            onClick={() => onApprove(text.trim())}
            className="min-h-11 rounded-xl bg-brand-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Approve & start research"}
          </button>
        </div>
      </div>
    </section>
  );
}

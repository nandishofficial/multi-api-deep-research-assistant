"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

const EXAMPLES = [
  "Help me find all the restaurants in Austin, Texas that do not use any seed oils in anything on their menu.",
  "Compare the best e-bikes under $2,000 for a 15-mile hilly commute in 2026.",
  "What does current research say about the effectiveness of 4-day work weeks on productivity?",
];

const MAX = 4000;

export function NewResearchForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 10) {
      setError("Please describe what you want researched (at least 10 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { research } = await api.create(query.trim());
      router.push(`/research/${research.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the research. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <label htmlFor="query" className="text-lg font-semibold tracking-tight">
        New research
      </label>
      <p className="mt-1 text-sm text-slate-600">
        Describe what you want to know. OpenAI may ask a few refinement questions, then OpenAI Deep Research and Gemini research it in parallel and
        you get a PDF report by email.
      </p>
      <textarea
        id="query"
        value={query}
        maxLength={MAX}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
        }}
        rows={4}
        placeholder="e.g. Help me find all the restaurants in Austin, Texas that do not use any seed oils…"
        className="mt-3 block w-full resize-y rounded-xl border border-slate-300 bg-slate-50/50 px-3.5 py-3 text-base leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setQuery(ex)}
            className="max-w-full truncate rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-500 hover:text-brand-700"
            title={ex}
          >
            {ex.length > 52 ? `${ex.slice(0, 50)}…` : ex}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">
          {query.length}/{MAX}
        </span>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? "Starting…" : "Start research"}
        </button>
      </div>
    </form>
  );
}

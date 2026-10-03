"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, relativeTime, shortDateTime, titleRepeatsQuery } from "@/lib/format";
import { isActive, PROVIDER_LABELS, type ResearchListItem } from "@/lib/research-types";
import { RunBadge, StatusBadge } from "./status-badge";

export function ResearchHistory({ initial }: { initial: ResearchListItem[] }) {
  const [items, setItems] = useState(initial);
  const [, setNow] = useState(0);
  const anyActive = items.some((i) => isActive(i.status));

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    if (!anyActive) return () => clearInterval(clock);
    const poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        setItems((await api.list()).items);
      } catch {
        /* keep the last good list */
      }
    }, 8_000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [anyActive]);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Research history</h2>
        <span className="text-xs text-slate-500">{items.length} total</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-500">
          No research yet. Start one above — it takes a few minutes and the report arrives by email.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/research/${item.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500/50 hover:shadow active:scale-[0.995]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="line-clamp-2 font-medium leading-snug text-slate-900">{titleRepeatsQuery(item.title, item.query) ? item.query : item.title}</h3>
                  <StatusBadge status={item.status} />
                </div>
                {!titleRepeatsQuery(item.title, item.query) && <p className="mt-1 line-clamp-1 text-sm text-slate-500">{item.query}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
                  <time dateTime={item.createdAt} title={dateTime(item.createdAt)}>
                    {shortDateTime(item.createdAt)} · {relativeTime(item.createdAt)}
                  </time>
                  {item.providers.map((p) => (
                    <span key={p.provider} className="inline-flex items-center gap-1">
                      <span className="text-slate-400">{PROVIDER_LABELS[p.provider].split(" ")[0]}</span>
                      <RunBadge status={p.status} />
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";

export function MarkdownView({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return (
    <div
      className="report-md prose prose-slate prose-sm max-w-none break-words sm:prose-base prose-headings:tracking-tight prose-a:text-brand-600 prose-table:text-sm prose-th:bg-slate-50"
      // Safe: renderMarkdown escapes raw HTML and only allows http(s)/mailto links.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

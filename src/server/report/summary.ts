import "server-only";
import { z } from "zod";
import { PROVIDER_LABELS, type ProviderName, type ReportSummary, type Source } from "@/lib/research-types";
import { getEnv } from "@/server/env";
import { getOpenAI } from "@/server/providers/openai-deep-research";
import { SUMMARY_SYSTEM_PROMPT } from "@/server/research/prompts";
import { withRetry } from "@/server/util/errors";

export interface SummaryInput {
  query: string;
  prompt: string;
  reports: { provider: ProviderName; markdown: string; sources: Source[] }[];
}

export interface Summarizer {
  summarize(input: SummaryInput): Promise<ReportSummary>;
}

const SummarySchema = z.object({
  headline: z.string(),
  executiveSummary: z.string(),
  keyInsights: z.array(z.string()),
  comparison: z.string(),
  topSources: z.array(z.object({ title: z.string(), url: z.string() })),
});

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "executiveSummary", "keyInsights", "comparison", "topSources"],
  properties: {
    headline: { type: "string" },
    executiveSummary: { type: "string" },
    keyInsights: { type: "array", items: { type: "string" }, maxItems: 7 },
    comparison: { type: "string" },
    topSources: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: { title: { type: "string" }, url: { type: "string" } },
      },
    },
  },
} as const;

/** Keep the summarization prompt bounded regardless of report size. */
const MAX_REPORT_CHARS = 60_000;

export class OpenAISummarizer implements Summarizer {
  async summarize(input: SummaryInput): Promise<ReportSummary> {
    const body = input.reports
      .map((r) => {
        const md = r.markdown.length > MAX_REPORT_CHARS ? `${r.markdown.slice(0, MAX_REPORT_CHARS)}\n…[truncated]` : r.markdown;
        const sources = r.sources.slice(0, 40).map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n");
        return `=== ${PROVIDER_LABELS[r.provider]} report ===\n${md}\n\n=== ${PROVIDER_LABELS[r.provider]} sources ===\n${sources || "(none)"}`;
      })
      .join("\n\n");

    const response = await withRetry(() =>
      getOpenAI().responses.create({
        model: getEnv().OPENAI_SUMMARY_MODEL,
        instructions: SUMMARY_SYSTEM_PROMPT,
        input: `Research question:\n${input.query}\n\nResearch brief:\n${input.prompt}\n\n${body}`,
        text: { format: { type: "json_schema", name: "report_summary", schema: SUMMARY_JSON_SCHEMA, strict: true } },
      }),
    );
    const parsed = SummarySchema.parse(JSON.parse(response.output_text));
    const knownUrls = new Set(input.reports.flatMap((r) => r.sources.map((s) => s.url)));
    return {
      ...parsed,
      // Only keep sources that genuinely came from the reports.
      topSources: parsed.topSources.filter((s) => knownUrls.has(s.url)),
      generatedBy: "openai",
    };
  }
}

/** No-LLM fallback: lifts the executive summary and bullets straight from the reports. */
export class HeuristicSummarizer implements Summarizer {
  async summarize(input: SummaryInput): Promise<ReportSummary> {
    return heuristicSummary(input);
  }
}

export function heuristicSummary(input: SummaryInput): ReportSummary {
  const primary = input.reports[0];
  const strip = (s: string) =>
    s
      .replace(/\s*\[\[(\d+)\]\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|`|^\s*[#>]+)/gm, "")
      .replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$|[.,;:])/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();

  const execSection = (md: string) => {
    const m = md.match(/^#{1,3}\s*(executive summary|summary|overview)[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|\s*$(?![\s\S]))/im);
    const para = m?.[2] ?? md.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#") && !p.trim().startsWith(">")) ?? "";
    return strip(para);
  };

  const insights: string[] = [];
  for (const r of input.reports) {
    for (const line of r.markdown.split("\n")) {
      const m = line.match(/^\s*[-*]\s+(.{30,})$/);
      if (m && insights.length < 6) insights.push(strip(m[1]!));
    }
  }

  const sources = input.reports.flatMap((r) => r.sources).slice(0, 6);
  const summary = primary ? execSection(primary.markdown) : "";
  return {
    headline: input.query.length > 140 ? `${input.query.slice(0, 137)}…` : input.query,
    executiveSummary: summary.length > 1200 ? `${summary.slice(0, 1197)}…` : summary || "See the provider sections for full findings.",
    keyInsights: insights,
    comparison:
      input.reports.length > 1
        ? "Both providers researched the same brief independently; compare their findings and sources in the sections that follow."
        : `Only ${primary ? PROVIDER_LABELS[primary.provider] : "one provider"} produced results for this run.`,
    topSources: sources.map((s) => ({ title: s.title, url: s.url })),
    generatedBy: "heuristic",
  };
}

import "server-only";
import type { ProviderName } from "@/lib/research-types";
import type { ReportData } from "@/server/report/pdf";
import { heuristicSummary } from "@/server/report/summary";
import { fallbackTitle } from "./refinement";
import * as repo from "./repository";

/** Assembles everything the PDF needs from the database. */
export async function loadReportData(researchId: string): Promise<ReportData | undefined> {
  const research = await repo.getResearch(researchId);
  if (!research) return undefined;
  const [runs, user] = await Promise.all([repo.getRuns(researchId), repo.loadUser(research.userId)]);
  if (!user) return undefined;

  const reportRuns = runs.map((r) => ({
    provider: r.provider as ProviderName,
    status: r.status,
    model: r.model,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    markdown: r.outputMarkdown,
    sources: r.sources ?? [],
    metadata: r.metadata ?? null,
    error: r.lastError,
  }));

  const summary =
    research.summary ??
    heuristicSummary({
      query: research.query,
      prompt: research.finalPrompt ?? research.query,
      reports: reportRuns
        .filter((r) => r.status === "completed" && r.markdown)
        .map((r) => ({ provider: r.provider, markdown: r.markdown!, sources: r.sources })),
    });

  return {
    id: research.id,
    title: research.title ?? fallbackTitle(research.query),
    query: research.query,
    finalPrompt: research.finalPrompt ?? research.refinedPrompt ?? research.query,
    questions: research.questions,
    user: { name: user.name, email: user.email },
    createdAt: research.createdAt,
    researchStartedAt: research.researchStartedAt,
    generatedAt: research.completedAt ?? latest(runs.map((r) => r.completedAt)) ?? new Date(),
    summary,
    runs: reportRuns,
  };
}

function latest(dates: (Date | null)[]): Date | undefined {
  const ts = dates.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return ts.length ? new Date(Math.max(...ts)) : undefined;
}

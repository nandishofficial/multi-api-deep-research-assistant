import "server-only";
import {
  statusLabel,
  type ProviderName,
  type ResearchDetail,
  type ResearchListItem,
} from "@/lib/research-types";
import type { ProviderRunRow, ResearchEventRow, ResearchSessionRow } from "@/server/db/schema";
import { fallbackTitle } from "./refinement";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const ORDER: Record<string, number> = { openai: 0, gemini: 1 };
const byProvider = <T extends { provider: string }>(runs: T[]) => [...runs].sort((a, b) => (ORDER[a.provider] ?? 9) - (ORDER[b.provider] ?? 9));

export function toListItem(row: ResearchSessionRow, runs: Pick<ProviderRunRow, "provider" | "status">[]): ResearchListItem {
  return {
    id: row.id,
    title: row.title ?? fallbackTitle(row.query),
    query: row.query,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: iso(row.completedAt),
    providers: byProvider(runs).map((r) => ({ provider: r.provider as ProviderName, status: r.status })),
  };
}

export function toDetail(row: ResearchSessionRow, runs: ProviderRunRow[], events: ResearchEventRow[]): ResearchDetail {
  return {
    id: row.id,
    title: row.title ?? fallbackTitle(row.query),
    query: row.query,
    status: row.status,
    statusLabel: statusLabel(row.status),
    questions: row.questions,
    refinedPrompt: row.refinedPrompt,
    finalPrompt: row.finalPrompt,
    error: row.error,
    emailStatus: row.emailStatus ?? null,
    emailSentAt: iso(row.emailSentAt),
    emailError: row.emailError,
    summary: row.summary ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    researchStartedAt: iso(row.researchStartedAt),
    completedAt: iso(row.completedAt),
    runs: byProvider(runs).map((r) => ({
      provider: r.provider as ProviderName,
      status: r.status,
      model: r.model,
      startedAt: iso(r.startedAt),
      completedAt: iso(r.completedAt),
      progressNote: r.progressNote,
      lastError: r.lastError,
      sourceCount: r.sources?.length ?? 0,
      outputPreview: r.outputMarkdown,
      metadata: r.metadata ?? null,
    })),
    events: events.map((e) => ({ id: e.id, level: e.level, message: e.message, createdAt: e.createdAt.toISOString() })),
    reportAvailable: runs.some((r) => r.status === "completed"),
  };
}

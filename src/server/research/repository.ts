import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { AUTOMATED_STATUSES, PROVIDERS, type ResearchStatus } from "@/lib/research-types";
import { getDb, schema } from "@/server/db/client";
import type { ProviderRunRow, ResearchSessionRow } from "@/server/db/schema";

const { researchSessions, providerRuns, researchEvents } = schema;

export type ResearchPatch = Partial<Omit<typeof researchSessions.$inferInsert, "id" | "userId" | "createdAt">>;
export type RunPatch = Partial<Omit<typeof providerRuns.$inferInsert, "id" | "researchId" | "provider" | "createdAt">>;

export async function insertResearch(userId: string, query: string): Promise<ResearchSessionRow> {
  const db = await getDb();
  const [row] = await db
    .insert(researchSessions)
    .values({ id: randomUUID(), userId, query, status: "clarifying", nextCheckAt: new Date() })
    .returning();
  return row!;
}

export async function getResearch(id: string): Promise<ResearchSessionRow | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(researchSessions).where(eq(researchSessions.id, id)).limit(1);
  return row;
}

export async function getResearchForUser(id: string, userId: string): Promise<ResearchSessionRow | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(researchSessions)
    .where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)))
    .limit(1);
  return row;
}

export async function listResearchForUser(userId: string, limit = 50) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.userId, userId))
    .orderBy(desc(researchSessions.createdAt))
    .limit(limit);
  const runs = rows.length
    ? await db
        .select({ researchId: providerRuns.researchId, provider: providerRuns.provider, status: providerRuns.status })
        .from(providerRuns)
        .where(inArray(providerRuns.researchId, rows.map((r) => r.id)))
    : [];
  return rows.map((row) => ({ row, runs: runs.filter((r) => r.researchId === row.id) }));
}

export async function updateResearch(id: string, patch: ResearchPatch): Promise<ResearchSessionRow | undefined> {
  const db = await getDb();
  const [row] = await db.update(researchSessions).set(patch).where(eq(researchSessions.id, id)).returning();
  return row;
}

/** Compare-and-set on status: returns undefined when the research is no longer in `from`. */
export async function transitionResearch(
  id: string,
  from: ResearchStatus | ResearchStatus[],
  patch: ResearchPatch,
): Promise<ResearchSessionRow | undefined> {
  const db = await getDb();
  const statuses = Array.isArray(from) ? from : [from];
  const [row] = await db
    .update(researchSessions)
    .set(patch)
    .where(and(eq(researchSessions.id, id), inArray(researchSessions.status, statuses)))
    .returning();
  return row;
}

export async function deleteResearch(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(researchSessions).where(eq(researchSessions.id, id));
}

export async function addEvent(researchId: string, message: string, level: "info" | "warn" | "error" = "info") {
  const db = await getDb();
  await db.insert(researchEvents).values({ researchId, message, level });
}

export async function listEvents(researchId: string, limit = 100) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(researchEvents)
    .where(eq(researchEvents.researchId, researchId))
    .orderBy(desc(researchEvents.id))
    .limit(limit);
  return rows.reverse();
}

/* ---------------------------------------------------------------------------
 * Provider runs
 * ------------------------------------------------------------------------- */

export async function getRuns(researchId: string): Promise<ProviderRunRow[]> {
  const db = await getDb();
  return db.select().from(providerRuns).where(eq(providerRuns.researchId, researchId)).orderBy(asc(providerRuns.provider));
}

/** Creates one pending run per provider (idempotent). */
export async function ensureRuns(researchId: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(providerRuns)
    .values(PROVIDERS.map((provider) => ({ id: randomUUID(), researchId, provider, status: "pending" as const })))
    .onConflictDoNothing({ target: [providerRuns.researchId, providerRuns.provider] });
}

export async function updateRun(id: string, patch: RunPatch): Promise<ProviderRunRow | undefined> {
  const db = await getDb();
  const [row] = await db.update(providerRuns).set(patch).where(eq(providerRuns.id, id)).returning();
  return row;
}

/* ---------------------------------------------------------------------------
 * Leases — make sure only one worker advances a research session at a time,
 * across processes (inline worker, cron endpoint, request-triggered kicks).
 * ------------------------------------------------------------------------- */

export async function acquireLease(id: string, owner: string, ttlMs: number): Promise<ResearchSessionRow | undefined> {
  const db = await getDb();
  const now = new Date();
  const [row] = await db
    .update(researchSessions)
    .set({ leaseOwner: owner, leaseUntil: new Date(now.getTime() + ttlMs) })
    .where(
      and(
        eq(researchSessions.id, id),
        or(isNull(researchSessions.leaseUntil), lt(researchSessions.leaseUntil, now), eq(researchSessions.leaseOwner, owner)),
      ),
    )
    .returning();
  return row;
}

export async function extendLease(id: string, owner: string, ttlMs: number): Promise<void> {
  const db = await getDb();
  await db
    .update(researchSessions)
    .set({ leaseUntil: new Date(Date.now() + ttlMs) })
    .where(and(eq(researchSessions.id, id), eq(researchSessions.leaseOwner, owner)));
}

export async function releaseLease(id: string, owner: string): Promise<void> {
  const db = await getDb();
  await db
    .update(researchSessions)
    .set({ leaseOwner: null, leaseUntil: null })
    .where(and(eq(researchSessions.id, id), eq(researchSessions.leaseOwner, owner)));
}

/** Research sessions whose next automated step is due and that nobody is working on. */
export async function findDueResearchIds(limit = 10): Promise<string[]> {
  const db = await getDb();
  const now = new Date();
  const rows = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(
      and(
        inArray(researchSessions.status, [...AUTOMATED_STATUSES]),
        or(isNull(researchSessions.nextCheckAt), lte(researchSessions.nextCheckAt, now)),
        or(isNull(researchSessions.leaseUntil), lt(researchSessions.leaseUntil, now)),
      ),
    )
    .orderBy(sql`${researchSessions.nextCheckAt} asc nulls first`)
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function loadUser(userId: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return u;
}

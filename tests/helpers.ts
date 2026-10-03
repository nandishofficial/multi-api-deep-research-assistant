import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resetDbForTesting, schema, type Database } from "@/server/db/client";
import { setEnvForTesting, type Env } from "@/server/env";
import type { EmailMessage, EmailTransport } from "@/server/email/transport";
import { setServicesForTesting, type Services } from "@/server/services";
import { MockDeepResearchProvider } from "@/server/providers/mock";
import { MockRefinementService } from "@/server/research/refinement";
import { HeuristicSummarizer } from "@/server/report/summary";

export class CapturingTransport implements EmailTransport {
  readonly name = "capture";
  sent: EmailMessage[] = [];
  failWith: Error | null = null;
  async send(message: EmailMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return { id: `msg-${this.sent.length}` };
  }
}

export async function setupTestEnv(overrides: Partial<Services> = {}, env: Partial<Env> = {}) {
  setEnvForTesting({ RESEARCH_MOCK_PROVIDERS: true, EMAIL_PROVIDER: "console", WORKER_MODE: "off", ...env });
  const db = await resetDbForTesting("pglite://memory");
  const email = new CapturingTransport();
  const services: Partial<Services> = {
    providers: {
      openai: new MockDeepResearchProvider("openai", 0),
      gemini: new MockDeepResearchProvider("gemini", 0),
    },
    refinement: new MockRefinementService(),
    summarizer: new HeuristicSummarizer(),
    email,
    ...overrides,
  };
  setServicesForTesting(services);
  const userId = randomUUID();
  await db.insert(schema.user).values({ id: userId, name: "Test User", email: "test.user@gmail.com", emailVerified: true });
  return { db, email, userId };
}

/** Make every scheduled check due now (instead of sleeping through poll intervals). */
export async function makeDue(db: Database, researchId: string) {
  const past = new Date(Date.now() - 1000);
  await db.update(schema.researchSessions).set({ nextCheckAt: past }).where(eq(schema.researchSessions.id, researchId));
  await db.update(schema.providerRuns).set({ nextPollAt: past }).where(eq(schema.providerRuns.researchId, researchId));
}

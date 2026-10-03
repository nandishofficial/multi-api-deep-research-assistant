import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@/server/db/client";
import { advanceResearch, tick } from "@/server/research/orchestrator";
import * as repo from "@/server/research/repository";
import * as service from "@/server/research/service";
import { setServicesForTesting } from "@/server/services";
import { ClassifiedError } from "@/server/util/errors";
import type { DeepResearchProvider, PollResult } from "@/server/providers/types";
import { MockDeepResearchProvider } from "@/server/providers/mock";
import { CapturingTransport, makeDue, setupTestEnv } from "./helpers";

let db: Database;
let email: CapturingTransport;
let userId: string;

async function runToApproval(query = "Find seed-oil-free restaurants in Austin, Texas") {
  const created = await service.createResearch(userId, { query });
  await advanceResearch(created.id);
  let row = (await repo.getResearch(created.id))!;
  expect(row.status).toBe("awaiting_answers");
  expect(row.questions.length).toBeGreaterThan(0);
  for (const [i, q] of row.questions.entries()) {
    row = i === 1
      ? await service.answerQuestion(userId, row.id, { action: "skip", questionId: q.id })
      : await service.answerQuestion(userId, row.id, { action: "answer", questionId: q.id, answer: `answer ${i}` });
  }
  expect(row.status).toBe("refining");
  await advanceResearch(row.id);
  row = (await repo.getResearch(row.id))!;
  expect(row.status).toBe("awaiting_approval");
  expect(row.refinedPrompt).toContain("answer 0");
  expect(row.refinedPrompt).toContain("skipped");
  return row;
}

async function driveToEnd(id: string, maxTicks = 10) {
  for (let i = 0; i < maxTicks; i++) {
    const row = (await repo.getResearch(id))!;
    if (["completed", "failed", "cancelled"].includes(row.status)) return row;
    await makeDue(db, id);
    await advanceResearch(id);
  }
  return (await repo.getResearch(id))!;
}

beforeEach(async () => {
  ({ db, email, userId } = await setupTestEnv());
});

afterEach(() => setServicesForTesting(undefined));

describe("research orchestration", () => {
  it("runs the full happy path: refinement → approval → both providers → PDF email", async () => {
    const approvedFrom = await runToApproval();
    const approved = await service.approvePrompt(userId, approvedFrom.id, { prompt: `${approvedFrom.refinedPrompt}\n\nAlso include prices.` });
    expect(approved.status).toBe("researching");
    expect(approved.finalPrompt).toContain("Also include prices.");

    const done = await driveToEnd(approved.id);
    expect(done.status).toBe("completed");
    expect(done.emailStatus).toBe("sent");
    expect(done.summary?.headline).toBeTruthy();

    const runs = await repo.getRuns(done.id);
    expect(runs.map((r) => r.status).sort()).toEqual(["completed", "completed"]);
    expect(runs.every((r) => (r.outputMarkdown ?? "").length > 100)).toBe(true);

    expect(email.sent).toHaveLength(1);
    const msg = email.sent[0]!;
    expect(msg.to).toBe("test.user@gmail.com");
    expect(msg.subject).toContain("Your research report");
    expect(msg.html).toContain("Executive summary");
    expect(msg.attachments[0]!.contentType).toBe("application/pdf");
    expect(msg.attachments[0]!.content.subarray(0, 5).toString()).toBe("%PDF-");

    const events = await repo.listEvents(done.id);
    expect(events.map((e) => e.message).join("\n")).toMatch(/OpenAI Deep Research started[\s\S]*emailed/);
  });

  it("skips straight to the brief when OpenAI asks no questions", async () => {
    const created = await service.createResearch(userId, { query: "Specific question [no-questions] about Austin tallow restaurants" });
    await advanceResearch(created.id);
    const row = (await repo.getResearch(created.id))!;
    expect(row.status).toBe("awaiting_approval");
    expect(row.questions).toEqual([]);
  });

  it("supports skipping all remaining questions", async () => {
    const created = await service.createResearch(userId, { query: "Find seed-oil-free restaurants in Austin" });
    await advanceResearch(created.id);
    const row = await service.answerQuestion(userId, created.id, { action: "skip_remaining" });
    expect(row.status).toBe("refining");
    expect(row.questions.every((q) => q.skipped)).toBe(true);
  });

  it("still delivers a report when one provider fails", async () => {
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, { prompt: `${row.refinedPrompt} [mock-fail-gemini]` });
    const done = await driveToEnd(row.id);
    expect(done.status).toBe("completed");
    const runs = await repo.getRuns(row.id);
    expect(runs.find((r) => r.provider === "gemini")!.status).toBe("failed");
    expect(runs.find((r) => r.provider === "openai")!.status).toBe("completed");
    expect(email.sent).toHaveLength(1);
    const events = await repo.listEvents(row.id);
    expect(events.some((e) => e.level === "warn" && /did not complete/.test(e.message))).toBe(true);
  });

  it("fails the research when both providers fail, and can be retried", async () => {
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, { prompt: `${row.refinedPrompt} [mock-fail-gemini] [mock-fail-openai]` });
    const failed = await driveToEnd(row.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/Both providers failed/);
    expect(email.sent).toHaveLength(0);

    // Fix the prompt-level problem by swapping in healthy providers, then retry.
    setServicesForTesting({
      providers: { openai: new MockDeepResearchProvider("openai", 0), gemini: new MockDeepResearchProvider("gemini", 0) },
      email,
    });
    await db.update(schema.researchSessions).set({ finalPrompt: "Healthy prompt for retry" }).where(eq(schema.researchSessions.id, row.id));
    const retried = await service.retryResearch(userId, row.id);
    expect(retried.status).toBe("researching");
    const done = await driveToEnd(row.id);
    expect(done.status).toBe("completed");
  });

  it("retries transient provider errors with backoff, then succeeds", async () => {
    let startCalls = 0;
    const flaky: DeepResearchProvider = {
      name: "openai",
      async start() {
        startCalls++;
        if (startCalls < 3) throw new ClassifiedError("transient", "429 rate limited", { status: 429 });
        return { externalId: "ok", model: "flaky-model", unavailableModels: [] };
      },
      async poll(): Promise<PollResult> {
        return { state: "completed", result: { markdown: "# Done\n\nText long enough to be a report body.", sources: [], metadata: {} } };
      },
      async cancel() {},
    };
    setServicesForTesting({ providers: { openai: flaky, gemini: new MockDeepResearchProvider("gemini", 0) }, email });
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, {});
    const done = await driveToEnd(row.id, 15);
    expect(startCalls).toBe(3);
    expect(done.status).toBe("completed");
    const run = (await repo.getRuns(row.id)).find((r) => r.provider === "openai")!;
    expect(run.model).toBe("flaky-model");
    expect(run.errorCount).toBe(0);
  });

  it("restarts a remote job once after a provider-side failure", async () => {
    let starts = 0;
    const provider: DeepResearchProvider = {
      name: "gemini",
      async start() {
        starts++;
        return { externalId: `job-${starts}`, model: "m", unavailableModels: [] };
      },
      async poll(id): Promise<PollResult> {
        if (id === "job-1") return { state: "failed", retryable: true, error: "Gemini deep research failed: internal" };
        return { state: "completed", result: { markdown: "# Report\n\nRecovered after restart.", sources: [], metadata: {} } };
      },
      async cancel() {},
    };
    setServicesForTesting({ providers: { openai: new MockDeepResearchProvider("openai", 0), gemini: provider }, email });
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, {});
    const done = await driveToEnd(row.id, 15);
    expect(starts).toBe(2);
    expect(done.status).toBe("completed");
  });

  it("marks email failures without losing the report, and can resend", async () => {
    email.failWith = new ClassifiedError("permanent", "Google account was not granted gmail.send");
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, {});
    const done = await driveToEnd(row.id);
    expect(done.status).toBe("completed");
    expect(done.emailStatus).toBe("failed");
    expect(done.emailError).toMatch(/gmail.send/);

    email.failWith = null;
    await service.resendEmail(userId, row.id);
    const resent = await driveToEnd(row.id);
    expect(resent.emailStatus).toBe("sent");
    expect(email.sent).toHaveLength(1);
  });

  it("uses a lease so concurrent workers never double-start providers", async () => {
    let starts = 0;
    const counting: DeepResearchProvider = {
      name: "openai",
      async start() {
        starts++;
        await new Promise((r) => setTimeout(r, 50));
        return { externalId: "x", model: "m", unavailableModels: [] };
      },
      async poll(): Promise<PollResult> {
        return { state: "running" };
      },
      async cancel() {},
    };
    setServicesForTesting({ providers: { openai: counting, gemini: new MockDeepResearchProvider("gemini", 60_000) }, email });
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, {});
    const outcomes = await Promise.all([advanceResearch(row.id), advanceResearch(row.id), tick(), advanceResearch(row.id)]);
    expect(starts).toBe(1);
    expect(outcomes.filter((o) => o === "busy").length).toBeGreaterThan(0);
  });

  it("enforces ownership and state transitions", async () => {
    const row = await runToApproval();
    await expect(service.approvePrompt("someone-else", row.id, {})).rejects.toMatchObject({ status: 404 });
    await service.approvePrompt(userId, row.id, {});
    await expect(service.approvePrompt(userId, row.id, {})).rejects.toMatchObject({ status: 409 });
    await expect(service.createResearch(userId, { query: "short" })).rejects.toThrow();
  });

  it("cancels an active research and its provider runs", async () => {
    setServicesForTesting({
      providers: { openai: new MockDeepResearchProvider("openai", 60_000), gemini: new MockDeepResearchProvider("gemini", 60_000) },
      email,
    });
    const row = await runToApproval();
    await service.approvePrompt(userId, row.id, {});
    await advanceResearch(row.id);
    const cancelled = await service.cancelResearch(userId, row.id);
    expect(cancelled.status).toBe("cancelled");
    expect((await repo.getRuns(row.id)).every((r) => r.status === "cancelled")).toBe(true);
    expect(await tick()).toEqual({ processed: 0 });
  });
});

describe("refinement degradation", () => {
  beforeEach(async () => {
    ({ db, email, userId } = await setupTestEnv());
  });

  it("continues without questions when clarification fails for a non-fatal reason", async () => {
    setServicesForTesting({
      refinement: {
        clarify: async () => {
          throw new ClassifiedError("permanent", "Unexpected response shape");
        },
        rewrite: async (q) => `Brief for: ${q}`,
      },
      email,
    });
    const created = await service.createResearch(userId, { query: "Find seed-oil-free restaurants in Austin" });
    await advanceResearch(created.id);
    const row = (await repo.getResearch(created.id))!;
    expect(row.status).toBe("awaiting_approval");
    expect(row.refinedPrompt).toBe("Brief for: Find seed-oil-free restaurants in Austin");
  });

  it("fails visibly on an invalid API key instead of skipping refinement", async () => {
    setServicesForTesting({
      refinement: {
        clarify: async () => {
          throw new ClassifiedError("permanent", "Incorrect API key provided", { status: 401 });
        },
        rewrite: async () => "unused",
      },
      email,
    });
    const created = await service.createResearch(userId, { query: "Find seed-oil-free restaurants in Austin" });
    await advanceResearch(created.id);
    const row = (await repo.getResearch(created.id))!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/API key/);
  });
});

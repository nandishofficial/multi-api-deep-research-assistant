import "server-only";
import { z } from "zod";
import { isActive, PROVIDER_LABELS, type ResearchStatus } from "@/lib/research-types";
import type { ResearchSessionRow } from "@/server/db/schema";
import { getServices } from "@/server/services";
import * as repo from "./repository";

/**
 * Application service for user-initiated actions. Every action validates
 * ownership and the current status (compare-and-set), then hands any
 * automated follow-up work to the orchestrator.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const CreateResearchInput = z.object({
  query: z.string().trim().min(10, "Please describe your research request in at least 10 characters.").max(4000),
});

export const AnswerInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), questionId: z.string().min(1), answer: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("skip"), questionId: z.string().min(1) }),
  z.object({ action: z.literal("skip_remaining") }),
]);

export const ApproveInput = z.object({
  prompt: z.string().trim().min(10).max(20_000).optional(),
});

async function owned(userId: string, id: string): Promise<ResearchSessionRow> {
  const row = await repo.getResearchForUser(id, userId);
  if (!row) throw new HttpError(404, "Research not found");
  return row;
}

function conflict(row: ResearchSessionRow, expected: string): never {
  throw new HttpError(409, `This research is "${row.status}", expected ${expected}. Refresh to see the latest state.`);
}

export async function createResearch(userId: string, input: unknown): Promise<ResearchSessionRow> {
  const { query } = CreateResearchInput.parse(input);
  const row = await repo.insertResearch(userId, query);
  await repo.addEvent(row.id, "Research request received; asking OpenAI for refinement questions.");
  return row;
}

export async function answerQuestion(userId: string, id: string, input: unknown): Promise<ResearchSessionRow> {
  const action = AnswerInput.parse(input);
  const row = await owned(userId, id);
  if (row.status !== "awaiting_answers") conflict(row, "awaiting answers");

  const now = new Date().toISOString();
  const questions = row.questions.map((q) => {
    if (action.action === "skip_remaining") return q.answer || q.skipped ? q : { ...q, skipped: true, answeredAt: now };
    if (q.id !== action.questionId) return q;
    return action.action === "answer"
      ? { ...q, answer: action.answer, skipped: false, answeredAt: now }
      : { ...q, answer: null, skipped: true, answeredAt: now };
  });
  if (action.action !== "skip_remaining" && !row.questions.some((q) => q.id === action.questionId)) {
    throw new HttpError(400, "Unknown question");
  }

  const done = questions.every((q) => q.skipped || q.answer);
  const updated = await repo.transitionResearch(id, "awaiting_answers", {
    questions,
    ...(done ? { status: "refining" as ResearchStatus, nextCheckAt: new Date(), stepAttempts: 0 } : {}),
  });
  if (!updated) conflict(row, "awaiting answers");
  if (done) {
    const answered = questions.filter((q) => q.answer).length;
    await repo.addEvent(id, `Refinements complete (${answered}/${questions.length} answered); OpenAI is writing the research brief.`);
  }
  return updated;
}

/** Re-open a previously answered question while still answering (the "Back" button). */
export async function reopenQuestion(userId: string, id: string, questionId: string): Promise<ResearchSessionRow> {
  const row = await owned(userId, id);
  if (row.status !== "awaiting_answers") conflict(row, "awaiting answers");
  const questions = row.questions.map((q) => (q.id === questionId ? { ...q, answer: null, skipped: false, answeredAt: null } : q));
  const updated = await repo.transitionResearch(id, "awaiting_answers", { questions });
  if (!updated) conflict(row, "awaiting answers");
  return updated;
}

export async function approvePrompt(userId: string, id: string, input: unknown): Promise<ResearchSessionRow> {
  const { prompt } = ApproveInput.parse(input ?? {});
  const row = await owned(userId, id);
  if (row.status !== "awaiting_approval") conflict(row, "awaiting approval");
  const finalPrompt = (prompt ?? row.refinedPrompt ?? row.query).trim();
  const now = new Date();
  const updated = await repo.transitionResearch(id, "awaiting_approval", {
    finalPrompt,
    promptApprovedAt: now,
    status: "researching",
    researchStartedAt: now,
    nextCheckAt: now,
    stepAttempts: 0,
  });
  if (!updated) conflict(row, "awaiting approval");
  await repo.ensureRuns(id);
  const edited = prompt && prompt.trim() !== row.refinedPrompt?.trim();
  await repo.addEvent(
    id,
    `Research brief approved${edited ? " (edited by you)" : ""}; starting ${PROVIDER_LABELS.openai} and ${PROVIDER_LABELS.gemini} with the same prompt.`,
  );
  return updated;
}

/** Ask OpenAI for a fresh brief (e.g. after the user changes their mind). */
export async function regenerateBrief(userId: string, id: string): Promise<ResearchSessionRow> {
  const row = await owned(userId, id);
  if (row.status !== "awaiting_approval") conflict(row, "awaiting approval");
  const updated = await repo.transitionResearch(id, "awaiting_approval", { status: "refining", nextCheckAt: new Date(), stepAttempts: 0 });
  if (!updated) conflict(row, "awaiting approval");
  await repo.addEvent(id, "Regenerating the research brief.");
  return updated;
}

export async function cancelResearch(userId: string, id: string): Promise<ResearchSessionRow> {
  const row = await owned(userId, id);
  if (!isActive(row.status)) conflict(row, "an active research");
  const updated = await repo.transitionResearch(id, row.status, { status: "cancelled", nextCheckAt: null, completedAt: new Date() });
  if (!updated) conflict(row, "an active research");
  const { providers } = getServices();
  for (const run of await repo.getRuns(id)) {
    if (run.status === "running" || run.status === "pending") {
      if (run.externalId) await providers[run.provider].cancel(run.externalId).catch(() => {});
      await repo.updateRun(run.id, { status: "cancelled", nextPollAt: null });
    }
  }
  await repo.addEvent(id, "Research cancelled by you.", "warn");
  return updated;
}

/** Retry after a failure: resumes from the earliest step that did not complete. */
export async function retryResearch(userId: string, id: string): Promise<ResearchSessionRow> {
  const row = await owned(userId, id);
  if (row.status !== "failed") conflict(row, "failed");
  let status: ResearchStatus;
  if (row.finalPrompt) {
    for (const run of await repo.getRuns(id)) {
      if (run.status !== "completed") {
        await repo.updateRun(run.id, { status: "pending", externalId: null, startAttempts: 0, errorCount: 0, lastError: null, nextPollAt: null, completedAt: null });
      }
    }
    status = "researching";
  } else if (row.refinedPrompt || (row.questions.length > 0 && row.questions.every((q) => q.answer || q.skipped))) {
    status = "refining";
  } else {
    status = "clarifying";
  }
  const updated = await repo.transitionResearch(id, "failed", { status, error: null, stepAttempts: 0, nextCheckAt: new Date() });
  if (!updated) conflict(row, "failed");
  await repo.addEvent(id, `Retrying from "${status}".`);
  return updated;
}

export async function resendEmail(userId: string, id: string): Promise<ResearchSessionRow> {
  const row = await owned(userId, id);
  if (row.status !== "completed") conflict(row, "completed");
  const updated = await repo.transitionResearch(id, "completed", {
    status: "emailing",
    emailStatus: "pending",
    emailAttempts: 0,
    emailError: null,
    nextCheckAt: new Date(),
  });
  if (!updated) conflict(row, "completed");
  await repo.addEvent(id, "Re-sending the report email.");
  return updated;
}

export async function deleteResearch(userId: string, id: string): Promise<void> {
  const row = await owned(userId, id);
  if (isActive(row.status) && row.status !== "awaiting_answers" && row.status !== "awaiting_approval") {
    throw new HttpError(409, "Cancel the research before deleting it.");
  }
  await repo.deleteResearch(id);
}

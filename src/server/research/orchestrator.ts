import "server-only";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { PROVIDER_LABELS, type ProviderName, type ReportSummary } from "@/lib/research-types";
import type { ProviderRunRow, ResearchSessionRow } from "@/server/db/schema";
import { buildReportEmail } from "@/server/email/template";
import { appUrl, getEnv } from "@/server/env";
import { renderReportPdf, reportFilename } from "@/server/report/pdf";
import { getServices } from "@/server/services";
import { backoffMs, classifyError, errorMessage } from "@/server/util/errors";
import { createLogger } from "@/server/util/logger";
import { loadReportData } from "./report-data";
import { formatQuestionsForPrompt } from "./refinement";
import * as repo from "./repository";

/**
 * The orchestrator is a durable state machine stored in Postgres.
 *
 *   clarifying ─► awaiting_answers ─► refining ─► awaiting_approval ─► researching ─► reporting ─► emailing ─► completed
 *        └──────────(no questions)──────┘                                  │
 *                                                                          └─► failed (both providers failed)
 *
 * Automated states are advanced by `advanceResearch`, which may be invoked
 * concurrently from the inline worker loop, the cron endpoint and
 * request-triggered "kicks"; a per-row lease guarantees a single writer.
 * Every step is idempotent and re-entrant, so a crash at any point simply
 * resumes on the next tick.
 */

const log = createLogger("orchestrator");

const LEASE_MS = 3 * 60_000;
const MAX_STEP_ATTEMPTS = 5;
const MAX_START_ATTEMPTS = 2; // remote job (re)starts per provider
const MAX_TRANSIENT_ERRORS = 8; // consecutive start/poll errors before giving up
const MAX_EMAIL_ATTEMPTS = 5;
const MAX_STEPS_PER_CALL = 6;

const processOwner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export type AdvanceOutcome = "advanced" | "busy" | "not_found" | "idle";

export async function advanceResearch(id: string): Promise<AdvanceOutcome> {
  const owner = `${processOwner}:${randomUUID().slice(0, 6)}`;
  let row = await repo.acquireLease(id, owner, LEASE_MS);
  if (!row) return (await repo.getResearch(id)) ? "busy" : "not_found";

  try {
    let outcome: AdvanceOutcome = "idle";
    for (let i = 0; i < MAX_STEPS_PER_CALL && row; i++) {
      const due = !row.nextCheckAt || row.nextCheckAt.getTime() <= Date.now();
      if (!due) break;
      const next = await runStep(row, owner);
      if (!next) break;
      outcome = "advanced";
      // Keep going only while the step handed off to another automated step that is due now.
      if (next.status === row.status && next.nextCheckAt && next.nextCheckAt.getTime() > Date.now()) break;
      row = next;
    }
    return outcome;
  } finally {
    await repo.releaseLease(id, owner);
  }
}

/** Runs one step; returns the updated row (or undefined when nothing ran). */
async function runStep(row: ResearchSessionRow, owner: string): Promise<ResearchSessionRow | undefined> {
  try {
    switch (row.status) {
      case "clarifying":
        return await stepClarify(row);
      case "refining":
        return await stepRefine(row);
      case "researching":
        return await stepResearch(row, owner);
      case "reporting":
        return await stepReport(row);
      case "emailing":
        return await stepEmail(row);
      default:
        return undefined; // waiting on the user, or terminal
    }
  } catch (err) {
    return handleStepError(row, err);
  }
}

async function handleStepError(row: ResearchSessionRow, err: unknown): Promise<ResearchSessionRow | undefined> {
  const e = classifyError(err);
  const attempts = row.stepAttempts + 1;
  log.warn("step failed", { id: row.id, status: row.status, kind: e.kind, attempts, error: e.message });
  if (e.kind === "transient" && attempts < MAX_STEP_ATTEMPTS) {
    const delay = backoffMs(attempts);
    await repo.addEvent(row.id, `Temporary error while ${row.status}: ${e.message}. Retrying in ${Math.round(delay / 1000)}s.`, "warn");
    return repo.updateResearch(row.id, { stepAttempts: attempts, nextCheckAt: new Date(Date.now() + delay) });
  }
  await repo.addEvent(row.id, `Failed while ${row.status}: ${e.message}`, "error");
  return repo.updateResearch(row.id, { status: "failed", error: e.message, stepAttempts: attempts, nextCheckAt: null });
}

/* ---------------------------------------------------------------------------
 * Refinement
 * ------------------------------------------------------------------------- */

async function stepClarify(row: ResearchSessionRow) {
  const { refinement } = getServices();
  let title: string;
  let questions;
  try {
    ({ title, questions } = await refinement.clarify(row.query));
  } catch (err) {
    const e = classifyError(err);
    if (e.kind === "transient") throw e;
    // Don't strand the user: continue without questions and say why.
    await repo.addEvent(row.id, `OpenAI could not generate refinement questions (${e.message}); continuing without them.`, "warn");
    return repo.transitionResearch(row.id, "clarifying", { status: "refining", stepAttempts: 0, nextCheckAt: new Date() });
  }

  if (questions.length === 0) {
    await repo.addEvent(row.id, "OpenAI judged the request specific enough — no refinement questions needed.");
    return repo.transitionResearch(row.id, "clarifying", { title, questions: [], status: "refining", stepAttempts: 0, nextCheckAt: new Date() });
  }
  await repo.addEvent(row.id, `OpenAI asked ${questions.length} refinement question${questions.length > 1 ? "s" : ""}.`);
  return repo.transitionResearch(row.id, "clarifying", {
    title,
    questions,
    status: "awaiting_answers",
    stepAttempts: 0,
    nextCheckAt: null,
  });
}

async function stepRefine(row: ResearchSessionRow) {
  const { refinement } = getServices();
  let brief: string;
  try {
    brief = await refinement.rewrite(row.query, row.questions);
  } catch (err) {
    const e = classifyError(err);
    if (e.kind === "transient") throw e;
    await repo.addEvent(row.id, `OpenAI could not rewrite the brief (${e.message}); using your request and answers verbatim.`, "warn");
    brief = `${row.query.trim()}\n\nClarifications:\n${formatQuestionsForPrompt(row.questions)}`;
  }
  await repo.addEvent(row.id, "OpenAI produced a refined research brief — awaiting your approval.");
  return repo.transitionResearch(row.id, "refining", {
    refinedPrompt: brief,
    status: "awaiting_approval",
    stepAttempts: 0,
    nextCheckAt: null,
  });
}

/* ---------------------------------------------------------------------------
 * Research execution (both providers in parallel)
 * ------------------------------------------------------------------------- */

async function stepResearch(row: ResearchSessionRow, owner: string) {
  await repo.ensureRuns(row.id);
  const runs = await repo.getRuns(row.id);
  const prompt = row.finalPrompt ?? row.refinedPrompt ?? row.query;

  await Promise.all(runs.map((run) => advanceRun(row, run, prompt)));
  await repo.extendLease(row.id, owner, LEASE_MS);

  const fresh = await repo.getRuns(row.id);
  const active = fresh.filter((r) => r.status === "pending" || r.status === "running");
  if (active.length > 0) {
    const nextPoll = Math.min(...active.map((r) => r.nextPollAt?.getTime() ?? Date.now()));
    return repo.updateResearch(row.id, { nextCheckAt: new Date(Math.max(nextPoll, Date.now() + 1_000)), stepAttempts: 0 });
  }

  const completed = fresh.filter((r) => r.status === "completed");
  if (completed.length === 0) {
    const reasons = fresh.map((r) => `${PROVIDER_LABELS[r.provider]}: ${r.lastError ?? r.status}`).join("; ");
    await repo.addEvent(row.id, `Both providers failed. ${reasons}`, "error");
    return repo.transitionResearch(row.id, "researching", { status: "failed", error: `Both providers failed. ${reasons}`, nextCheckAt: null });
  }
  if (completed.length < fresh.length) {
    const failed = fresh.filter((r) => r.status !== "completed").map((r) => PROVIDER_LABELS[r.provider]);
    await repo.addEvent(row.id, `${failed.join(" and ")} did not complete; building the report with the available results.`, "warn");
  } else {
    await repo.addEvent(row.id, "Both OpenAI and Gemini research runs completed.");
  }
  return repo.transitionResearch(row.id, "researching", { status: "reporting", stepAttempts: 0, nextCheckAt: new Date() });
}

function pollDelay(run: ProviderRunRow): number {
  const base = getEnv().PROVIDER_POLL_INTERVAL_MS;
  const age = run.startedAt ? Date.now() - run.startedAt.getTime() : 0;
  // Deep research takes minutes; poll quickly at first, then back off a little.
  return age > 10 * 60_000 ? base * 2 : base;
}

async function advanceRun(research: ResearchSessionRow, run: ProviderRunRow, prompt: string): Promise<void> {
  if (run.status !== "pending" && run.status !== "running") return;
  if (run.nextPollAt && run.nextPollAt.getTime() > Date.now()) return;

  const provider = getServices().providers[run.provider];
  const label = PROVIDER_LABELS[run.provider];

  if (run.status === "pending") {
    try {
      const started = await provider.start({ prompt, researchId: research.id });
      const now = new Date();
      await repo.updateRun(run.id, {
        status: "running",
        externalId: started.externalId,
        model: started.model,
        startAttempts: run.startAttempts + 1,
        errorCount: 0,
        lastError: null,
        progressNote: "Started",
        startedAt: run.startedAt ?? now,
        nextPollAt: new Date(now.getTime() + Math.min(getEnv().PROVIDER_POLL_INTERVAL_MS, 10_000)),
        metadata: { ...(run.metadata ?? {}), requestedModel: started.unavailableModels[0] ?? started.model, unavailableModels: started.unavailableModels },
      });
      if (started.unavailableModels.length > 0) {
        await repo.addEvent(research.id, `${label}: ${started.unavailableModels.join(", ")} unavailable for this API key — using ${started.model}.`, "warn");
      }
      await repo.addEvent(research.id, `${label} started (${started.model}).`);
    } catch (err) {
      await recordRunError(research, run, err, "start");
    }
    return;
  }

  // running
  const timeoutMs = getEnv().PROVIDER_TIMEOUT_MINUTES * 60_000;
  if (run.startedAt && Date.now() - run.startedAt.getTime() > timeoutMs) {
    if (run.externalId) await provider.cancel(run.externalId).catch(() => {});
    const msg = `${label} timed out after ${getEnv().PROVIDER_TIMEOUT_MINUTES} minutes`;
    await repo.updateRun(run.id, { status: "failed", lastError: msg, completedAt: new Date(), nextPollAt: null });
    await repo.addEvent(research.id, msg, "error");
    return;
  }
  if (!run.externalId) {
    await repo.updateRun(run.id, { status: "pending", nextPollAt: null });
    return;
  }

  try {
    const result = await provider.poll(run.externalId);
    const now = new Date();
    if (result.state === "running") {
      await repo.updateRun(run.id, {
        errorCount: 0,
        progressNote: result.progressNote ?? null,
        nextPollAt: new Date(now.getTime() + pollDelay(run)),
        metadata: { ...(run.metadata ?? {}), remoteStatus: result.remoteStatus },
      });
      return;
    }
    if (result.state === "completed") {
      const durationMs = run.startedAt ? now.getTime() - run.startedAt.getTime() : undefined;
      await repo.updateRun(run.id, {
        status: "completed",
        outputMarkdown: result.result.markdown,
        sources: result.result.sources,
        metadata: { ...(run.metadata ?? {}), ...result.result.metadata, durationMs: result.result.metadata.durationMs ?? durationMs },
        completedAt: now,
        progressNote: `Completed with ${result.result.sources.length} sources`,
        errorCount: 0,
        lastError: null,
        nextPollAt: null,
      });
      await repo.addEvent(research.id, `${label} finished — ${result.result.sources.length} sources cited.`);
      return;
    }
    // failed
    if (result.retryable && run.startAttempts < MAX_START_ATTEMPTS) {
      await repo.updateRun(run.id, {
        status: "pending",
        externalId: null,
        lastError: result.error,
        progressNote: "Restarting after a provider-side failure",
        nextPollAt: new Date(now.getTime() + backoffMs(run.startAttempts, 15_000)),
      });
      await repo.addEvent(research.id, `${result.error}. Restarting ${label} (attempt ${run.startAttempts + 1} of ${MAX_START_ATTEMPTS}).`, "warn");
      return;
    }
    await repo.updateRun(run.id, { status: "failed", lastError: result.error, completedAt: now, nextPollAt: null, progressNote: null });
    await repo.addEvent(research.id, result.error, "error");
  } catch (err) {
    await recordRunError(research, run, err, "poll");
  }
}

async function recordRunError(research: ResearchSessionRow, run: ProviderRunRow, err: unknown, phase: "start" | "poll") {
  const e = classifyError(err);
  const label = PROVIDER_LABELS[run.provider];
  const errorCount = run.errorCount + 1;
  if (e.kind === "transient" && errorCount < MAX_TRANSIENT_ERRORS) {
    const delay = backoffMs(errorCount);
    await repo.updateRun(run.id, { errorCount, lastError: e.message, nextPollAt: new Date(Date.now() + delay) });
    log.warn("provider transient error", { research: research.id, provider: run.provider, phase, errorCount, error: e.message });
    if (errorCount === 1 || errorCount % 3 === 0) {
      await repo.addEvent(research.id, `${label}: temporary ${phase} error (${e.message}); retrying.`, "warn");
    }
    return;
  }
  const msg = `${label} ${phase === "start" ? "could not start" : "failed"}: ${e.message}`;
  await repo.updateRun(run.id, { status: "failed", errorCount, lastError: e.message, completedAt: new Date(), nextPollAt: null });
  await repo.addEvent(research.id, msg, "error");
}

/* ---------------------------------------------------------------------------
 * Report + delivery
 * ------------------------------------------------------------------------- */

async function stepReport(row: ResearchSessionRow) {
  const { summarizer, fallbackSummarizer } = getServices();
  const runs = (await repo.getRuns(row.id)).filter((r) => r.status === "completed" && r.outputMarkdown);
  const input = {
    query: row.query,
    prompt: row.finalPrompt ?? row.query,
    reports: runs.map((r) => ({ provider: r.provider as ProviderName, markdown: r.outputMarkdown!, sources: r.sources ?? [] })),
  };
  let summary: ReportSummary;
  try {
    summary = await summarizer.summarize(input);
  } catch (err) {
    await repo.addEvent(row.id, `Summary generation failed (${errorMessage(err)}); using an extractive summary.`, "warn");
    summary = await fallbackSummarizer.summarize(input);
  }
  await repo.addEvent(row.id, "Executive summary ready; generating the PDF report.");
  return repo.transitionResearch(row.id, "reporting", {
    summary,
    status: "emailing",
    emailStatus: "pending",
    emailAttempts: 0,
    stepAttempts: 0,
    nextCheckAt: new Date(),
  });
}

async function stepEmail(row: ResearchSessionRow) {
  const { email } = getServices();
  const data = await loadReportData(row.id);
  if (!data) throw new Error("Report data missing");
  const pdf = await renderReportPdf(data);
  const filename = reportFilename(data.title, data.generatedAt);
  const message = buildReportEmail({
    title: data.title,
    query: data.query,
    summary: data.summary,
    runs: data.runs.map((r) => ({
      provider: r.provider,
      status: r.status,
      sourceCount: r.sources.length,
      durationMs: r.metadata?.durationMs ?? null,
      error: r.error,
    })),
    researchUrl: `${appUrl()}/research/${row.id}`,
    pdfFilename: filename,
  });

  try {
    await email.send({
      to: data.user.email,
      userId: row.userId,
      ...message,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });
  } catch (err) {
    const e = classifyError(err);
    const attempts = row.emailAttempts + 1;
    if (e.kind === "transient" && attempts < MAX_EMAIL_ATTEMPTS) {
      const delay = backoffMs(attempts, 10_000);
      await repo.addEvent(row.id, `Email delivery failed (${e.message}); retrying in ${Math.round(delay / 1000)}s.`, "warn");
      return repo.updateResearch(row.id, { emailAttempts: attempts, emailError: e.message, nextCheckAt: new Date(Date.now() + delay) });
    }
    await repo.addEvent(row.id, `Email delivery failed: ${e.message}. The PDF is still available to download.`, "error");
    return repo.transitionResearch(row.id, "emailing", {
      status: "completed",
      completedAt: new Date(),
      emailStatus: "failed",
      emailAttempts: attempts,
      emailError: e.message,
      nextCheckAt: null,
    });
  }

  await repo.addEvent(row.id, `PDF report emailed to ${data.user.email} via ${email.name}.`);
  return repo.transitionResearch(row.id, "emailing", {
    status: "completed",
    completedAt: row.completedAt ?? new Date(),
    emailStatus: "sent",
    emailSentAt: new Date(),
    emailAttempts: row.emailAttempts + 1,
    emailError: null,
    nextCheckAt: null,
  });
}

/* ---------------------------------------------------------------------------
 * Worker tick
 * ------------------------------------------------------------------------- */

/** Advances every due research session once. Safe to call from many places at once. */
export async function tick(limit = 10): Promise<{ processed: number }> {
  const ids = await repo.findDueResearchIds(limit);
  const results = await Promise.allSettled(ids.map((id) => advanceResearch(id)));
  for (const r of results) {
    if (r.status === "rejected") log.error("advance failed", { error: errorMessage(r.reason) });
  }
  return { processed: ids.length };
}

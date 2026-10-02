import "server-only";
import { getEnv } from "@/server/env";
import { errorMessage } from "@/server/util/errors";
import { createLogger } from "@/server/util/logger";
import { advanceResearch, tick } from "./orchestrator";

const log = createLogger("worker");

const globalForWorker = globalThis as unknown as { __researchWorker?: { stop: () => void } };

/**
 * In-process polling loop. On long-lived hosts (Render, Railway, Fly, Docker)
 * this is all that's needed; on serverless hosts use the cron endpoint
 * instead (WORKER_MODE=off) — both are safe to run together.
 */
export function startWorker(intervalMs = getEnv().WORKER_POLL_INTERVAL_MS): { stop: () => void } {
  if (globalForWorker.__researchWorker) return globalForWorker.__researchWorker;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const loop = async () => {
    if (stopped) return;
    try {
      await tick();
    } catch (err) {
      log.error("tick failed", { error: errorMessage(err) });
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  };
  timer = setTimeout(loop, 1_000);
  log.info("worker started", { intervalMs });

  const handle = {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      globalForWorker.__researchWorker = undefined;
    },
  };
  globalForWorker.__researchWorker = handle;
  return handle;
}

/** Fire-and-forget advance used right after a user action, so the UI doesn't wait for the next tick. */
export function kick(id: string): Promise<void> {
  return advanceResearch(id)
    .then(() => undefined)
    .catch((err) => log.error("kick failed", { id, error: errorMessage(err) }));
}

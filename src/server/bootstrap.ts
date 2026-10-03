import "server-only";
import { runMigrations } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { startWorker } from "@/server/research/worker";
import { errorMessage } from "@/server/util/errors";
import { createLogger } from "@/server/util/logger";

const log = createLogger("bootstrap");

/** Runs once per server process (from instrumentation.ts). */
export async function bootstrap(): Promise<void> {
  const env = getEnv();
  if (process.env.AUTO_MIGRATE !== "false") {
    try {
      await runMigrations();
      log.info("database migrations applied");
    } catch (err) {
      log.error("migration failed", { error: errorMessage(err) });
      throw err;
    }
  }
  if (env.WORKER_MODE === "inline") startWorker();
  if (env.RESEARCH_MOCK_PROVIDERS) log.warn("RESEARCH_MOCK_PROVIDERS=true — using simulated research providers");
}

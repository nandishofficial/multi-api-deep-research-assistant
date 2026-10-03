/**
 * Standalone worker process (WORKER_MODE=external on the web service):
 *   npm run worker
 */
import { runMigrations } from "../src/server/db/client";
import { startWorker } from "../src/server/research/worker";

async function main() {
  await runMigrations();
  const worker = startWorker();
  const shutdown = () => {
    worker.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

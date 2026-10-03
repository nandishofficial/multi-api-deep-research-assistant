import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getEnv } from "@/server/env";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

interface DbHandle {
  db: Database;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

const globalForDb = globalThis as unknown as { __researchDb?: Promise<DbHandle> };

async function createHandle(url: string): Promise<DbHandle> {
  if (url.startsWith("pglite://")) {
    // Embedded Postgres (WASM) — zero-setup local development and tests.
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const location = url.slice("pglite://".length);
    const client = location === "memory" || location === "" ? new PGlite() : new PGlite(location);
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as Database,
      migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    };
  }

  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    prepare: !url.includes("pgbouncer=true"),
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Database,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.end({ timeout: 5 }),
  };
}

function handle(): Promise<DbHandle> {
  if (!globalForDb.__researchDb) {
    globalForDb.__researchDb = createHandle(getEnv().DATABASE_URL);
  }
  return globalForDb.__researchDb;
}

export async function getDb(): Promise<Database> {
  return (await handle()).db;
}

export async function runMigrations(): Promise<void> {
  await (await handle()).migrate();
}

/** Test helper: point the singleton at a specific database URL. */
export async function resetDbForTesting(url: string): Promise<Database> {
  if (globalForDb.__researchDb) {
    await (await globalForDb.__researchDb).close().catch(() => {});
  }
  globalForDb.__researchDb = createHandle(url);
  const h = await globalForDb.__researchDb;
  await h.migrate();
  return h.db;
}

export { schema };

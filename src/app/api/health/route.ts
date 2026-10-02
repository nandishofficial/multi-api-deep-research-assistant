import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({
      ok: true,
      mockProviders: env.RESEARCH_MOCK_PROVIDERS,
      emailProvider: env.EMAIL_PROVIDER,
      workerMode: env.WORKER_MODE,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

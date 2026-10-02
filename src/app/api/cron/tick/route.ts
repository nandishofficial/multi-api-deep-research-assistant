import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/server/env";
import { tick } from "@/server/research/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Advances all due research sessions. For serverless hosts (Vercel Cron,
 * GitHub Actions, any external scheduler): `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await tick(25);
  return NextResponse.json({ ok: true, ...result });
}

export { handle as GET, handle as POST };

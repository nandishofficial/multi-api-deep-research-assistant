import { after, NextResponse } from "next/server";
import { authedRoute, readJson } from "@/server/http";
import { toDetail, toListItem } from "@/server/research/dto";
import * as repo from "@/server/research/repository";
import { createResearch } from "@/server/research/service";
import { kick } from "@/server/research/worker";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async ({ user }) => {
  const rows = await repo.listResearchForUser(user.id);
  return NextResponse.json({ items: rows.map(({ row, runs }) => toListItem(row, runs)) });
});

export const POST = authedRoute(async ({ request, user }) => {
  const row = await createResearch(user.id, await readJson(request));
  // Ask OpenAI for refinement questions right away instead of waiting for the next worker tick.
  after(() => kick(row.id));
  return NextResponse.json({ research: toDetail(row, [], await repo.listEvents(row.id)) }, { status: 201 });
});

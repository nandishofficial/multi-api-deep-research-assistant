import { after, NextResponse } from "next/server";
import { AUTOMATED_STATUSES } from "@/lib/research-types";
import { authedRoute } from "@/server/http";
import { toDetail } from "@/server/research/dto";
import * as repo from "@/server/research/repository";
import { deleteResearch, HttpError } from "@/server/research/service";
import { kick } from "@/server/research/worker";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = authedRoute<Params>(async ({ user, params }) => {
  const row = await repo.getResearchForUser(params.id, user.id);
  if (!row) throw new HttpError(404, "Research not found");
  const [runs, events] = await Promise.all([repo.getRuns(row.id), repo.listEvents(row.id)]);
  // Self-healing: if this research is due and no worker picked it up (e.g. serverless host without cron), advance it now.
  const due = AUTOMATED_STATUSES.includes(row.status) && (!row.nextCheckAt || row.nextCheckAt.getTime() <= Date.now());
  if (due) after(() => kick(row.id));
  return NextResponse.json({ research: toDetail(row, runs, events) }, { headers: { "Cache-Control": "no-store" } });
});

export const DELETE = authedRoute<Params>(async ({ user, params }) => {
  await deleteResearch(user.id, params.id);
  return new NextResponse(null, { status: 204 });
});

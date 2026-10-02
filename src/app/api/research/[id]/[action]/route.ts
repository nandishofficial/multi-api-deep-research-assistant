import { after, NextResponse } from "next/server";
import { authedRoute, readJson } from "@/server/http";
import { toDetail } from "@/server/research/dto";
import * as repo from "@/server/research/repository";
import * as service from "@/server/research/service";
import { kick } from "@/server/research/worker";

export const dynamic = "force-dynamic";

type Params = { id: string; action: string };
type Action = (userId: string, id: string, body: unknown) => Promise<unknown>;

const ACTIONS: Record<string, Action> = {
  answers: (userId, id, body) => {
    const b = body as { action?: string; questionId?: string };
    if (b?.action === "reopen" && b.questionId) return service.reopenQuestion(userId, id, b.questionId);
    return service.answerQuestion(userId, id, body);
  },
  approve: (userId, id, body) => service.approvePrompt(userId, id, body),
  regenerate: (userId, id) => service.regenerateBrief(userId, id),
  cancel: (userId, id) => service.cancelResearch(userId, id),
  retry: (userId, id) => service.retryResearch(userId, id),
  "resend-email": (userId, id) => service.resendEmail(userId, id),
};

export const POST = authedRoute<Params>(async ({ request, user, params }) => {
  const action = ACTIONS[params.action];
  if (!action) return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  await action(user.id, params.id, await readJson(request));
  // Hand any automated follow-up (refining, starting providers, emailing) to the orchestrator immediately.
  after(() => kick(params.id));
  const row = await repo.getResearchForUser(params.id, user.id);
  const [runs, events] = await Promise.all([repo.getRuns(params.id), repo.listEvents(params.id)]);
  return NextResponse.json({ research: toDetail(row!, runs, events) });
});

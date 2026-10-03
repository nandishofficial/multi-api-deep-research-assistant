import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ResearchView } from "@/components/research/research-view";
import { getCurrentUser } from "@/server/auth/session";
import { toDetail } from "@/server/research/dto";
import * as repo from "@/server/research/repository";

export const dynamic = "force-dynamic";

export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const { id } = await params;
  const row = await repo.getResearchForUser(id, user.id);
  if (!row) notFound();
  const [runs, events] = await Promise.all([repo.getRuns(id), repo.listEvents(id)]);
  return (
    <>
      <AppHeader user={user} />
      <ResearchView initial={toDetail(row, runs, events)} userEmail={user.email} />
    </>
  );
}

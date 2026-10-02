import { AppHeader } from "@/components/app-header";
import { GoogleSignInButton } from "@/components/auth-buttons";
import { NewResearchForm } from "@/components/new-research-form";
import { ResearchHistory } from "@/components/research-history";
import { getCurrentUser } from "@/server/auth/session";
import { getEnv } from "@/server/env";
import { toListItem } from "@/server/research/dto";
import { listResearchForUser } from "@/server/research/repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return <Landing gmail={getEnv().EMAIL_PROVIDER === "gmail"} />;

  const rows = await listResearchForUser(user.id);
  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
        <NewResearchForm />
        <ResearchHistory initial={rows.map(({ row, runs }) => toListItem(row, runs))} />
      </main>
    </>
  );
}

function Landing({ gmail }: { gmail: boolean }) {
  const steps = [
    ["Ask", "Describe what you want researched, in plain language."],
    ["Refine", "OpenAI asks a few clarifying questions, one at a time, then drafts a research brief you approve."],
    ["Research", "OpenAI Deep Research and Gemini Deep Research run in parallel on the same brief."],
    ["Receive", "A cited PDF report with both results lands in your Gmail inbox."],
  ];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-900 text-sm font-bold text-white">DR</span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900">Deep Research Assistant</h1>
        <p className="mt-2 text-base leading-relaxed text-slate-600">
          Two deep-research engines, one question. Get an in-depth, cited report from OpenAI and Gemini — delivered as a PDF to your inbox.
        </p>
      </div>
      <ol className="mb-8 space-y-3">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{i + 1}</span>
            <p className="text-sm leading-relaxed text-slate-700">
              <span className="font-semibold text-slate-900">{title}.</span> {body}
            </p>
          </li>
        ))}
      </ol>
      <GoogleSignInButton />
      <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
        {gmail
          ? "Sign-in also asks for permission to send email from your Gmail account, so the report can be delivered to your own inbox. We never read your mail."
          : "Reports are emailed to the Gmail address you sign in with."}
      </p>
    </main>
  );
}

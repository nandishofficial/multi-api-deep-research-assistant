# Video walkthrough outline (5–10 minutes)

A suggested script for the demo recording. Times are approximate.

## 0:00 – 0:45 · Intro
- What the app does: one question goes to two deep-research engines, and a cited PDF arrives by email.
- Stack: Next.js 16 (App Router) + TypeScript, Better Auth (Google), Drizzle + Postgres, OpenAI Responses API, Gemini Interactions API, pdfmake, Gmail API.

## 0:45 – 1:30 · Gmail login (on a phone-sized window)
- Landing page → **Sign in with Google**.
- Point out the consent screen's "Send email on your behalf" (`gmail.send`, offline access). Mention that the refresh token is encrypted at rest.
- Show the dashboard: new research form and history.

## 1:30 – 3:30 · Submit the reference query and refine
- Paste: *Help me find all the restaurants in Austin, Texas that do not use any seed oils in anything on their menu.*
- Status: "Preparing OpenAI refinement questions", then **"Awaiting OpenAI refinements"**.
- Answer the questions **one by one**: use a quick-pick, type a custom answer, show **Back** and **Skip**.
- The brief appears: OpenAI rewrote the request and answers into detailed researcher instructions. Edit one line to show it's editable, then **Approve & start research**.

## 3:30 – 5:00 · Automatic parallel research
- Status changes to **"Running OpenAI + Gemini deep research"**. Gemini starts automatically with the same approved prompt, with no refinement of its own.
- Show the per-provider cards: model, elapsed time, live search counts. Open the activity log.
- Close the tab to show the work continues server-side. Reopen the history to see the live status.

## 5:00 – 6:30 · Report by email
- (Cut to completion.) Open Gmail: subject, headline, executive summary, key insights, top sources, run stats, PDF attachment.
- Walk through the PDF:
  - cover page with metadata (timestamps, duration per provider, models, source counts)
  - contents
  - executive summary
  - **OpenAI Deep Research Results** and **Gemini Results** with numbered citations and source lists
  - appendix with the Q&A and the final brief
- In the app: summary, per-provider tabs, View PDF, Email again.

## 6:30 – 9:00 · Architecture and API-handling choices
- **Refinement:** the Deep Research API expects a complete brief and does not ask clarifying questions. The app follows OpenAI's recommended clarify → rewrite → research pipeline using structured outputs.
- **Background mode** for both providers: only the remote job IDs are persisted, and the adapters are stateless (`start` / `poll` / `cancel`).
- **Durable state machine in Postgres** with a **lease per row**. The worker loop, cron endpoint and request-triggered kicks can all advance it safely. Show `orchestrator.ts`.
- **Reliability:**
  - transient vs. permanent error classification, exponential backoff with jitter
  - one restart of a failed remote job, timeouts
  - model/agent fallback chains (`o3-deep-research` → `gpt-5.5`; Gemini agent versions)
  - partial results when one provider fails, Retry that resumes, Resend email
- **Citations:** OpenAI UTF-16 annotations and Gemini UTF-8 byte-offset annotations become numbered references.
- **Security:** session-scoped queries, CSRF checks, quotas, sanitized Markdown, sandboxed PDF renderer.
- **Tests:** `npm test` runs the whole lifecycle on embedded Postgres, plus provider, citation, PDF and email tests. CI runs lint, typecheck, tests and build.

## 9:00 – 10:00 · Wrap-up
- Deployment: Render blueprint (Docker + Postgres) or any Docker host. `.env.example` lists every setting.
- Possible next steps: provider webhooks instead of polling, streaming thought summaries, sharing reports.

/**
 * Domain types shared by the server and the browser. Keep this file free of
 * server-only imports.
 */

export const RESEARCH_STATUSES = [
  "clarifying", // OpenAI is generating refinement questions
  "awaiting_answers", // user is answering refinement questions one by one
  "refining", // OpenAI is rewriting the request into a research brief
  "awaiting_approval", // user reviews / edits / approves the brief
  "researching", // OpenAI Deep Research + Gemini Deep Research running
  "reporting", // building the executive summary + PDF
  "emailing", // delivering the PDF by email
  "completed",
  "failed",
  "cancelled",
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/** Statuses the background orchestrator is responsible for advancing. */
export const AUTOMATED_STATUSES: readonly ResearchStatus[] = [
  "clarifying",
  "refining",
  "researching",
  "reporting",
  "emailing",
];

export const TERMINAL_STATUSES: readonly ResearchStatus[] = ["completed", "failed", "cancelled"];

export type ProviderName = "openai" | "gemini";
export const PROVIDERS: readonly ProviderName[] = ["openai", "gemini"];

export type ProviderRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface RefinementQuestion {
  id: string;
  question: string;
  /** Why the answer matters for the research (shown as helper text). */
  rationale?: string;
  /** Optional quick-pick answers to speed up mobile input. */
  options: string[];
  answer: string | null;
  skipped: boolean;
  answeredAt: string | null;
}

export interface Source {
  /** 1-based citation number as rendered in the report. */
  n: number;
  url: string;
  title: string;
}

export interface ProviderRunMetadata {
  /** Model / agent requested first (before any fallback). */
  requestedModel?: string;
  /** Models that were tried and rejected as unavailable. */
  unavailableModels?: string[];
  remoteStatus?: string;
  searchCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  durationMs?: number;
  partial?: boolean;
  notes?: string[];
}

export interface ReportSummary {
  headline: string;
  executiveSummary: string;
  keyInsights: string[];
  /** Where the two providers agree / disagree. */
  comparison?: string;
  topSources: { title: string; url: string }[];
  generatedBy: "openai" | "heuristic";
}

/* ---------------------------------------------------------------------------
 * API DTOs
 * ------------------------------------------------------------------------- */

export interface ResearchListItem {
  id: string;
  title: string;
  query: string;
  status: ResearchStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  providers: { provider: ProviderName; status: ProviderRunStatus }[];
}

export interface ProviderRunView {
  provider: ProviderName;
  status: ProviderRunStatus;
  model: string | null;
  startedAt: string | null;
  completedAt: string | null;
  progressNote: string | null;
  lastError: string | null;
  sourceCount: number;
  outputPreview: string | null;
  metadata: ProviderRunMetadata | null;
}

export interface ResearchEventView {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface ResearchDetail {
  id: string;
  title: string;
  query: string;
  status: ResearchStatus;
  statusLabel: string;
  questions: RefinementQuestion[];
  refinedPrompt: string | null;
  finalPrompt: string | null;
  error: string | null;
  emailStatus: "pending" | "sent" | "failed" | null;
  emailSentAt: string | null;
  emailError: string | null;
  summary: ReportSummary | null;
  createdAt: string;
  updatedAt: string;
  researchStartedAt: string | null;
  completedAt: string | null;
  runs: ProviderRunView[];
  events: ResearchEventView[];
  reportAvailable: boolean;
}

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: "OpenAI Deep Research",
  gemini: "Gemini Deep Research",
};

export function statusLabel(status: ResearchStatus): string {
  switch (status) {
    case "clarifying":
      return "Preparing OpenAI refinement questions";
    case "awaiting_answers":
      return "Awaiting OpenAI refinements";
    case "refining":
      return "OpenAI is refining your research brief";
    case "awaiting_approval":
      return "Awaiting your approval of the research brief";
    case "researching":
      return "Running OpenAI + Gemini deep research";
    case "reporting":
      return "Compiling the PDF report";
    case "emailing":
      return "Emailing your report";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function isActive(status: ResearchStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

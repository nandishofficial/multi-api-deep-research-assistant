import type { ProviderName, ProviderRunMetadata, Source } from "@/lib/research-types";

export interface ProviderResult {
  /** Report body as Markdown; citations rendered as `[[n]](url)` links. */
  markdown: string;
  sources: Source[];
  metadata: ProviderRunMetadata;
}

export type PollResult =
  | { state: "running"; progressNote?: string; remoteStatus?: string }
  | { state: "completed"; result: ProviderResult }
  | { state: "failed"; error: string; retryable: boolean; remoteStatus?: string };

export interface StartResult {
  externalId: string;
  /** Model / agent that accepted the job (after any fallback). */
  model: string;
  /** Models that were tried first and rejected as unavailable. */
  unavailableModels: string[];
}

/**
 * A long-running, asynchronous deep-research backend. Implementations must be
 * stateless: everything needed to resume lives in the returned `externalId`,
 * so any worker process can poll a job started by another.
 */
export interface DeepResearchProvider {
  readonly name: ProviderName;
  start(input: { prompt: string; researchId: string }): Promise<StartResult>;
  poll(externalId: string): Promise<PollResult>;
  cancel(externalId: string): Promise<void>;
}

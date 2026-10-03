import "server-only";
import type { ProviderName } from "@/lib/research-types";
import { getEnv } from "@/server/env";
import { createEmailTransport, type EmailTransport } from "@/server/email/transport";
import { GeminiDeepResearchProvider } from "@/server/providers/gemini-deep-research";
import { MockDeepResearchProvider } from "@/server/providers/mock";
import { OpenAIDeepResearchProvider } from "@/server/providers/openai-deep-research";
import type { DeepResearchProvider } from "@/server/providers/types";
import { HeuristicSummarizer, OpenAISummarizer, type Summarizer } from "@/server/report/summary";
import { MockRefinementService, OpenAIRefinementService, type RefinementService } from "@/server/research/refinement";

/**
 * Composition root: picks real or simulated implementations from the
 * environment. Tests swap in their own via `setServicesForTesting`.
 */
export interface Services {
  providers: Record<ProviderName, DeepResearchProvider>;
  refinement: RefinementService;
  summarizer: Summarizer;
  /** Used when the primary summarizer fails. */
  fallbackSummarizer: Summarizer;
  email: EmailTransport;
}

let override: Partial<Services> | undefined;
let cached: Services | undefined;

function build(): Services {
  const env = getEnv();
  const mock = env.RESEARCH_MOCK_PROVIDERS;
  return {
    providers: mock
      ? {
          openai: new MockDeepResearchProvider("openai", env.MOCK_PROVIDER_DURATION_MS),
          gemini: new MockDeepResearchProvider("gemini", Math.round(env.MOCK_PROVIDER_DURATION_MS * 1.3)),
        }
      : { openai: new OpenAIDeepResearchProvider(), gemini: new GeminiDeepResearchProvider() },
    refinement: mock ? new MockRefinementService() : new OpenAIRefinementService(),
    summarizer: mock || !env.OPENAI_API_KEY ? new HeuristicSummarizer() : new OpenAISummarizer(),
    fallbackSummarizer: new HeuristicSummarizer(),
    email: createEmailTransport(env.EMAIL_PROVIDER),
  };
}

export function getServices(): Services {
  cached ??= build();
  return override ? { ...cached, ...override } : cached;
}

export function setServicesForTesting(services: Partial<Services> | undefined): void {
  override = services;
  cached = undefined;
}

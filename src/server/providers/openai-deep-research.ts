import "server-only";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { getEnv } from "@/server/env";
import { ClassifiedError, classifyError, errorMessage } from "@/server/util/errors";
import { DEEP_RESEARCH_INSTRUCTIONS } from "@/server/research/prompts";
import { applyCitations, type RawCitation } from "./citations";
import { getOpenAI } from "./openai-client";
import type { DeepResearchProvider, PollResult, StartResult } from "./types";

/** Models found to be unavailable for this API key during this process lifetime. */
const unavailable = new Set<string>();

export function isDeepResearchModel(model: string): boolean {
  return model.includes("deep-research");
}

/** Pure parser for a completed Responses API object — exported for tests. */
export function parseOpenAIResponse(response: Pick<OpenAIResponse, "output" | "usage">): {
  markdown: string;
  sources: ReturnType<typeof applyCitations>["sources"];
  searchCount: number;
} {
  const parts: string[] = [];
  const citations: RawCitation[] = [];
  let offset = 0;
  let searchCount = 0;

  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") searchCount++;
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text") continue;
      if (parts.length > 0) offset += 2; // "\n\n" joiner
      for (const a of content.annotations ?? []) {
        if (a.type === "url_citation") {
          citations.push({ url: a.url, title: a.title, start: a.start_index + offset, end: a.end_index + offset });
        }
      }
      parts.push(content.text);
      offset += content.text.length;
    }
  }

  const text = parts.join("\n\n");
  const { markdown, sources } = applyCitations(text, citations, { indexUnit: "utf16", fallbackUnits: ["codepoint"] });
  return { markdown, sources, searchCount };
}

export class OpenAIDeepResearchProvider implements DeepResearchProvider {
  readonly name = "openai" as const;

  private modelChain(): string[] {
    const env = getEnv();
    const chain = [env.OPENAI_DEEP_RESEARCH_MODEL, ...env.OPENAI_DEEP_RESEARCH_FALLBACK_MODELS];
    return [...new Set(chain)];
  }

  async start({ prompt, researchId }: { prompt: string; researchId: string }): Promise<StartResult> {
    const openai = getOpenAI();
    const env = getEnv();
    const chain = this.modelChain();
    const candidates = chain.filter((m) => !unavailable.has(m));
    if (candidates.length === 0) candidates.push(...chain); // everything failed before: try again from the top

    for (const model of candidates) {
      const deep = isDeepResearchModel(model);
      try {
        const response = await openai.responses.create({
          model,
          background: true,
          store: true,
          instructions: DEEP_RESEARCH_INSTRUCTIONS,
          input: prompt,
          // Deep research models require a data source; web search is ours.
          tools: [deep ? { type: "web_search_preview" } : { type: "web_search" }],
          reasoning: deep ? { summary: "auto" } : { effort: "high", summary: "auto" },
          ...(env.OPENAI_MAX_TOOL_CALLS ? { max_tool_calls: env.OPENAI_MAX_TOOL_CALLS } : {}),
          metadata: { research_id: researchId },
        });
        const skipped = chain.slice(0, chain.indexOf(model)).filter((m) => unavailable.has(m));
        return { externalId: response.id, model, unavailableModels: skipped };
      } catch (err) {
        const classified = classifyError(err);
        if (classified.kind === "model_unavailable") {
          unavailable.add(model);
          continue;
        }
        throw classified;
      }
    }
    throw new ClassifiedError(
      "permanent",
      `None of the configured OpenAI deep research models are available for this API key: ${chain.join(", ")}`,
    );
  }

  async poll(externalId: string): Promise<PollResult> {
    const openai = getOpenAI();
    let response: OpenAIResponse;
    try {
      response = await openai.responses.retrieve(externalId);
    } catch (err) {
      throw classifyError(err);
    }

    switch (response.status) {
      case "queued":
      case "in_progress": {
        const searches = (response.output ?? []).filter((o) => o.type === "web_search_call").length;
        return {
          state: "running",
          remoteStatus: response.status,
          progressNote:
            response.status === "queued"
              ? "Queued at OpenAI"
              : searches > 0
                ? `Researching — ${searches} web searches so far`
                : "Researching the web",
        };
      }
      case "completed":
      case "incomplete": {
        const parsed = parseOpenAIResponse(response);
        if (!parsed.markdown.trim()) {
          return {
            state: "failed",
            retryable: true,
            remoteStatus: response.status,
            error: `OpenAI returned no report text (status ${response.status}${response.incomplete_details?.reason ? `: ${response.incomplete_details.reason}` : ""})`,
          };
        }
        return {
          state: "completed",
          result: {
            markdown: parsed.markdown,
            sources: parsed.sources,
            metadata: {
              remoteStatus: response.status,
              searchCount: parsed.searchCount,
              inputTokens: response.usage?.input_tokens,
              outputTokens: response.usage?.output_tokens,
              reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
              partial: response.status === "incomplete",
              notes:
                response.status === "incomplete"
                  ? [`OpenAI marked the run incomplete (${response.incomplete_details?.reason ?? "unknown reason"}); partial output used.`]
                  : undefined,
            },
          },
        };
      }
      case "failed":
        return {
          state: "failed",
          retryable: true,
          remoteStatus: response.status,
          error: `OpenAI deep research failed: ${response.error?.message ?? "unknown error"}`,
        };
      case "cancelled":
        return { state: "failed", retryable: false, remoteStatus: response.status, error: "OpenAI run was cancelled" };
      default:
        return { state: "running", remoteStatus: String(response.status), progressNote: `OpenAI status: ${response.status}` };
    }
  }

  async cancel(externalId: string): Promise<void> {
    try {
      await getOpenAI().responses.cancel(externalId);
    } catch (err) {
      // Cancelling a finished response errors; that's fine.
      if (classifyError(err).kind === "transient") throw new Error(errorMessage(err));
    }
  }
}

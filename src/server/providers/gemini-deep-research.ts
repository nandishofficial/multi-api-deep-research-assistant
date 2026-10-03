import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getEnv } from "@/server/env";
import { ClassifiedError, classifyError } from "@/server/util/errors";
import { GEMINI_SYSTEM_INSTRUCTION } from "@/server/research/prompts";
import { applyCitations, extractSourcesFromMarkdown, type RawCitation } from "./citations";
import type { DeepResearchProvider, PollResult, StartResult } from "./types";

let client: GoogleGenAI | undefined;

function getGemini(): GoogleGenAI {
  const key = getEnv().GEMINI_API_KEY;
  if (!key) throw new ClassifiedError("permanent", "GEMINI_API_KEY is not configured");
  client ??= new GoogleGenAI({ apiKey: key });
  return client;
}

const unavailable = new Set<string>();

/* Loose structural types: the Interactions API is new and evolving, so parse defensively. */
interface TextBlock {
  type?: string;
  text?: string;
  annotations?: { type?: string; url?: string; title?: string; start_index?: number; end_index?: number }[];
}
interface InteractionLike {
  id: string;
  status?: string;
  steps?: { type?: string; content?: TextBlock[] }[];
  /** Pre-GA response shape. */
  outputs?: TextBlock[];
  output_text?: string;
  errors?: { code?: string; message?: string }[];
  error?: { message?: string };
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
}

function finalTextBlocks(interaction: InteractionLike): TextBlock[] {
  const steps = interaction.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.type !== "model_output") continue;
    const texts = (step.content ?? []).filter((c) => c.type === "text" && c.text?.trim());
    if (texts.length > 0) return texts;
  }
  const legacy = (interaction.outputs ?? []).filter((c) => c.type === "text" && c.text?.trim());
  if (legacy.length > 0) return legacy;
  return interaction.output_text ? [{ type: "text", text: interaction.output_text }] : [];
}

/** Pure parser — exported for tests. */
export function parseGeminiInteraction(interaction: InteractionLike) {
  const blocks = finalTextBlocks(interaction);
  const parts: string[] = [];
  const citations: RawCitation[] = [];
  let byteOffset = 0;
  for (const block of blocks) {
    const text = block.text ?? "";
    if (parts.length > 0) byteOffset += 2; // "\n\n"
    for (const a of block.annotations ?? []) {
      if (a.type === "url_citation" && a.url) {
        citations.push({
          url: a.url,
          title: a.title,
          start: a.start_index !== undefined ? a.start_index + byteOffset : undefined,
          end: a.end_index !== undefined ? a.end_index + byteOffset : undefined,
        });
      }
    }
    parts.push(text);
    byteOffset += Buffer.byteLength(text, "utf8");
  }
  const text = parts.join("\n\n");
  const searchCount = (interaction.steps ?? []).filter((s) => s.type === "google_search_call").length;
  const cited = applyCitations(text, citations, { indexUnit: "utf8", fallbackUnits: ["codepoint", "utf16"] });
  // The agent sometimes writes its own reference list instead of annotations.
  const sources = cited.sources.length > 0 ? cited.sources : extractSourcesFromMarkdown(text);
  return { markdown: cited.markdown, sources, searchCount };
}

export class GeminiDeepResearchProvider implements DeepResearchProvider {
  readonly name = "gemini" as const;

  private agentChain(): string[] {
    const env = getEnv();
    return [...new Set([env.GEMINI_DEEP_RESEARCH_AGENT, ...env.GEMINI_DEEP_RESEARCH_FALLBACK_AGENTS])];
  }

  async start({ prompt }: { prompt: string; researchId: string }): Promise<StartResult> {
    const gemini = getGemini();
    const chain = this.agentChain();
    const candidates = chain.filter((a) => !unavailable.has(a));
    if (candidates.length === 0) candidates.push(...chain);

    for (const agent of candidates) {
      try {
        const interaction = (await gemini.interactions.create({
          agent,
          input: prompt,
          system_instruction: GEMINI_SYSTEM_INSTRUCTION,
          background: true,
          store: true,
          agent_config: { type: "deep-research", thinking_summaries: "auto", visualization: "off" },
        })) as unknown as InteractionLike;
        if (!interaction?.id) throw new ClassifiedError("transient", "Gemini did not return an interaction id");
        const skipped = chain.slice(0, chain.indexOf(agent)).filter((a) => unavailable.has(a));
        return { externalId: interaction.id, model: agent, unavailableModels: skipped };
      } catch (err) {
        const classified = classifyError(err);
        if (classified.kind === "model_unavailable") {
          unavailable.add(agent);
          continue;
        }
        throw classified;
      }
    }
    throw new ClassifiedError(
      "permanent",
      `None of the configured Gemini Deep Research agents are available for this API key: ${chain.join(", ")}`,
    );
  }

  async poll(externalId: string): Promise<PollResult> {
    let interaction: InteractionLike;
    try {
      interaction = (await getGemini().interactions.get(externalId)) as unknown as InteractionLike;
    } catch (err) {
      throw classifyError(err);
    }
    const status = interaction.status ?? "in_progress";

    if (status === "queued" || status === "in_progress") {
      const searches = (interaction.steps ?? []).filter((s) => s.type === "google_search_call").length;
      return {
        state: "running",
        remoteStatus: status,
        progressNote:
          status === "queued"
            ? "Queued at Google"
            : searches > 0
              ? `Researching — ${searches} Google searches so far`
              : "Planning and researching",
      };
    }

    if (status === "completed" || status === "incomplete" || status === "budget_exceeded") {
      const parsed = parseGeminiInteraction(interaction);
      if (!parsed.markdown.trim()) {
        return { state: "failed", retryable: true, remoteStatus: status, error: `Gemini returned no report text (status ${status})` };
      }
      const partial = status !== "completed";
      return {
        state: "completed",
        result: {
          markdown: parsed.markdown,
          sources: parsed.sources,
          metadata: {
            remoteStatus: status,
            searchCount: parsed.searchCount,
            inputTokens: interaction.usage?.total_input_tokens,
            outputTokens: interaction.usage?.total_output_tokens,
            reasoningTokens: interaction.usage?.total_thought_tokens,
            partial,
            notes: partial ? [`Gemini finished with status "${status}"; partial output used.`] : undefined,
          },
        },
      };
    }

    const detail = interaction.errors?.map((e) => e.message).filter(Boolean).join("; ") || interaction.error?.message;
    if (status === "failed") {
      return { state: "failed", retryable: true, remoteStatus: status, error: `Gemini deep research failed${detail ? `: ${detail}` : ""}` };
    }
    if (status === "cancelled") {
      return { state: "failed", retryable: false, remoteStatus: status, error: "Gemini run was cancelled" };
    }
    if (status === "requires_action") {
      return {
        state: "failed",
        retryable: true,
        remoteStatus: status,
        error: "Gemini paused for user action (collaborative planning is disabled, so this is unexpected)",
      };
    }
    return { state: "running", remoteStatus: status, progressNote: `Gemini status: ${status}` };
  }

  async cancel(externalId: string): Promise<void> {
    try {
      await getGemini().interactions.cancel(externalId);
    } catch {
      // Already finished or not cancellable — nothing to do.
    }
  }
}

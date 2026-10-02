import "server-only";
import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { getEnv } from "@/server/env";
import { ClassifiedError, classifyError, withRetry } from "@/server/util/errors";

let client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  const key = getEnv().OPENAI_API_KEY;
  if (!key) throw new ClassifiedError("permanent", "OPENAI_API_KEY is not configured");
  client ??= new OpenAI({ apiKey: key, maxRetries: 2, timeout: 90_000 });
  return client;
}

/** Widely available fast models used when the configured one is rejected. */
const FAST_MODEL_FALLBACKS = ["gpt-5-mini", "gpt-4.1-mini"];
const unavailable = new Set<string>();

/**
 * Runs a (short, synchronous) Responses API call, retrying transient errors
 * and falling back to other fast models if the configured one is unavailable.
 */
export async function createFastResponse(
  preferredModel: string,
  params: Omit<ResponseCreateParamsNonStreaming, "model">,
): Promise<Response> {
  const chain = [...new Set([preferredModel, ...FAST_MODEL_FALLBACKS])];
  const candidates = chain.filter((m) => !unavailable.has(m));
  let lastError: ClassifiedError | undefined;
  for (const model of candidates.length ? candidates : chain) {
    try {
      return await withRetry(() => getOpenAI().responses.create({ ...params, model }));
    } catch (err) {
      lastError = classifyError(err);
      if (lastError.kind !== "model_unavailable") throw lastError;
      unavailable.add(model);
    }
  }
  throw lastError ?? new ClassifiedError("permanent", "No OpenAI model available");
}

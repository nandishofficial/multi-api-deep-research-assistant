import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RefinementQuestion } from "@/lib/research-types";
import { getEnv } from "@/server/env";
import { getOpenAI } from "@/server/providers/openai-deep-research";
import { withRetry } from "@/server/util/errors";
import { CLARIFY_SYSTEM_PROMPT, REWRITE_SYSTEM_PROMPT } from "./prompts";

export interface ClarifyResult {
  title: string;
  questions: RefinementQuestion[];
}

export interface RefinementService {
  /** Ask OpenAI whether (and what) to clarify before research starts. */
  clarify(query: string): Promise<ClarifyResult>;
  /** Turn the request + answers into the final research brief. */
  rewrite(query: string, questions: RefinementQuestion[]): Promise<string>;
}

const MAX_QUESTIONS = 4;

const ClarifySchema = z.object({
  title: z.string(),
  needs_clarification: z.boolean(),
  questions: z
    .array(z.object({ question: z.string(), rationale: z.string(), options: z.array(z.string()) }))
    .max(6),
});

/** JSON schema for OpenAI structured outputs (strict mode). */
const CLARIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "needs_clarification", "questions"],
  properties: {
    title: { type: "string", description: "Concise title for the research request (max 8 words)." },
    needs_clarification: { type: "boolean" },
    questions: {
      type: "array",
      maxItems: MAX_QUESTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "rationale", "options"],
        properties: {
          question: { type: "string" },
          rationale: { type: "string" },
          options: { type: "array", items: { type: "string" }, maxItems: 4 },
        },
      },
    },
  },
} as const;

export function formatQuestionsForPrompt(questions: RefinementQuestion[]): string {
  if (questions.length === 0) return "(No clarifying questions were asked.)";
  return questions
    .map((q, i) => {
      const answer = q.skipped || !q.answer?.trim() ? "(skipped — treat as unspecified / open-ended)" : q.answer.trim();
      return `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer}`;
    })
    .join("\n\n");
}

export function toQuestions(raw: { question: string; rationale?: string; options?: string[] }[]): RefinementQuestion[] {
  return raw
    .filter((q) => q.question.trim().length > 0)
    .slice(0, MAX_QUESTIONS)
    .map((q) => ({
      id: randomUUID(),
      question: q.question.trim(),
      rationale: q.rationale?.trim() || undefined,
      options: (q.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 4),
      answer: null,
      skipped: false,
      answeredAt: null,
    }));
}

export class OpenAIRefinementService implements RefinementService {
  async clarify(query: string): Promise<ClarifyResult> {
    const openai = getOpenAI();
    const response = await withRetry(() =>
      openai.responses.create({
        model: getEnv().OPENAI_REFINEMENT_MODEL,
        instructions: CLARIFY_SYSTEM_PROMPT,
        input: `Research request:\n"""\n${query}\n"""`,
        text: { format: { type: "json_schema", name: "clarifying_questions", schema: CLARIFY_JSON_SCHEMA, strict: true } },
      }),
    );
    const parsed = ClarifySchema.parse(JSON.parse(response.output_text));
    return {
      title: parsed.title.trim().slice(0, 120) || fallbackTitle(query),
      questions: parsed.needs_clarification ? toQuestions(parsed.questions) : [],
    };
  }

  async rewrite(query: string, questions: RefinementQuestion[]): Promise<string> {
    const openai = getOpenAI();
    const response = await withRetry(() =>
      openai.responses.create({
        model: getEnv().OPENAI_REFINEMENT_MODEL,
        instructions: REWRITE_SYSTEM_PROMPT,
        input: `Original research request:\n"""\n${query}\n"""\n\nClarifying questions and the user's answers:\n${formatQuestionsForPrompt(questions)}`,
      }),
    );
    const brief = response.output_text.trim();
    if (!brief) throw new Error("OpenAI returned an empty research brief");
    return brief;
  }
}

export function fallbackTitle(query: string): string {
  const firstLine = query.trim().split(/\n/)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || "Untitled research";
}

/** Deterministic stand-in used in mock mode and tests. */
export class MockRefinementService implements RefinementService {
  async clarify(query: string): Promise<ClarifyResult> {
    if (/\[no-questions\]/i.test(query)) return { title: fallbackTitle(query), questions: [] };
    return {
      title: fallbackTitle(query),
      questions: toQuestions([
        {
          question: "How strict should the criteria be?",
          rationale: "Determines whether partially-matching results are included or excluded.",
          options: ["Strict — only full matches", "Include partial matches, clearly labelled"],
        },
        {
          question: "Is there a time frame or recency requirement?",
          rationale: "Older sources may be out of date.",
          options: ["Last 12 months", "Last 3 years", "No limit"],
        },
        {
          question: "What output format is most useful?",
          rationale: "Shapes the structure of the final report.",
          options: ["Ranked list with a table", "Detailed narrative report", "Both"],
        },
      ]),
    };
  }

  async rewrite(query: string, questions: RefinementQuestion[]): Promise<string> {
    return `I want a thorough, well-cited research report on the following request:\n\n${query.trim()}\n\nMy clarifications:\n${formatQuestionsForPrompt(questions)}\n\nPlease structure the report with an executive summary, detailed findings, a comparison table, methodology and verification notes, caveats, and a conclusion. Cite every factual claim inline and prefer primary sources.`;
  }
}

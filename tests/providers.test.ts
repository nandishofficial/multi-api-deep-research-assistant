import { beforeEach, describe, expect, it, vi } from "vitest";
import { geminiInteractionFixture, openaiResponseFixture } from "./fixtures/reports";

const openaiCreate = vi.fn();
const openaiRetrieve = vi.fn();
vi.mock("@/server/providers/openai-client", () => ({
  getOpenAI: () => ({ responses: { create: openaiCreate, retrieve: openaiRetrieve, cancel: vi.fn() } }),
}));

const geminiCreate = vi.fn();
const geminiGet = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = { create: geminiCreate, get: geminiGet, cancel: vi.fn() };
  },
}));

const notFound = (what: string) => Object.assign(new Error(`The model \`${what}\` does not exist or you do not have access to it.`), { status: 404 });

beforeEach(async () => {
  // Fresh modules per test: providers keep a per-process "unavailable model" cache.
  vi.resetModules();
  const { setEnvForTesting } = await import("@/server/env");
  openaiCreate.mockReset();
  openaiRetrieve.mockReset();
  geminiCreate.mockReset();
  geminiGet.mockReset();
  setEnvForTesting({
    OPENAI_API_KEY: "sk-test",
    GEMINI_API_KEY: "g-test",
    OPENAI_DEEP_RESEARCH_MODEL: "o3-deep-research",
    OPENAI_DEEP_RESEARCH_FALLBACK_MODELS: ["gpt-5.5"],
    GEMINI_DEEP_RESEARCH_AGENT: "deep-research-preview-04-2026",
    GEMINI_DEEP_RESEARCH_FALLBACK_AGENTS: ["deep-research-pro-preview-12-2025"],
  });
});

describe("OpenAIDeepResearchProvider", () => {
  it("starts a background deep research run with web search", async () => {
    const { OpenAIDeepResearchProvider } = await import("@/server/providers/openai-deep-research");
    openaiCreate.mockResolvedValueOnce({ id: "resp_1" });
    const started = await new OpenAIDeepResearchProvider().start({ prompt: "brief", researchId: "r1" });
    expect(started).toEqual({ externalId: "resp_1", model: "o3-deep-research", unavailableModels: [] });
    const params = openaiCreate.mock.calls[0]![0];
    expect(params).toMatchObject({ model: "o3-deep-research", background: true, input: "brief", tools: [{ type: "web_search_preview" }] });
    expect(params.instructions).toMatch(/citation/i);
  });

  it("falls back to the next model when the deep research model is unavailable", async () => {
    const { OpenAIDeepResearchProvider } = await import("@/server/providers/openai-deep-research");
    openaiCreate.mockRejectedValueOnce(notFound("o3-deep-research")).mockResolvedValueOnce({ id: "resp_2" });
    const started = await new OpenAIDeepResearchProvider().start({ prompt: "brief", researchId: "r1" });
    expect(started).toEqual({ externalId: "resp_2", model: "gpt-5.5", unavailableModels: ["o3-deep-research"] });
    expect(openaiCreate.mock.calls[1]![0]).toMatchObject({ model: "gpt-5.5", tools: [{ type: "web_search" }], reasoning: { effort: "high" } });
  });

  it("maps response statuses to poll results", async () => {
    const { OpenAIDeepResearchProvider } = await import("@/server/providers/openai-deep-research");
    const p = new OpenAIDeepResearchProvider();
    openaiRetrieve.mockResolvedValueOnce({ status: "in_progress", output: [{ type: "web_search_call" }, { type: "web_search_call" }] });
    expect(await p.poll("resp_1")).toMatchObject({ state: "running", progressNote: "Researching — 2 web searches so far" });
    openaiRetrieve.mockResolvedValueOnce(openaiResponseFixture());
    const done = await p.poll("resp_1");
    expect(done.state).toBe("completed");
    if (done.state === "completed") {
      expect(done.result.sources).toHaveLength(3);
      expect(done.result.metadata).toMatchObject({ searchCount: 2, inputTokens: 1000, reasoningTokens: 3000 });
    }
    openaiRetrieve.mockResolvedValueOnce({ status: "failed", error: { message: "server_error" }, output: [] });
    expect(await p.poll("resp_1")).toMatchObject({ state: "failed", retryable: true });
  });

  it("classifies transient poll errors so the orchestrator retries", async () => {
    const { OpenAIDeepResearchProvider } = await import("@/server/providers/openai-deep-research");
    openaiRetrieve.mockRejectedValueOnce(Object.assign(new Error("Service Unavailable"), { status: 503 }));
    await expect(new OpenAIDeepResearchProvider().poll("resp_1")).rejects.toMatchObject({ kind: "transient" });
  });
});

describe("GeminiDeepResearchProvider", () => {
  it("starts a background Deep Research interaction with the agent", async () => {
    const { GeminiDeepResearchProvider } = await import("@/server/providers/gemini-deep-research");
    geminiCreate.mockResolvedValueOnce({ id: "int_1", status: "in_progress" });
    const started = await new GeminiDeepResearchProvider().start({ prompt: "brief", researchId: "r1" });
    expect(started.externalId).toBe("int_1");
    expect(geminiCreate.mock.calls[0]![0]).toMatchObject({
      agent: "deep-research-preview-04-2026",
      input: "brief",
      background: true,
      agent_config: { type: "deep-research" },
    });
  });

  it("falls back to an older agent version when the newest is unavailable", async () => {
    const { GeminiDeepResearchProvider } = await import("@/server/providers/gemini-deep-research");
    geminiCreate
      .mockRejectedValueOnce(Object.assign(new Error("Agent deep-research-preview-04-2026 not found"), { status: 404 }))
      .mockResolvedValueOnce({ id: "int_2" });
    const started = await new GeminiDeepResearchProvider().start({ prompt: "brief", researchId: "r1" });
    expect(started).toMatchObject({ externalId: "int_2", model: "deep-research-pro-preview-12-2025" });
  });

  it("polls to completion and parses the report", async () => {
    const { GeminiDeepResearchProvider } = await import("@/server/providers/gemini-deep-research");
    const p = new GeminiDeepResearchProvider();
    geminiGet.mockResolvedValueOnce({ id: "int_1", status: "in_progress", steps: [{ type: "google_search_call" }] });
    expect(await p.poll("int_1")).toMatchObject({ state: "running", progressNote: "Researching — 1 Google searches so far" });
    geminiGet.mockResolvedValueOnce(geminiInteractionFixture());
    const done = await p.poll("int_1");
    expect(done.state).toBe("completed");
    if (done.state === "completed") expect(done.result.sources.map((s) => s.url)).toEqual(["https://cafe.example/about", "https://kitchen.example/menu"]);
    geminiGet.mockResolvedValueOnce({ id: "int_1", status: "failed", errors: [{ message: "quota" }] });
    expect(await p.poll("int_1")).toMatchObject({ state: "failed", error: "Gemini deep research failed: quota" });
  });
});

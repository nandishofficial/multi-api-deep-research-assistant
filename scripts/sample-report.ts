/**
 * Renders a sample PDF from synthetic provider payloads so the report layout
 * can be reviewed without API keys:  npm run sample-report
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { geminiInteractionFixture, openaiResponseFixture } from "../tests/fixtures/reports";
import { parseGeminiInteraction } from "../src/server/providers/gemini-deep-research";
import { parseOpenAIResponse } from "../src/server/providers/openai-deep-research";
import { renderReportPdf } from "../src/server/report/pdf";
import { heuristicSummary } from "../src/server/report/summary";

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openai = parseOpenAIResponse(openaiResponseFixture() as any);
  const gemini = parseGeminiInteraction(geminiInteractionFixture());
  const query = "Help me find all the restaurants in Example City that do not use any seed oils in anything on their menu.";
  const started = new Date(Date.now() - 23 * 60_000);
  const summary = heuristicSummary({
    query,
    prompt: query,
    reports: [
      { provider: "openai", markdown: openai.markdown, sources: openai.sources },
      { provider: "gemini", markdown: gemini.markdown, sources: gemini.sources },
    ],
  });
  const pdf = await renderReportPdf({
    id: "sample",
    title: "Seed-oil-free restaurants in Example City",
    query,
    finalPrompt: "I want a complete list of restaurants...\n\n- Strict: no seed oils in **any** item\n- Include a table",
    questions: [
      { id: "1", question: "How strict?", options: [], answer: "Strict", skipped: false, answeredAt: null },
      { id: "2", question: "Price range?", options: [], answer: null, skipped: true, answeredAt: null },
    ],
    user: { name: "Sample User", email: "sample@example.com" },
    createdAt: new Date(started.getTime() - 5 * 60_000),
    researchStartedAt: started,
    generatedAt: new Date(),
    summary,
    runs: [
      { provider: "openai", status: "completed", model: "o3-deep-research", startedAt: started, completedAt: new Date(started.getTime() + 18 * 60_000), markdown: openai.markdown, sources: openai.sources, metadata: { searchCount: openai.searchCount }, error: null },
      { provider: "gemini", status: "completed", model: "deep-research-preview-04-2026", startedAt: started, completedAt: new Date(started.getTime() + 21 * 60_000), markdown: gemini.markdown, sources: gemini.sources, metadata: { searchCount: gemini.searchCount }, error: null },
    ],
  });
  const out = path.join(process.cwd(), ".data", "sample-report.pdf");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, pdf);
  console.log(`Wrote ${out} (${pdf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

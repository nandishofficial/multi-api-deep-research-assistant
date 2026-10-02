import { describe, expect, it } from "vitest";
import { buildMime } from "@/server/email/transport";
import { buildReportEmail, formatDuration } from "@/server/email/template";
import { markdownToPdfmake, tableWidths } from "@/server/report/markdown-to-pdfmake";
import { buildReportDocument, renderReportPdf, reportFilename, SECTION_TITLES, type ReportData } from "@/server/report/pdf";
import { heuristicSummary } from "@/server/report/summary";
import { sanitizeForFont } from "@/server/report/glyphs";
import { OPENAI_REPORT_TEXT } from "./fixtures/reports";

function sampleData(): ReportData {
  const now = new Date("2026-10-02T12:00:00Z");
  const summary = heuristicSummary({ query: "q", prompt: "p", reports: [{ provider: "openai", markdown: OPENAI_REPORT_TEXT, sources: [] }] });
  return {
    id: "r1",
    title: "Seed-oil-free restaurants",
    query: "Help me find restaurants without seed oils",
    finalPrompt: "I want **all** restaurants.",
    questions: [{ id: "q1", question: "Strict?", options: [], answer: "Yes", skipped: false, answeredAt: null }],
    user: { name: "U", email: "u@gmail.com" },
    createdAt: now,
    researchStartedAt: now,
    generatedAt: new Date(now.getTime() + 25 * 60_000),
    summary,
    runs: [
      { provider: "openai", status: "completed", model: "o3-deep-research", startedAt: now, completedAt: now, markdown: OPENAI_REPORT_TEXT, sources: [{ n: 1, url: "https://a.example", title: "A" }], metadata: { searchCount: 3 }, error: null },
      { provider: "gemini", status: "failed", model: null, startedAt: now, completedAt: null, markdown: null, sources: [], metadata: null, error: "boom" },
    ],
  };
}

describe("markdown → pdfmake", () => {
  it("renders headings, tables, lists and citation superscripts", () => {
    const content = markdownToPdfmake("# T\n\nText [[1]](https://a.example).\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- x\n- y", { headingOffset: 1 });
    const json = JSON.stringify(content);
    expect(json).toContain('"style":"h2"');
    expect(json).toContain('"sup":true');
    expect(json).toContain('"table"');
    expect(json).toContain('"ul"');
  });

  it("computes table widths that sum to ~100%", () => {
    const widths = tableWidths([["Restaurant", "Confidence"], ["A very long restaurant name here", "High"]]);
    const total = widths.reduce((s, w) => s + parseFloat(w), 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThanOrEqual(100.5);
  });

  it("replaces glyphs the embedded font cannot draw", () => {
    expect(sanitizeForFont("✅ ok ❌ no")).toBe("Yes ok No no");
    expect(sanitizeForFont("Café — “quoted”")).toBe("Café — “quoted”");
  });
});

describe("PDF report", () => {
  it("includes both required section titles and metadata", () => {
    const doc = buildReportDocument(sampleData());
    const json = JSON.stringify(doc.content);
    expect(json).toContain(SECTION_TITLES.openai);
    expect(json).toContain(SECTION_TITLES.gemini);
    expect(json).toContain("Executive Summary");
    expect(json).toContain("TOTAL RESEARCH TIME");
    expect(json).toContain("did not return results");
  });

  it("renders a valid PDF buffer", async () => {
    const pdf = await renderReportPdf(sampleData());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  it("builds a safe filename", () => {
    expect(reportFilename("Seed oils: Austin, TX!", new Date("2026-10-02T00:00:00Z"))).toBe("research-seed-oils-austin-tx-2026-10-02.pdf");
  });
});

describe("email", () => {
  it("escapes HTML and includes the summary", () => {
    const { subject, html, text } = buildReportEmail({
      title: "<script>x</script>",
      query: "q",
      summary: { headline: "H & co", executiveSummary: "S", keyInsights: ["i1"], comparison: "c", topSources: [{ title: "T", url: "https://t.example" }], generatedBy: "heuristic" },
      runs: [{ provider: "openai", status: "completed", sourceCount: 4, durationMs: 65_000, error: null }],
      researchUrl: "https://app.example/research/1",
      pdfFilename: "r.pdf",
    });
    expect(subject).toContain("<script>");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("H &amp; co");
    expect(text).toContain("1m 5s");
  });

  it("builds a MIME message with the PDF attached", async () => {
    const mime = (
      await buildMime(
        { to: "u@gmail.com", userId: "u", subject: "S", html: "<p>h</p>", text: "t", attachments: [{ filename: "r.pdf", content: Buffer.from("%PDF-1.7"), contentType: "application/pdf" }] },
        "u@gmail.com",
      )
    ).toString();
    expect(mime).toContain("Content-Type: multipart/mixed");
    expect(mime).toContain('filename=r.pdf');
    expect(mime).toContain("To: u@gmail.com");
  });

  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(3_725_000)).toBe("1h 2m");
  });
});

import { describe, expect, it } from "vitest";
import { applyCitations, cleanUrl, extractSourcesFromMarkdown } from "@/server/providers/citations";
import { parseGeminiInteraction } from "@/server/providers/gemini-deep-research";
import { parseOpenAIResponse } from "@/server/providers/openai-deep-research";
import { geminiInteractionFixture, openaiResponseFixture } from "./fixtures/reports";

describe("cleanUrl", () => {
  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(cleanUrl("https://a.com/x?utm_source=openai")).toBe("https://a.com/x");
    expect(cleanUrl("https://a.com/x?id=3&utm_medium=y")).toBe("https://a.com/x?id=3");
    expect(cleanUrl("not a url")).toBe("not a url");
  });
});

describe("applyCitations", () => {
  it("replaces OpenAI-style inline link citations with numbered markers and dedupes sources", () => {
    const text = "Claim one ([a.com](https://a.com/p?utm_source=openai)). Claim two ([b.org](https://b.org/q)). Again ([a.com](https://a.com/p?utm_source=openai)).";
    const cites = [
      { url: "https://a.com/p?utm_source=openai", title: "A", needle: "([a.com](https://a.com/p?utm_source=openai))" },
      { url: "https://b.org/q", title: "B", needle: "([b.org](https://b.org/q))" },
    ].flatMap((c) => {
      const out = [];
      let i = text.indexOf(c.needle);
      while (i >= 0) {
        out.push({ url: c.url, title: c.title, start: i, end: i + c.needle.length });
        i = text.indexOf(c.needle, i + 1);
      }
      return out;
    });
    const { markdown, sources } = applyCitations(text, cites, { indexUnit: "utf16" });
    expect(sources).toEqual([
      { n: 1, url: "https://a.com/p", title: "A" },
      { n: 2, url: "https://b.org/q", title: "B" },
    ]);
    expect(markdown).toBe("Claim one [[1]](https://a.com/p). Claim two [[2]](https://b.org/q). Again [[1]](https://a.com/p).");
  });

  it("appends markers after attributed segments using UTF-8 byte offsets", () => {
    const text = "Café — great. Next sentence.";
    const seg = "Café — great.";
    const { markdown, sources } = applyCitations(
      text,
      [{ url: "https://c.example/", title: "C", start: 0, end: Buffer.byteLength(seg, "utf8") }],
      { indexUnit: "utf8" },
    );
    expect(markdown).toBe("Café — great.[[1]](https://c.example/) Next sentence.");
    expect(sources).toHaveLength(1);
  });

  it("converts leftover parenthesised link citations even without annotations", () => {
    const { markdown, sources } = applyCitations("Fact ([x.com](https://x.com/a)).", [], { indexUnit: "utf16" });
    expect(markdown).toBe("Fact [[1]](https://x.com/a).");
    expect(sources[0]).toMatchObject({ n: 1, url: "https://x.com/a", title: "x.com" });
  });

  it("extracts sources from a trailing references section", () => {
    const md = "# Report\n\nBody\n\n## Sources\n\n1. [Alpha](https://alpha.example/a)\n2. https://beta.example/b.";
    expect(extractSourcesFromMarkdown(md).map((s) => s.url)).toEqual(["https://alpha.example/a", "https://beta.example/b"]);
  });
});

describe("provider parsers", () => {
  it("parses an OpenAI deep research response", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = parseOpenAIResponse(openaiResponseFixture() as any);
    expect(parsed.searchCount).toBe(2);
    expect(parsed.sources.map((s) => s.url)).toEqual([
      "https://example.com/guide",
      "https://kitchen.example/menu",
      "https://news.example.org/seed-oils-2025",
    ]);
    expect(parsed.markdown).not.toContain("utm_source");
    expect(parsed.markdown).toContain("entire menu [[1]](https://example.com/guide).");
    expect(parsed.markdown).toContain("| Example Kitchen | Downtown |");
  });

  it("parses a Gemini interaction with byte-offset annotations", () => {
    const parsed = parseGeminiInteraction(geminiInteractionFixture());
    expect(parsed.searchCount).toBe(1);
    expect(parsed.sources.map((s) => s.title)).toEqual(["Café Exemplo — About", "Example Kitchen menu"]);
    expect(parsed.markdown).toContain("never canola.[[1]](https://cafe.example/about)");
    expect(parsed.markdown).toContain("beef tallow.[[2]](https://kitchen.example/menu)");
  });

  it("falls back to legacy outputs / output_text for Gemini", () => {
    const parsed = parseGeminiInteraction({ id: "x", status: "completed", outputs: [{ type: "text", text: "# Legacy\n\nBody" }] });
    expect(parsed.markdown).toContain("Legacy");
    const viaText = parseGeminiInteraction({ id: "y", status: "completed", output_text: "Plain report" });
    expect(viaText.markdown).toBe("Plain report");
  });
});

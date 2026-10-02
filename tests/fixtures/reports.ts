/**
 * Synthetic provider payloads shaped like real OpenAI Responses / Gemini
 * Interactions results. Names and URLs are fictional (example.* domains).
 */

function annotateAll(text: string, needle: string, url: string, title: string) {
  const out: { start: number; end: number; url: string; title: string }[] = [];
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push({ start: i, end: i + needle.length, url, title });
    i = text.indexOf(needle, i + needle.length);
  }
  return out;
}

export const OPENAI_REPORT_TEXT = `# Seed-Oil-Free Dining in Example City

## Executive Summary

Only a handful of restaurants in Example City publicly commit to cooking **without any seed oils** across their entire menu ([example.com](https://example.com/guide?utm_source=openai)). The strongest commitments come from places that cook exclusively in beef tallow, butter, ghee or olive oil, and that state this on their official menus ([kitchen.example](https://kitchen.example/menu?utm_source=openai)).

## Restaurants Confirmed Seed-Oil-Free

| Restaurant | Neighborhood | Cooking fats | Evidence | Confidence |
|---|---|---|---|---|
| Example Kitchen | Downtown | Beef tallow, butter, olive oil | Official menu statement | High |
| Café Exemplo | East Side | Ghee, coconut oil | Owner interview, 2025 | Medium |
| The Placeholder Grill | South | Tallow (fryer), olive oil (dressings) | Instagram post + phone confirmation | Medium |

## Notes on Verification

- Menus were checked for fryer oil, dressings, sauces and baked goods ([kitchen.example](https://kitchen.example/menu?utm_source=openai)).
- Some places use seed oils only in purchased bread; those are excluded ([news.example.org](https://news.example.org/seed-oils-2025)).
- Inline code like \`tallow_fryer=true\` uses a monospace font.
- Emoji & symbols render safely: ✅ verified, ❌ excluded, ⚠️ unconfirmed → re-check.

> Policies change frequently; call ahead to confirm before visiting.

1. Start with official menus.
2. Confirm with staff.
   - Ask about fryer oil specifically.
   - Ask about dressings.

A very long URL for wrapping: https://example.com/a/really/long/path/that/keeps/going/and/going/to/test/wrapping/behaviour/in/pdf/output?with=query&and=more

## Conclusion

Example Kitchen is the most reliable fully seed-oil-free option ([example.com](https://example.com/guide?utm_source=openai)).`;

export function openaiResponseFixture() {
  const text = OPENAI_REPORT_TEXT;
  const annotations = [
    ...annotateAll(text, "([example.com](https://example.com/guide?utm_source=openai))", "https://example.com/guide?utm_source=openai", "Seed-oil-free guide"),
    ...annotateAll(text, "([kitchen.example](https://kitchen.example/menu?utm_source=openai))", "https://kitchen.example/menu?utm_source=openai", "Example Kitchen — Menu"),
    ...annotateAll(text, "([news.example.org](https://news.example.org/seed-oils-2025))", "https://news.example.org/seed-oils-2025", "Local news: seed oils in 2025"),
  ].map((a) => ({ type: "url_citation" as const, start_index: a.start, end_index: a.end, url: a.url, title: a.title }));

  return {
    id: "resp_fixture",
    status: "completed" as const,
    output: [
      { type: "reasoning", id: "rs_1", summary: [] },
      { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "seed oil free restaurants" } },
      { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "search", query: "beef tallow restaurant menu" } },
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations }],
      },
    ],
    usage: { input_tokens: 1000, output_tokens: 5000, output_tokens_details: { reasoning_tokens: 3000 } },
  };
}

export const GEMINI_REPORT_TEXT = `# Gemini Findings for Example City

## Overview

Café Exemplo cooks with ghee and coconut oil — never canola. Example Kitchen fries in beef tallow.

## Details

| Venue | Fat used |
|---|---|
| Café Exemplo | Ghee |
| Example Kitchen | Tallow |

Prices are reasonable 💰 for the area.`;

function utf8Index(text: string, utf16Index: number): number {
  return Buffer.byteLength(text.slice(0, utf16Index), "utf8");
}

export function geminiInteractionFixture() {
  const text = GEMINI_REPORT_TEXT;
  const s1 = "Café Exemplo cooks with ghee and coconut oil — never canola.";
  const s2 = "Example Kitchen fries in beef tallow.";
  const i1 = text.indexOf(s1);
  const i2 = text.indexOf(s2);
  return {
    id: "int_fixture",
    status: "completed",
    steps: [
      { type: "thought", summary: [{ type: "text", text: "Planning" }] },
      { type: "google_search_call", id: "g1", arguments: { queries: ["seed oil free"] } },
      { type: "google_search_result", call_id: "g1", result: [] },
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text,
            annotations: [
              { type: "url_citation", url: "https://cafe.example/about", title: "Café Exemplo — About", start_index: utf8Index(text, i1), end_index: utf8Index(text, i1 + s1.length) },
              { type: "url_citation", url: "https://kitchen.example/menu", title: "Example Kitchen menu", start_index: utf8Index(text, i2), end_index: utf8Index(text, i2 + s2.length) },
            ],
          },
        ],
      },
    ],
    usage: { total_input_tokens: 800, total_output_tokens: 2400, total_thought_tokens: 900 },
  };
}

import { createRequire } from "node:module";
import path from "node:path";

/**
 * Report text often contains emoji and symbols (✅ ❌ ⚠️ ★) that the embedded
 * Roboto font has no glyphs for; pdfkit would render them as blank boxes.
 * Replace common ones with readable equivalents and drop the rest.
 */

const REPLACEMENTS: Record<string, string> = {
  "✅": "Yes",
  "✔": "Yes",
  "✓": "Yes",
  "☑": "[x]",
  "❌": "No",
  "✗": "No",
  "✘": "No",
  "❎": "No",
  "⚠": "(!)",
  "⭐": "*",
  "★": "*",
  "☆": "*",
  "🟢": "(green)",
  "🟡": "(yellow)",
  "🔴": "(red)",
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≈": "~",
  "≥": ">=",
  "≤": "<=",
  " ": " ",
};

let glyphCheck: ((cp: number) => boolean) | null | undefined;

function loadGlyphCheck(): ((cp: number) => boolean) | null {
  try {
    const require = createRequire(import.meta.url);
    const fontkit = require("fontkit") as { openSync: (p: string) => { hasGlyphForCodePoint: (cp: number) => boolean } };
    const fontPath = path.join(path.dirname(require.resolve("pdfmake/package.json")), "fonts", "Roboto", "Roboto-Regular.ttf");
    const font = fontkit.openSync(fontPath);
    const cache = new Map<number, boolean>();
    return (cp) => {
      let v = cache.get(cp);
      if (v === undefined) {
        v = font.hasGlyphForCodePoint(cp);
        cache.set(cp, v);
      }
      return v;
    };
  } catch {
    return null;
  }
}

export function sanitizeForFont(text: string): string {
  if (glyphCheck === undefined) glyphCheck = loadGlyphCheck();
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x2000) {
      out += ch === " " ? " " : ch;
      continue;
    }
    if (cp === 0xfe0f || cp === 0x200d) continue; // emoji variation selector / joiner
    if (glyphCheck ? glyphCheck(cp) : !REPLACEMENTS[ch] && cp < 0x2600) {
      out += ch;
      continue;
    }
    out += REPLACEMENTS[ch] ?? "";
  }
  return out;
}

import { Lexer, type Token, type Tokens } from "marked";
import type { Content, ContentText, TableCell } from "pdfmake/interfaces";
import { sanitizeForFont } from "./glyphs";
import { COLORS } from "./theme";

/**
 * Converts research-report Markdown into pdfmake content. Supports what the
 * providers actually emit: headings, paragraphs, emphasis, links, numbered
 * citation links (`[[n]](url)`), nested lists, task lists, tables,
 * blockquotes, code and rules. Raw HTML is reduced to text.
 */

type Inline = ContentText;

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  link?: string;
  code?: boolean;
}

export interface MarkdownRenderOptions {
  /** Heading depth offset: provider "# Title" renders one level below our section titles. */
  headingOffset?: number;
  /** Add headings up to this (rendered) level to the table of contents. 0 disables. */
  tocMaxLevel?: number;
  /** Prefix for heading ids, to keep anchors unique across sections. */
  idPrefix?: string;
  /** Base font size for body text. */
  fontSize?: number;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITY[e] ?? _m).replace(/&#(\d+);/g, (_m, n: string) =>
    String.fromCodePoint(Number(n)),
  );
}

const CITATION_TEXT = /^\[\d+\]$/;
const LONG_TOKEN = /\S{28,}/;

/** Shortens a URL for display (the link target stays complete). */
export function displayUrl(url: string, max = 60): string {
  const s = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function textFragment(text: string, style: InlineStyle): Inline {
  const clean = sanitizeForFont(decodeEntities(text));
  const frag: Inline = { text: clean };
  if (style.bold) frag.bold = true;
  if (style.italics) frag.italics = true;
  if (style.strike) frag.decoration = "lineThrough";
  if (style.code) {
    frag.font = "Courier";
    frag.background = COLORS.codeBg;
    frag.fontSize = 8.5;
  }
  if (style.link) {
    frag.link = style.link;
    frag.color = COLORS.link;
  }
  if (style.link || LONG_TOKEN.test(clean)) frag.wordBreak = "break-all";
  return frag;
}

function inlineTokens(tokens: Token[] | undefined, style: InlineStyle = {}): Inline[] {
  const out: Inline[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) out.push(...inlineTokens(t.tokens, style));
        else out.push(textFragment(t.text, style));
        break;
      }
      case "escape":
        out.push(textFragment((token as Tokens.Escape).text, style));
        break;
      case "strong":
        out.push(...inlineTokens((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineTokens((token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(...inlineTokens((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(textFragment((token as Tokens.Codespan).text, { ...style, code: true }));
        break;
      case "br":
        out.push({ text: "\n" });
        break;
      case "link": {
        const l = token as Tokens.Link;
        const label = l.text.trim();
        if (CITATION_TEXT.test(label)) {
          // Numbered citation marker → small superscript link.
          out.push({ text: label, link: l.href, color: COLORS.citation, sup: true, fontSize: 7 } as Inline);
        } else if (label === l.href || /^https?:\/\//.test(label)) {
          out.push(textFragment(displayUrl(l.href), { ...style, link: l.href }));
        } else {
          out.push(...inlineTokens(l.tokens, { ...style, link: l.href }));
        }
        break;
      }
      case "image": {
        const img = token as Tokens.Image;
        out.push(textFragment(`[Image: ${img.text || displayUrl(img.href)}]`, { ...style, link: img.href, italics: true }));
        break;
      }
      case "html": {
        const raw = (token as Tokens.HTML).text;
        if (/^<br\s*\/?>$/i.test(raw.trim())) out.push({ text: "\n" });
        else {
          const stripped = raw.replace(/<[^>]+>/g, "");
          if (stripped) out.push(textFragment(stripped, style));
        }
        break;
      }
      default: {
        const raw = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw ?? "";
        if (raw) out.push(textFragment(raw, style));
      }
    }
  }
  return out;
}

function plainText(tokens: Token[] | undefined): string {
  return inlineTokens(tokens)
    .map((f) => (typeof f.text === "string" ? f.text : ""))
    .join("")
    .trim();
}

/** Column width weights from content length, returned as percentages summing to 100. */
export function tableWidths(rows: string[][]): string[] {
  const cols = Math.max(...rows.map((r) => r.length));
  const weights: number[] = [];
  for (let c = 0; c < cols; c++) {
    const lens = rows.map((r) => (r[c] ?? "").length);
    const avg = lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1);
    const max = Math.max(...lens);
    // Never narrower than the longest single word (headers like "Confidence" must not split).
    const longestWord = Math.max(...rows.map((r) => Math.max(0, ...(r[c] ?? "").split(/\s+/).map((w) => w.length))));
    weights.push(Math.min(60, Math.max(7, avg + 0.25 * max, longestWord * 1.15)));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const pct = weights.map((w) => Math.max(6, Math.floor((w / total) * 1000) / 10));
  const sum = pct.reduce((a, b) => a + b, 0);
  pct[pct.length - 1] = Math.max(6, pct[pct.length - 1]! - (sum - 100));
  return pct.map((p) => `${p.toFixed(1)}%`);
}

export function markdownToPdfmake(markdown: string, options: MarkdownRenderOptions = {}): Content[] {
  const tokens = new Lexer({ gfm: true }).lex(markdown);
  const state = { headingCount: 0 };
  return blocks(tokens, { ...options, fontSize: options.fontSize ?? 10 }, state);
}

function blocks(tokens: Token[], opts: MarkdownRenderOptions, state: { headingCount: number }, tight = false): Content[] {
  const out: Content[] = [];
  const fontSize = opts.fontSize ?? 10;
  for (const token of tokens) {
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading": {
        const h = token as Tokens.Heading;
        const level = Math.min(4, h.depth + (opts.headingOffset ?? 0));
        const text = plainText(h.tokens);
        if (!text) break;
        const toc = opts.tocMaxLevel !== undefined && opts.tocMaxLevel > 0 && level <= opts.tocMaxLevel;
        state.headingCount++;
        out.push({
          text,
          style: `h${level}`,
          headlineLevel: level,
          id: `${opts.idPrefix ?? "h"}-${state.headingCount}`,
          ...(toc ? { tocItem: true, tocMargin: [12 * Math.max(0, level - 2), 0, 0, 0], tocStyle: "tocSub" } : {}),
        } as Content);
        break;
      }
      case "paragraph": {
        const p = token as Tokens.Paragraph;
        const inl = inlineTokens(p.tokens);
        if (inl.length) out.push({ text: inl, style: "body", fontSize, margin: tight ? [0, 0, 0, 2] : [0, 0, 0, 7] } as Content);
        break;
      }
      case "text": {
        // Bare text inside tight list items.
        const t = token as Tokens.Text;
        const inl = t.tokens ? inlineTokens(t.tokens) : [textFragment(t.text, {})];
        if (inl.length) out.push({ text: inl, style: "body", fontSize, margin: [0, 0, 0, 2] } as Content);
        break;
      }
      case "list":
        out.push(list(token as Tokens.List, opts, state));
        break;
      case "table":
        out.push(table(token as Tokens.Table, fontSize));
        break;
      case "blockquote": {
        const q = token as Tokens.Blockquote;
        out.push({
          table: { widths: ["*"], body: [[{ stack: blocks(q.tokens, { ...opts, tocMaxLevel: 0 }, state, true), margin: [8, 6, 6, 4] }]] },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: (i: number) => (i === 0 ? 3 : 0),
            vLineColor: () => COLORS.accentSoft,
            fillColor: () => COLORS.quoteBg,
          },
          margin: [0, 2, 0, 9],
        } as Content);
        break;
      }
      case "code": {
        const c = token as Tokens.Code;
        out.push({
          table: {
            widths: ["*"],
            body: [[{ text: sanitizeForFont(c.text), font: "Courier", fontSize: 8, preserveLeadingSpaces: true, margin: [6, 5, 6, 5] }]],
          },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => COLORS.codeBg },
          margin: [0, 2, 0, 9],
        } as Content);
        break;
      }
      case "hr":
        out.push({
          canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: COLORS.rule }],
          margin: [0, 6, 0, 10],
        } as Content);
        break;
      case "html": {
        const stripped = decodeEntities((token as Tokens.HTML).text.replace(/<[^>]+>/g, "")).trim();
        if (stripped) out.push({ text: sanitizeForFont(stripped), style: "body", fontSize, margin: [0, 0, 0, 7] } as Content);
        break;
      }
      default: {
        const raw = (token as { text?: string }).text;
        if (raw?.trim()) out.push({ text: sanitizeForFont(decodeEntities(raw)), style: "body", fontSize, margin: [0, 0, 0, 7] } as Content);
      }
    }
  }
  return out;
}

function list(l: Tokens.List, opts: MarkdownRenderOptions, state: { headingCount: number }): Content {
  const items: Content[] = l.items.map((item) => {
    const content = blocks(item.tokens, { ...opts, tocMaxLevel: 0 }, state, !l.loose);
    if (item.task) {
      const box = { text: item.checked ? "[x] " : "[ ] ", font: "Courier", fontSize: 8 } as Inline;
      const first = content[0] as ContentText | undefined;
      if (first && "text" in first) {
        first.text = [box, ...(Array.isArray(first.text) ? first.text : [first.text as Inline])] as Inline[];
      }
    }
    return content.length === 1 ? content[0]! : { stack: content };
  });
  const base = { margin: [0, 0, 0, 7], fontSize: opts.fontSize ?? 10, markerColor: COLORS.muted } as const;
  if (l.ordered) {
    const start = typeof l.start === "number" ? l.start : 1;
    return { ol: items, start, ...base } as Content;
  }
  return { ul: items, ...base } as Content;
}

function table(t: Tokens.Table, fontSize: number): Content {
  const cols = t.header.length;
  const small = cols >= 5 ? fontSize - 2.5 : cols >= 4 ? fontSize - 2 : fontSize - 1.5;
  const align = (i: number) => (t.align[i] === "center" ? "center" : t.align[i] === "right" ? "right" : "left");

  const header: TableCell[] = t.header.map((cell, i) => ({
    text: inlineTokens(cell.tokens, { bold: true }),
    style: "tableHeader",
    fontSize: small,
    alignment: align(i),
  }));
  const body: TableCell[][] = t.rows.map((row) =>
    Array.from({ length: cols }, (_v, i) => {
      const cell = row[i];
      return { text: cell ? inlineTokens(cell.tokens) : "", fontSize: small, alignment: align(i) } as TableCell;
    }),
  );

  const widths = tableWidths([t.header.map((c) => c.text), ...t.rows.map((r) => r.map((c) => c.text))]);
  return {
    table: { headerRows: 1, widths, body: [header, ...body], dontBreakRows: false, keepWithHeaderRows: 1 },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: (i: number) => (i <= 1 ? COLORS.accent : COLORS.rule),
      fillColor: (row: number) => (row === 0 ? COLORS.tableHeaderBg : row % 2 === 0 ? COLORS.zebra : null),
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 3, 0, 11],
  } as Content;
}

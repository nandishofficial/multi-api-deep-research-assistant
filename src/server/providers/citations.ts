import type { Source } from "@/lib/research-types";

/**
 * Turns provider-specific citation annotations into a uniform format:
 * numbered `[[n]](url)` markers in the Markdown plus an ordered source list.
 *
 * OpenAI annotates spans of `output_text` (usually inline `([site](url))`
 * links); Gemini annotates attributed segments with UTF-8 byte offsets. Both
 * map onto the same "replace the link or append a marker" strategy.
 */

export interface RawCitation {
  url: string;
  title?: string;
  start?: number;
  end?: number;
}

export type IndexUnit = "utf16" | "codepoint" | "utf8";

const TRACKING_PARAMS = [/^utm_/i, /^gclid$/i, /^fbclid$/i, /^ref_src$/i];

/** Removes tracking parameters (e.g. `utm_source=openai`) so equal sources dedupe. */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith("?")) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
}

function dedupeKey(url: string): string {
  return cleanUrl(url).replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Builds a lookup from offsets in `unit` to UTF-16 string offsets. */
function offsetMapper(text: string, unit: IndexUnit): (offset: number) => number {
  if (unit === "utf16") return (o) => Math.max(0, Math.min(text.length, o));
  const map: number[] = [];
  let utf16 = 0;
  for (const ch of text) {
    const width = unit === "utf8" ? Buffer.byteLength(ch, "utf8") : 1;
    for (let i = 0; i < width; i++) map.push(utf16);
    utf16 += ch.length;
  }
  map.push(utf16);
  return (o) => (o >= map.length ? text.length : map[Math.max(0, o)]!);
}

const LINK_SPAN = /^\s*\(?\s*(\[[^\]]*\]\([^)\s]+\)\s*[,;]?\s*)+\)?\s*$/;
const INLINE_CITATION_LINK = /\s?\(\s*\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)\s*\)/g;

class SourceRegistry {
  private byKey = new Map<string, Source>();
  readonly list: Source[] = [];

  add(url: string, title?: string): Source {
    const key = dedupeKey(url);
    const existing = this.byKey.get(key);
    if (existing) {
      if ((!existing.title || existing.title === hostOf(existing.url)) && title) existing.title = title;
      return existing;
    }
    const clean = cleanUrl(url);
    const source: Source = { n: this.list.length + 1, url: clean, title: title?.trim() || hostOf(clean) };
    this.byKey.set(key, source);
    this.list.push(source);
    return source;
  }

  get(url: string): Source | undefined {
    return this.byKey.get(dedupeKey(url));
  }
}

function marker(sources: Source[]): string {
  const uniq = [...new Map(sources.map((s) => [s.n, s])).values()].sort((a, b) => a.n - b.n);
  return uniq.map((s) => `[[${s.n}]](${s.url})`).join("");
}

/** Does the slice for these offsets look like what the annotation describes? */
function spanLooksRight(text: string, start: number, end: number, url: string): boolean {
  if (start < 0 || end > text.length || start > end) return false;
  const slice = text.slice(start, end);
  if (slice.includes("](")) return slice.includes(hostOf(url)) || LINK_SPAN.test(slice);
  return true;
}

export function applyCitations(
  text: string,
  citations: RawCitation[],
  options: { indexUnit: IndexUnit; fallbackUnits?: IndexUnit[] } = { indexUnit: "utf16" },
): { markdown: string; sources: Source[] } {
  const registry = new SourceRegistry();
  const valid = citations.filter((c) => /^https?:\/\//i.test(c.url ?? ""));

  // Number sources in reading order.
  const ordered = [...valid].sort((a, b) => (a.start ?? Number.MAX_SAFE_INTEGER) - (b.start ?? Number.MAX_SAFE_INTEGER));
  for (const c of ordered) registry.add(c.url, c.title);

  // Pick the first index unit whose offsets line up with the text.
  const units = [options.indexUnit, ...(options.fallbackUnits ?? [])];
  const indexed = valid.filter((c) => typeof c.start === "number" && typeof c.end === "number");
  let mapOffset: ((o: number) => number) | null = null;
  for (const unit of units) {
    const map = offsetMapper(text, unit);
    const ok = indexed.every((c) => spanLooksRight(text, map(c.start!), map(c.end!), c.url));
    if (ok) {
      mapOffset = map;
      break;
    }
  }

  let out = text;
  if (mapOffset && indexed.length > 0) {
    // Group annotations sharing a span, then edit from the end of the text backwards.
    const groups = new Map<string, { start: number; end: number; sources: Source[] }>();
    for (const c of indexed) {
      const start = mapOffset(c.start!);
      const end = mapOffset(c.end!);
      const key = `${start}:${end}`;
      const g = groups.get(key) ?? { start, end, sources: [] };
      g.sources.push(registry.get(c.url)!);
      groups.set(key, g);
    }
    let floor = Number.MAX_SAFE_INTEGER; // lowest offset already edited
    for (const g of [...groups.values()].sort((a, b) => b.end - a.end || b.start - a.start)) {
      const slice = out.slice(g.start, g.end);
      const m = marker(g.sources);
      if (g.end <= floor && LINK_SPAN.test(slice) && slice.trim().length > 0) {
        const lead = /^\s/.test(slice) || g.start === 0 || /\s$/.test(out.slice(0, g.start)) ? "" : " ";
        out = out.slice(0, g.start) + lead + m + out.slice(g.end);
        floor = g.start;
      } else {
        const at = Math.min(g.end, floor);
        if (out.slice(at, at + 3) === "[[" ) continue; // a marker already sits here
        out = out.slice(0, at) + m + out.slice(at);
        floor = Math.min(floor, at);
      }
    }
  }

  // Any remaining parenthesised citation links, e.g. "([nytimes.com](https://...))".
  out = out.replace(INLINE_CITATION_LINK, (_m, label: string, url: string) => {
    const s = registry.get(url) ?? registry.add(url, label);
    return ` ${marker([s])}`;
  });

  return { markdown: tidy(out), sources: registry.list };
}

/** Pulls `[title](url)` and bare URLs out of a trailing "Sources"/"References" section. */
export function extractSourcesFromMarkdown(markdown: string): Source[] {
  const registry = new SourceRegistry();
  const section = markdown.split(/^#{1,6}\s*(sources|references|works cited|bibliography|citations)\b.*$/im);
  const haystack = section.length > 1 ? section.slice(2).join("\n") : "";
  if (!haystack) return [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<>\]]+)/g;
  for (const m of haystack.matchAll(linkRe)) {
    const url = m[2] ?? m[3];
    if (url) registry.add(url.replace(/[.,;]+$/, ""), m[1]);
  }
  return registry.list;
}

function tidy(md: string): string {
  return md
    .replace(/[ \t]+(\[\[\d+\]\])/g, " $1")
    .replace(/(\]\([^)]+\))\s+([.,;:!?])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

import path from "node:path";
import pdfmakeModule from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import {
  PROVIDER_LABELS,
  type ProviderName,
  type ProviderRunMetadata,
  type ProviderRunStatus,
  type RefinementQuestion,
  type ReportSummary,
  type Source,
} from "@/lib/research-types";
import { formatDuration } from "@/server/email/template";
import { robotoDir } from "./fonts";
import { sanitizeForFont } from "./glyphs";
import { displayUrl, markdownToPdfmake } from "./markdown-to-pdfmake";
import { COLORS, STYLES } from "./theme";

export interface ReportRun {
  provider: ProviderName;
  status: ProviderRunStatus;
  model: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  markdown: string | null;
  sources: Source[];
  metadata: ProviderRunMetadata | null;
  error: string | null;
}

export interface ReportData {
  id: string;
  title: string;
  query: string;
  finalPrompt: string;
  questions: RefinementQuestion[];
  user: { name: string; email: string };
  createdAt: Date;
  researchStartedAt: Date | null;
  generatedAt: Date;
  summary: ReportSummary;
  runs: ReportRun[];
}

/** Section titles required by the spec. */
export const SECTION_TITLES: Record<ProviderName, string> = {
  openai: "OpenAI Deep Research Results",
  gemini: "Gemini Results",
};

const ACCENT: Record<ProviderName, string> = { openai: COLORS.openai, gemini: COLORS.gemini };

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d) + " UTC";
}

const T = (s: string) => sanitizeForFont(s);

function runDuration(run: ReportRun): number | null {
  if (run.metadata?.durationMs) return run.metadata.durationMs;
  if (run.startedAt && run.completedAt) return run.completedAt.getTime() - run.startedAt.getTime();
  return null;
}

function keyValueTable(rows: [string, string | Content][]): Content {
  return {
    table: {
      widths: [110, "*"],
      body: rows.map(([k, v]) => [
        { text: k.toUpperCase(), style: "label", margin: [0, 3, 0, 3] },
        typeof v === "string" ? { text: T(v), fontSize: 9.5, color: COLORS.ink, margin: [0, 2, 0, 2] } : v,
      ]),
    },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => COLORS.rule,
      paddingLeft: () => 0,
    },
  } as Content;
}

function coverPage(data: ReportData): Content[] {
  const completedRuns = data.runs.filter((r) => r.status === "completed");
  const totalMs = data.researchStartedAt ? data.generatedAt.getTime() - data.researchStartedAt.getTime() : null;
  return [
    {
      canvas: [{ type: "rect", x: -40, y: -40, w: 595.28, h: 8, color: COLORS.coverBand }],
    } as Content,
    { text: "DEEP RESEARCH REPORT", style: "label", fontSize: 9, margin: [0, 40, 0, 10] },
    { text: T(data.title), fontSize: 26, bold: true, color: COLORS.accent, lineHeight: 1.15, margin: [0, 0, 0, 14] },
    { text: T(data.summary.headline), fontSize: 13, color: COLORS.ink, lineHeight: 1.3, margin: [0, 0, 0, 26] },
    keyValueTable([
      ["Research request", data.query],
      ["Prepared for", `${data.user.name} <${data.user.email}>`],
      ["Report generated", fmtDate(data.generatedAt)],
      ["Request submitted", fmtDate(data.createdAt)],
      ["Total research time", formatDuration(totalMs)],
      [
        "Providers",
        {
          stack: data.runs.map((r) => ({
            text: [
              { text: `${PROVIDER_LABELS[r.provider]}: `, bold: true },
              r.status === "completed"
                ? `${r.model ?? "—"} · ${formatDuration(runDuration(r))} · ${r.sources.length} sources${r.metadata?.searchCount ? ` · ${r.metadata.searchCount} searches` : ""}${r.metadata?.partial ? " · partial" : ""}`
                : `${r.status}${r.error ? ` — ${T(r.error)}` : ""}`,
            ],
            fontSize: 9.5,
            margin: [0, 2, 0, 2],
          })),
        } as Content,
      ],
      ["Research ID", data.id],
    ]),
    completedRuns.length < data.runs.length
      ? ({
          table: {
            widths: ["*"],
            body: [
              [
                {
                  text: "Note: not every provider completed. The report includes the results that were available; see the provider sections for details.",
                  fontSize: 9,
                  color: COLORS.warnInk,
                  margin: [8, 6, 8, 6],
                },
              ],
            ],
          },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => COLORS.warnBg },
          margin: [0, 18, 0, 0],
        } as Content)
      : { text: "" },
    { toc: { title: { text: "Contents", style: "tocTitle" } }, margin: [0, 30, 0, 0], pageBreak: "before" } as Content,
  ];
}

function summarySection(data: ReportData): Content[] {
  const s = data.summary;
  const out: Content[] = [
    { text: "Executive Summary", style: "h1", tocItem: true, tocStyle: "tocMain", pageBreak: "before", id: "summary" } as Content,
    { text: T(s.executiveSummary), style: "body", fontSize: 10.5, margin: [0, 0, 0, 10] },
  ];
  if (s.keyInsights.length) {
    out.push({ text: "Key insights", style: "h3" });
    out.push({ ul: s.keyInsights.map((i) => ({ text: T(i), style: "body", margin: [0, 0, 0, 3] })), margin: [0, 0, 0, 8] } as Content);
  }
  if (s.comparison) {
    out.push({ text: "How the two providers compare", style: "h3" });
    out.push({ text: T(s.comparison), style: "body", margin: [0, 0, 0, 8] });
  }
  if (s.topSources.length) {
    out.push({ text: "Most important sources", style: "h3" });
    out.push({
      ol: s.topSources.map((src) => ({
        text: [
          { text: T(src.title), style: "sourceTitle" },
          { text: "  " },
          { text: displayUrl(src.url), link: src.url, style: "sourceUrl", wordBreak: "break-all" },
        ],
        margin: [0, 0, 0, 3],
      })),
    } as Content);
  }
  out.push({
    text: s.generatedBy === "openai" ? "Summary synthesized by OpenAI from both reports." : "Summary extracted from the provider reports.",
    style: "meta",
    italics: true,
    margin: [0, 10, 0, 0],
  });
  return out;
}

function sourcesList(sources: Source[], color: string): Content {
  return {
    table: {
      widths: [22, "*"],
      body: sources.map((s) => [
        { text: `[${s.n}]`, fontSize: 8.5, color, bold: true },
        {
          stack: [
            { text: T(s.title), style: "sourceTitle" },
            { text: displayUrl(s.url, 95), link: s.url, style: "sourceUrl", wordBreak: "break-all" },
          ],
          margin: [0, 0, 0, 3],
        },
      ]),
    },
    layout: "noBorders",
  } as Content;
}

function providerSection(run: ReportRun): Content[] {
  const title = SECTION_TITLES[run.provider];
  const color = ACCENT[run.provider];
  const out: Content[] = [
    {
      text: title,
      style: "h1",
      color,
      tocItem: true,
      tocStyle: "tocMain",
      pageBreak: "before",
      id: `section-${run.provider}`,
    } as Content,
    {
      text: [
        { text: "Model: ", bold: true },
        `${run.model ?? "—"}   `,
        { text: "Started: ", bold: true },
        `${fmtDate(run.startedAt)}   `,
        { text: "Finished: ", bold: true },
        `${fmtDate(run.completedAt)}   `,
        { text: "Duration: ", bold: true },
        `${formatDuration(runDuration(run))}`,
        ...(run.metadata?.searchCount ? [{ text: "   Searches: ", bold: true }, `${run.metadata.searchCount}`] : []),
        { text: "   Sources: ", bold: true },
        `${run.sources.length}`,
      ],
      style: "meta",
      margin: [0, 0, 0, 4],
    } as Content,
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.2, lineColor: color }], margin: [0, 4, 0, 12] } as Content,
  ];

  if (run.status !== "completed" || !run.markdown) {
    out.push({
      text: `This provider did not return results (${run.status}).${run.error ? ` Error: ${T(run.error)}` : ""}`,
      style: "body",
      italics: true,
      color: COLORS.muted,
    });
    return out;
  }

  for (const note of run.metadata?.notes ?? []) {
    out.push({ text: T(note), fontSize: 8.5, color: COLORS.warnInk, margin: [0, 0, 0, 6] });
  }

  out.push(...markdownToPdfmake(run.markdown, { headingOffset: 1, tocMaxLevel: 2, idPrefix: run.provider }));

  if (run.sources.length) {
    out.push({ text: `Sources (${run.sources.length})`, style: "h2", color, headlineLevel: 2 } as Content);
    out.push(sourcesList(run.sources, color));
  }
  return out;
}

function appendix(data: ReportData): Content[] {
  const answered = data.questions.filter((q) => !q.skipped && q.answer);
  return [
    { text: "Appendix: Research Brief & Refinements", style: "h1", tocItem: true, tocStyle: "tocMain", pageBreak: "before" } as Content,
    { text: "Original request", style: "h3" },
    { text: T(data.query), style: "body", margin: [0, 0, 0, 8] },
    { text: "OpenAI refinement questions", style: "h3" },
    data.questions.length === 0
      ? { text: "OpenAI judged the request specific enough; no clarifying questions were needed.", style: "body", italics: true }
      : ({
          ol: data.questions.map((q) => ({
            stack: [
              { text: T(q.question), bold: true, fontSize: 9.5 },
              {
                text: q.skipped || !q.answer ? "Skipped (left open-ended)" : T(q.answer),
                fontSize: 9.5,
                color: q.skipped ? COLORS.muted : COLORS.ink,
                italics: q.skipped,
              },
            ],
            margin: [0, 0, 0, 5],
          })),
        } as Content),
    {
      text: `${answered.length} of ${data.questions.length} questions answered.`,
      style: "meta",
      margin: [0, 4, 0, 10],
    },
    { text: "Final research brief (sent to both providers)", style: "h3" },
    ...markdownToPdfmake(data.finalPrompt, { headingOffset: 3, fontSize: 9 }),
  ];
}

export function buildReportDocument(data: ReportData): TDocumentDefinitions {
  const order: ProviderName[] = ["openai", "gemini"];
  const runs = order.map((p) => data.runs.find((r) => r.provider === p)).filter((r): r is ReportRun => Boolean(r));
  const shortTitle = data.title.length > 70 ? `${data.title.slice(0, 67)}…` : data.title;

  return {
    pageSize: "A4",
    pageMargins: [40, 56, 40, 54],
    info: {
      title: data.title,
      author: "Deep Research Assistant",
      subject: data.query.slice(0, 250),
      keywords: "deep research, OpenAI, Gemini",
      creator: "Deep Research Assistant",
    },
    defaultStyle: { font: "Roboto", fontSize: 10, color: COLORS.ink },
    styles: STYLES,
    header: (currentPage: number) =>
      currentPage === 1
        ? null
        : {
            columns: [
              { text: "Deep Research Report", style: "meta", fontSize: 8 },
              { text: T(shortTitle), style: "meta", fontSize: 8, alignment: "right" },
            ],
            margin: [40, 24, 40, 0],
          },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Generated ${fmtDate(data.generatedAt)}`, style: "meta", fontSize: 7.5 },
        { text: `Page ${currentPage} of ${pageCount}`, style: "meta", fontSize: 7.5, alignment: "right" },
      ],
      margin: [40, 18, 40, 0],
    }),
    // Keep headings with the content that follows them.
    pageBreakBefore: (node, nodeQueries) =>
      Boolean(node.headlineLevel && !node.pageBreak && nodeQueries.getFollowingNodesOnPage().length === 0),
    content: [...coverPage(data), ...summarySection(data), ...runs.flatMap(providerSection), ...appendix(data)],
  };
}

type PdfMakeServer = {
  addFonts: (f: Record<string, Record<string, string>>) => void;
  setUrlAccessPolicy: (cb: (url: string) => boolean) => void;
  setLocalAccessPolicy: (cb: (p: string) => boolean) => void;
  createPdf: (doc: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> };
};

const STANDARD_FONTS = new Set(["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"]);

let pdfmake: PdfMakeServer | undefined;

function getPdfMake(): PdfMakeServer {
  if (pdfmake) return pdfmake;
  const instance = pdfmakeModule as unknown as PdfMakeServer;
  const fontDir = robotoDir();
  instance.addFonts({
    Roboto: {
      normal: path.join(fontDir, "Roboto-Regular.ttf"),
      bold: path.join(fontDir, "Roboto-Medium.ttf"),
      italics: path.join(fontDir, "Roboto-Italic.ttf"),
      bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
    },
    Courier: { normal: "Courier", bold: "Courier-Bold", italics: "Courier-Oblique", bolditalics: "Courier-BoldOblique" },
  });
  // Reports are built from untrusted model output: never fetch remote resources or read arbitrary files.
  instance.setUrlAccessPolicy(() => false);
  // Standard PDF fonts (Courier) are referenced by name; everything else must be one of our font files.
  instance.setLocalAccessPolicy((p) => STANDARD_FONTS.has(p) || path.resolve(p).startsWith(fontDir));
  pdfmake = instance;
  return instance;
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const doc = buildReportDocument(data);
  const buffer = await getPdfMake().createPdf(doc).getBuffer();
  return Buffer.from(buffer);
}

export function reportFilename(title: string, date: Date): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `research-${slug || "report"}-${date.toISOString().slice(0, 10)}.pdf`;
}

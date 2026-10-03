import { PROVIDER_LABELS, type ProviderName, type ProviderRunStatus, type ReportSummary } from "@/lib/research-types";

export interface ReportEmailInput {
  title: string;
  query: string;
  summary: ReportSummary;
  runs: { provider: ProviderName; status: ProviderRunStatus; sourceCount: number; durationMs: number | null; error: string | null }[];
  researchUrl: string;
  pdfFilename: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function runLine(r: ReportEmailInput["runs"][number]): string {
  if (r.status === "completed") return `${PROVIDER_LABELS[r.provider]}: completed in ${formatDuration(r.durationMs)} · ${r.sourceCount} sources`;
  return `${PROVIDER_LABELS[r.provider]}: ${r.status}${r.error ? ` (${r.error})` : ""}`;
}

export function buildReportEmail(input: ReportEmailInput): { subject: string; html: string; text: string } {
  const { summary } = input;
  const subject = `Your research report: ${input.title}`;

  const text = [
    `Your deep research report is ready: ${input.title}`,
    "",
    summary.headline,
    "",
    "EXECUTIVE SUMMARY",
    summary.executiveSummary,
    "",
    "KEY INSIGHTS",
    ...summary.keyInsights.map((i) => `• ${i}`),
    ...(summary.comparison ? ["", "OPENAI VS GEMINI", summary.comparison] : []),
    "",
    "TOP SOURCES",
    ...summary.topSources.map((s) => `• ${s.title} — ${s.url}`),
    "",
    "RUNS",
    ...input.runs.map((r) => `• ${runLine(r)}`),
    "",
    `The full report is attached (${input.pdfFilename}).`,
    `View it online: ${input.researchUrl}`,
  ].join("\n");

  const li = (items: string[]) => items.map((i) => `<li style="margin:0 0 8px 0;">${i}</li>`).join("");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#1e3a8a;padding:24px 24px 20px;color:#ffffff;">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;">Deep Research Report</div>
    <div style="font-size:22px;font-weight:700;line-height:1.3;margin-top:6px;">${esc(input.title)}</div>
  </td></tr>
  <tr><td style="padding:24px;">
    <p style="font-size:17px;font-weight:600;line-height:1.45;margin:0 0 16px;">${esc(summary.headline)}</p>
    <h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1e3a8a;margin:24px 0 8px;">Executive summary</h2>
    <p style="font-size:15px;line-height:1.6;margin:0;">${esc(summary.executiveSummary)}</p>
    ${summary.keyInsights.length ? `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1e3a8a;margin:24px 0 8px;">Key insights</h2><ul style="padding-left:20px;margin:0;font-size:15px;line-height:1.55;">${li(summary.keyInsights.map(esc))}</ul>` : ""}
    ${summary.comparison ? `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1e3a8a;margin:24px 0 8px;">OpenAI vs Gemini</h2><p style="font-size:15px;line-height:1.6;margin:0;">${esc(summary.comparison)}</p>` : ""}
    ${summary.topSources.length ? `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1e3a8a;margin:24px 0 8px;">Top sources</h2><ul style="padding-left:20px;margin:0;font-size:14px;line-height:1.5;">${li(summary.topSources.map((s) => `<a href="${esc(s.url)}" style="color:#1d4ed8;">${esc(s.title)}</a>`))}</ul>` : ""}
    <h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1e3a8a;margin:24px 0 8px;">Runs</h2>
    <ul style="padding-left:20px;margin:0;font-size:14px;line-height:1.5;color:#4b5563;">${li(input.runs.map((r) => esc(runLine(r))))}</ul>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;"><tr><td style="background:#1d4ed8;border-radius:8px;">
      <a href="${esc(input.researchUrl)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-weight:600;text-decoration:none;font-size:15px;">Open in Deep Research Assistant</a>
    </td></tr></table>
    <p style="font-size:13px;color:#6b7280;margin:16px 0 0;">The full report with both provider sections and all citations is attached as <strong>${esc(input.pdfFilename)}</strong>.</p>
  </td></tr>
  <tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#9ca3af;">Original request: ${esc(input.query.length > 300 ? `${input.query.slice(0, 297)}…` : input.query)}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

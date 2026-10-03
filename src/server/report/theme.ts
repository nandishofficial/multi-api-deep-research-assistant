import type { StyleDictionary } from "pdfmake/interfaces";

export const COLORS = {
  ink: "#1f2937",
  muted: "#6b7280",
  faint: "#9ca3af",
  accent: "#1e3a8a",
  accentSoft: "#93c5fd",
  openai: "#0f766e",
  gemini: "#1d4ed8",
  link: "#1d4ed8",
  citation: "#2563eb",
  rule: "#d1d5db",
  zebra: "#f8fafc",
  tableHeaderBg: "#eef2ff",
  quoteBg: "#f1f5f9",
  codeBg: "#f3f4f6",
  coverBand: "#1e3a8a",
  warnBg: "#fef3c7",
  warnInk: "#92400e",
} as const;

export const STYLES: StyleDictionary = {
  body: { fontSize: 10, lineHeight: 1.32, color: COLORS.ink },
  h1: { fontSize: 20, bold: true, color: COLORS.accent, margin: [0, 0, 0, 10] },
  h2: { fontSize: 15, bold: true, color: COLORS.accent, margin: [0, 14, 0, 6] },
  h3: { fontSize: 12.5, bold: true, color: COLORS.ink, margin: [0, 10, 0, 4] },
  h4: { fontSize: 11, bold: true, color: COLORS.ink, margin: [0, 8, 0, 3] },
  tableHeader: { bold: true, color: COLORS.accent },
  label: { fontSize: 8, bold: true, color: COLORS.muted, characterSpacing: 0.8 },
  meta: { fontSize: 9, color: COLORS.muted },
  tocTitle: { fontSize: 13, bold: true, color: COLORS.accent, margin: [0, 0, 0, 8] },
  tocMain: { fontSize: 10.5, bold: true, color: COLORS.ink },
  tocSub: { fontSize: 9.5, color: COLORS.muted },
  sourceTitle: { fontSize: 9, color: COLORS.ink },
  sourceUrl: { fontSize: 8, color: COLORS.link },
};

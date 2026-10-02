import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Locates the Roboto TTFs shipped with pdfmake. Resolved from the working
 * directory at runtime (not `require.resolve`, which bundlers rewrite), so it
 * works in dev, tests, `next start` and the standalone Docker build.
 */
export function robotoDir(): string {
  const candidates = [
    process.env.PDF_FONT_DIR,
    path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto"),
    path.join(process.cwd(), "..", "node_modules", "pdfmake", "fonts", "Roboto"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "Roboto-Regular.ttf"))) return dir;
  }
  throw new Error(`Roboto fonts for PDF rendering not found (looked in: ${candidates.join(", ")}). Set PDF_FONT_DIR.`);
}

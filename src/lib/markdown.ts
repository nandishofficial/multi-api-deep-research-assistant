import { Marked, type Tokens } from "marked";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const SAFE_URL = /^(https?:|mailto:)/i;

/**
 * Markdown → HTML for model-generated reports. Raw HTML is escaped, links are
 * restricted to http(s)/mailto and open in a new tab, images become links.
 */
const marked = new Marked({
  gfm: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      if (!SAFE_URL.test(token.href)) return text;
      const isCitation = /^\[\d+\]$/.test(token.text.trim());
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer nofollow"${isCitation ? ' class="cite"' : ""}>${text}</a>`;
    },
    image(token: Tokens.Image) {
      if (!SAFE_URL.test(token.href)) return escapeHtml(token.text);
      return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer nofollow">[image: ${escapeHtml(token.text || "link")}]</a>`;
    },
  },
});

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

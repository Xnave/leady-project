/**
 * Split chat message text into plain runs and http(s) URLs for hyperlink rendering.
 * Trailing punctuation (e.g. "https://x.com.") stays outside the href.
 */
export type MessageTextPart =
  | { kind: "text"; value: string }
  | { kind: "url"; href: string };

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT = /[),.;:!?]+$/;

function splitUrlMatch(raw: string): { href: string; trailing: string } {
  let href = raw;
  let trailing = "";
  const m = href.match(TRAILING_PUNCT);
  if (m) {
    trailing = m[0];
    href = href.slice(0, -trailing.length);
  }
  // Unbalanced closing paren often comes from "(https://…)" wrappers.
  if (href.endsWith(")") && (href.match(/\(/g)?.length ?? 0) < (href.match(/\)/g)?.length ?? 0)) {
    href = href.slice(0, -1);
    trailing = `)${trailing}`;
  }
  return { href, trailing };
}

export function parseMessageTextParts(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > last) {
      parts.push({ kind: "text", value: text.slice(last, index) });
    }
    const { href, trailing } = splitUrlMatch(raw);
    if (href) parts.push({ kind: "url", href });
    if (trailing) parts.push({ kind: "text", value: trailing });
    last = index + raw.length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}

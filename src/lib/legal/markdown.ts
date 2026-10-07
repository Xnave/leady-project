/**
 * Minimal Markdown parser for the legal pages: headings, paragraphs, lists, pipe tables,
 * blockquotes, **bold** and [links](url). The app ships no Markdown dependency, and these
 * documents only use this subset.
 */

export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 2 | 3; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "quote"; text: Inline[] };

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "link", text: m[2], href: m[3] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

const LIST_ITEM = /^(\d+\.|-)\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 2 | 3, text: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++].trim());
      const body = rows.filter((r, idx) => !(idx === 1 && /^\|[\s:|-]+\|$/.test(r)));
      blocks.push({ kind: "table", header: cells(body[0]), rows: body.slice(1).map(cells) });
      continue;
    }
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) parts.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: parseInline(parts.join(" ")) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[1] !== "-";
      const items: Inline[][] = [];
      let m: RegExpExecArray | null;
      while (i < lines.length && (m = LIST_ITEM.exec(lines[i].trim())) && (m[1] !== "-") === ordered) {
        items.push(parseInline(m[2]));
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l || /^(#{2,3}\s|\||>)/.test(l) || LIST_ITEM.test(l)) break;
      para.push(l);
      i++;
    }
    blocks.push({ kind: "paragraph", text: parseInline(para.join(" ")) });
  }
  return blocks;
}

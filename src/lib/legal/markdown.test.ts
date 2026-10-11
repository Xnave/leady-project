import { describe, expect, it } from "vitest";
import privacy from "@/lib/legal/content/privacy";
import terms from "@/lib/legal/content/terms";
import { parseInline, parseMarkdown } from "@/lib/legal/markdown";

describe("legal markdown", () => {
  it("parses bold and links inline", () => {
    expect(parseInline("a **b** [c](/privacy) d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "link", text: "c", href: "/privacy" },
      { kind: "text", text: " d" },
    ]);
  });

  it("parses headings, lists, tables, quotes and paragraphs", () => {
    const blocks = parseMarkdown(
      [
        "## Title",
        "",
        "First line",
        "continues",
        "",
        "1. one",
        "2. two",
        "- bullet",
        "",
        "| A | B |",
        "| --- | --- |",
        "| x | **y** |",
        "",
        "> quoted",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "table", "quote"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", text: [{ kind: "text", text: "First line continues" }] });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: true, items: [[{ text: "one" }], [{ text: "two" }]] });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[4]).toMatchObject({ kind: "table", header: [[{ text: "A" }], [{ text: "B" }]] });
    expect((blocks[4] as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("parses the shipped documents without leftover markup", () => {
    for (const doc of [privacy, terms]) {
      const blocks = parseMarkdown(doc);
      expect(blocks.length).toBeGreaterThan(20);
      const text = JSON.stringify(blocks);
      expect(text).not.toMatch(/<mark>|\*\*|\| ---/);
    }
    const headings = parseMarkdown(terms).filter((b) => b.kind === "heading" && b.level === 2);
    expect(headings).toHaveLength(3); // agreement + annex A + annex B
  });
});

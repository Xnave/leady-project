import { describe, expect, it } from "vitest";
import { parseMessageTextParts } from "@/lib/message-links";

describe("parseMessageTextParts", () => {
  it("leaves plain text alone", () => {
    expect(parseMessageTextParts("hello there")).toEqual([
      { kind: "text", value: "hello there" },
    ]);
  });

  it("extracts http(s) URLs", () => {
    expect(parseMessageTextParts("Book here: https://example.com/stay?x=1")).toEqual([
      { kind: "text", value: "Book here: " },
      { kind: "url", href: "https://example.com/stay?x=1" },
    ]);
  });

  it("strips trailing punctuation from the href", () => {
    expect(parseMessageTextParts("See https://example.com.")).toEqual([
      { kind: "text", value: "See " },
      { kind: "url", href: "https://example.com" },
      { kind: "text", value: "." },
    ]);
  });

  it("handles multiple links", () => {
    const parts = parseMessageTextParts("a https://a.test b https://b.test/c");
    expect(parts.filter((p) => p.kind === "url")).toEqual([
      { kind: "url", href: "https://a.test" },
      { kind: "url", href: "https://b.test/c" },
    ]);
  });
});

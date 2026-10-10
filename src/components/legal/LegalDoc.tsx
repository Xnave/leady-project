import Link from "next/link";
import type { ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/legal/markdown";

function inline(parts: Inline[]): ReactNode {
  return parts.map((p, i) => {
    if (p.kind === "bold") return <strong key={i}>{p.text}</strong>;
    if (p.kind === "link")
      return p.href.startsWith("/") ? (
        <Link key={i} href={p.href}>
          {p.text}
        </Link>
      ) : (
        <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
          {p.text}
        </a>
      );
    return p.text;
  });
}

/** Renders a Hebrew legal document. Always RTL: Hebrew is the binding text in every UI language. */
export function LegalDoc({ source }: { source: string }) {
  return (
    <article className="legal-doc" lang="he" dir="rtl">
      {parseMarkdown(source).map((b, i) => {
        switch (b.kind) {
          case "heading":
            return b.level === 2 ? <h2 key={i}>{inline(b.text)}</h2> : <h3 key={i}>{inline(b.text)}</h3>;
          case "paragraph":
            return <p key={i}>{inline(b.text)}</p>;
          case "quote":
            return <blockquote key={i}>{inline(b.text)}</blockquote>;
          case "list": {
            const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
            return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          case "table":
            return (
              <div key={i} className="legal-table">
                <table>
                  <thead>
                    <tr>
                      {b.header.map((c, j) => (
                        <th key={j}>{inline(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k}>{inline(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </article>
  );
}

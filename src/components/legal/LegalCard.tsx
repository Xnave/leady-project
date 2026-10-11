import Link from "next/link";
import { currentAgreementAcceptance } from "@/lib/legal/agreement";
import type { UiCopy, UiLang } from "@/lib/ui/types";

/**
 * Legal documents card at the bottom of /settings/team. Everyone who can open the page sees the
 * privacy policy; only the owner sees the signed agreement: version, date and who accepted it.
 */
export async function LegalCard({
  tenantId,
  owner,
  ui,
  lang,
}: {
  tenantId: string;
  owner: boolean;
  ui: UiCopy;
  lang: UiLang;
}) {
  const c = ui.legal.card;
  const row = owner ? await currentAgreementAcceptance(tenantId) : null;
  const date = row?.acceptedAt.toLocaleDateString(lang === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem" });

  return (
    <section className="card stack legal-card">
      <h2 className="legal-card-title">{c.title}</h2>
      {owner ? (
        <div className="legal-card-row">
          <div>
            <div className="legal-card-name">{ui.legal.agreement}</div>
            <p className="muted">
              {row
                ? `${c.version} ${row.version} · ${c.acceptedOn} ${date}${row.email ? ` · ${c.by} ${row.email}` : ""}`
                : c.notAccepted}
            </p>
          </div>
          <Link href="/agreement" className="legal-card-link">
            {c.view}
          </Link>
        </div>
      ) : null}
      <div className="legal-card-row">
        <div className="legal-card-name">{ui.legal.privacy}</div>
        <Link href="/privacy" className="legal-card-link">
          {c.view}
        </Link>
      </div>
    </section>
  );
}

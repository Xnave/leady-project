/**
 * Submit the platform number's WhatsApp templates - the daily digest
 * (src/lib/crm/digest-templates.ts) and instant owner alerts
 * (src/lib/crm/alerts.ts) - to Meta through Zernio, and read back their
 * review status.
 *
 * Usage:
 *   npx tsx scripts/digest-templates.ts status
 *   npx tsx scripts/digest-templates.ts submit <general|hospitality|appointments|approval|handoff|all>
 *
 * Needs ZERNIO_API_KEY and DIGEST_WHATSAPP_ACCOUNT_ID (the Zernio account of
 * the Zapidly platform number) in the environment or `.env`. Submitting goes
 * to Meta for real - Meta reviews within ~24h. A rejected template keeps its
 * name; fix the text in the catalog, bump the `_vN` suffix and submit again.
 */
import { ALERT_TEMPLATES } from "../src/lib/crm/alerts";
import {
  DIGEST_SECTORS,
  DIGEST_TEMPLATES,
  templateCreateBody,
  templateKey,
} from "../src/lib/crm/digest-templates";
import { createWhatsAppTemplate, listWhatsAppTemplates } from "../src/lib/zernio";

/** Every template the platform number sends, keyed by the name `submit` takes. */
const CATALOG = [
  ...DIGEST_SECTORS.map((s) => [s, DIGEST_TEMPLATES[s]] as const),
  ...(["approval", "handoff"] as const).map((k) => [k, ALERT_TEMPLATES[k]] as const),
];

async function main() {
  // tsx does not load `.env`; values already in the environment win.
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment
  }
  const [cmd, arg] = process.argv.slice(2);
  const accountId = process.env.DIGEST_WHATSAPP_ACCOUNT_ID ?? "";
  if (!accountId) throw new Error("Set DIGEST_WHATSAPP_ACCOUNT_ID (Zernio account of the platform number)");

  if (cmd === "status") {
    const live = new Map((await listWhatsAppTemplates(accountId)).map((t) => [templateKey(t.name, t.language), t]));
    for (const [key, t] of CATALOG) {
      const found = live.get(templateKey(t.name, t.language));
      const reason = found?.rejectedReason && found.rejectedReason !== "NONE" ? ` (${found.rejectedReason})` : "";
      console.log(`${key.padEnd(13)} ${t.name}:${t.language}  ${found?.status ?? "NOT SUBMITTED"}${reason}`);
    }
    return;
  }

  if (cmd === "submit") {
    const picked = arg === "all" ? CATALOG : CATALOG.filter(([key]) => key === arg);
    if (picked.length === 0) throw new Error(`submit <${CATALOG.map(([key]) => key).join("|")}|all>`);
    for (const [key, t] of picked) {
      try {
        const created = await createWhatsAppTemplate(templateCreateBody(t, accountId));
        console.log(`${key}: ${t.name} -> ${created?.status ?? "submitted"}`);
      } catch (err) {
        console.error(`${key}: ${t.name} failed -> ${String(err)}`);
      }
    }
    return;
  }

  throw new Error("Usage: digest-templates.ts status | submit <name|all>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

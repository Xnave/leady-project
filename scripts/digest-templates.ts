/**
 * Submit the daily-digest WhatsApp templates (src/lib/crm/digest-templates.ts)
 * to Meta through Zernio, and read back their review status.
 *
 * Usage:
 *   npx tsx scripts/digest-templates.ts status
 *   npx tsx scripts/digest-templates.ts submit <general|hospitality|appointments|all>
 *
 * Needs ZERNIO_API_KEY and DIGEST_WHATSAPP_ACCOUNT_ID (the Zernio account of
 * the Zapidly platform number) in the environment or `.env`. Submitting goes
 * to Meta for real - Meta reviews within ~24h. A rejected template keeps its
 * name; fix the text in the catalog, bump the `_vN` suffix and submit again.
 */
import {
  DIGEST_SECTORS,
  DIGEST_TEMPLATES,
  isDigestSector,
  templateCreateBody,
  templateKey,
} from "../src/lib/crm/digest-templates";
import { createWhatsAppTemplate, listWhatsAppTemplates } from "../src/lib/zernio";

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const accountId = process.env.DIGEST_WHATSAPP_ACCOUNT_ID ?? "";
  if (!accountId) throw new Error("Set DIGEST_WHATSAPP_ACCOUNT_ID (Zernio account of the platform number)");

  if (cmd === "status") {
    const live = new Map((await listWhatsAppTemplates(accountId)).map((t) => [templateKey(t.name, t.language), t]));
    for (const sector of DIGEST_SECTORS) {
      const t = DIGEST_TEMPLATES[sector];
      const found = live.get(templateKey(t.name, t.language));
      const reason = found?.rejectedReason && found.rejectedReason !== "NONE" ? ` (${found.rejectedReason})` : "";
      console.log(`${sector.padEnd(13)} ${t.name}:${t.language}  ${found?.status ?? "NOT SUBMITTED"}${reason}`);
    }
    return;
  }

  if (cmd === "submit") {
    const sectors = arg === "all" ? [...DIGEST_SECTORS] : isDigestSector(arg) ? [arg] : [];
    if (sectors.length === 0) throw new Error(`submit <${DIGEST_SECTORS.join("|")}|all>`);
    for (const sector of sectors) {
      const t = DIGEST_TEMPLATES[sector];
      try {
        const created = await createWhatsAppTemplate(templateCreateBody(t, accountId));
        console.log(`${sector}: ${t.name} -> ${created?.status ?? "submitted"}`);
      } catch (err) {
        console.error(`${sector}: ${t.name} failed -> ${String(err)}`);
      }
    }
    return;
  }

  throw new Error("Usage: digest-templates.ts status | submit <sector|all>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

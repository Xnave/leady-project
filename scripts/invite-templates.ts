/**
 * Submit the documents auto-invite templates (src/lib/documents/invite/templates.ts)
 * to Meta through Zernio on ONE tenant's own WhatsApp account, and read back
 * their review status. The client must hear from the advisor's number, so these
 * are per tenant, unlike the digest templates on the platform number.
 *
 * Usage:
 *   npx tsx scripts/invite-templates.ts status <tenantId>
 *   npx tsx scripts/invite-templates.ts submit <tenantId>
 *
 * Needs ZERNIO_API_KEY and DATABASE_URL in the environment or `.env`.
 * Submitting goes to Meta for real (review within ~24h). A rejected template
 * keeps its name: fix the text, bump the `_vN` suffix, submit again.
 */
export {};

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment
  }
  const { tenantWhatsAppAccount } = await import("../src/lib/campaigns/store");
  const { INVITE_TEMPLATES, inviteTemplateCreateBody } = await import("../src/lib/documents/invite/templates");
  const { createWhatsAppTemplate, listWhatsAppTemplates } = await import("../src/lib/zernio");
  const { prisma } = await import("../src/lib/db");

  const [cmd, tenantId] = process.argv.slice(2);
  if (!tenantId || (cmd !== "status" && cmd !== "submit")) {
    throw new Error("Usage: invite-templates.ts status|submit <tenantId>");
  }
  const account = await tenantWhatsAppAccount(tenantId);
  if (!account) throw new Error(`Tenant ${tenantId} has no live WhatsApp number connected through Zernio`);
  const templates = Object.values(INVITE_TEMPLATES);

  if (cmd === "status") {
    const live = await listWhatsAppTemplates(account.accountId);
    for (const t of templates) {
      const found = live.find((x) => x.name === t.name && x.language === t.language);
      const reason = found?.rejectedReason && found.rejectedReason !== "NONE" ? ` (${found.rejectedReason})` : "";
      console.log(`${t.kind.padEnd(9)} ${t.name}:${t.language}  ${found?.status ?? "NOT SUBMITTED"}${reason}`);
    }
  } else {
    for (const t of templates) {
      try {
        const created = await createWhatsAppTemplate(inviteTemplateCreateBody(t, account.accountId));
        console.log(`${t.kind}: ${t.name} -> ${created?.status ?? "submitted"}`);
      } catch (err) {
        console.error(`${t.kind}: ${t.name} failed -> ${String(err)}`);
      }
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

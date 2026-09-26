/**
 * Sends the WhatsApp daily digest: which leads are due, the per-tenant runner
 * with its `DigestLog` idempotency guard, and routing an owner's reply to the
 * full list. Everything here is a no-op unless `digestFeatureOn()` — see
 * `./flags`.
 */
import { prisma } from "@/lib/db";
import { leadDisplayName } from "@/lib/leads";
import { uiCopy } from "@/lib/ui";
import { sendWhatsAppTemplate, sendZernioInboxMessage } from "@/lib/zernio";
import {
  buildDigest,
  digestFullText,
  digestTemplateParams,
  localDateAndHour,
  pendingRecipients,
  phoneDigitsMatch,
  type DigestItem,
} from "./digest";
import { digestFeatureOn } from "./flags";
import { needsWhere } from "./needs";
import { isFollowUpReason } from "./types";
import { whereItStands } from "./view";

const env = (k: string, d = "") => process.env[k] ?? d;

/** Leads due for a nudge right now, tenant-scoped, demo leads excluded. */
export async function loadDueDigestItems(tenantId: string, now: Date): Promise<DigestItem[]> {
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      NOT: { externalUserId: { startsWith: "demo-" } },
      ...needsWhere(now),
    },
    select: {
      id: true,
      displayName: true,
      externalUserId: true,
      fields: true,
      followUpReason: true,
      followUpAt: true,
      nextStepText: true,
      conversations: { orderBy: { createdAt: "desc" }, take: 1, select: { summary: true } },
    },
    take: 200,
  });
  return leads
    .filter((l) => isFollowUpReason(l.followUpReason) && l.followUpAt)
    .map((l) => ({
      leadId: l.id,
      name: leadDisplayName(l),
      reason: l.followUpReason as DigestItem["reason"],
      stand: whereItStands({
        nextStepText: l.nextStepText,
        requestLine: null,
        summary: l.conversations[0]?.summary ?? null,
        intentLabel: null,
        lastLeadText: null,
      }),
      at: l.followUpAt!,
    }));
}

/**
 * Sends one tenant's digest for `now`, if it hasn't already gone out today
 * (tenant-local day) and there is at least one opted-in recipient with
 * something to report. No-op unless `digestFeatureOn()`.
 *
 * Items are loaded and the digest built BEFORE `DigestLog` is touched: an
 * empty digest writes nothing, so a later run the same day (once something
 * becomes due) can still send. Once the digest is non-empty, the day's log
 * row is claimed (found-or-created) and each successful send appends its
 * recipient's `clerkUserId` to `DigestLog.recipients` — so a retry after a
 * partial failure (one send throws mid-loop) only sends to whoever is still
 * missing from that list, instead of either re-sending to everyone or
 * skipping the whole day via `already_sent`.
 */
export async function runDigestForTenant(
  tenantId: string,
  now: Date,
): Promise<{ sent: number; skipped?: "already_sent" | "empty" | "no_recipients" }> {
  if (!digestFeatureOn()) return { sent: 0, skipped: "no_recipients" };
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true, digestEnabled: true, name: true, chatLanguage: true },
  });
  const { date } = localDateAndHour(now, tenant.timezone);
  const recipients = await prisma.digestRecipient.findMany({ where: { tenantId, optedInAt: { not: null } } });
  if (recipients.length === 0) return { sent: 0, skipped: "no_recipients" as const };

  const items = await loadDueDigestItems(tenantId, now);
  const digest = buildDigest(items);
  if (!digest) return { sent: 0, skipped: "empty" as const };

  // Find or create today's log row. The unique index means a concurrent
  // create loses the race harmlessly — re-read picks up whichever row won.
  let log = await prisma.digestLog.findUnique({ where: { tenantId_date: { tenantId, date } } });
  if (!log) {
    try {
      log = await prisma.digestLog.create({ data: { tenantId, date, itemCount: digest.total } });
    } catch {
      log = await prisma.digestLog.findUniqueOrThrow({ where: { tenantId_date: { tenantId, date } } });
    }
  }
  const sentIds = Array.isArray(log.recipients) ? [...(log.recipients as string[])] : [];
  const pending = pendingRecipients(recipients, sentIds);
  if (pending.length === 0) return { sent: 0, skipped: "already_sent" as const };

  let sent = 0;
  for (const r of pending) {
    const params = digestTemplateParams(digest, r.label || tenant.name);
    await sendWhatsAppTemplate({
      accountId: env("DIGEST_WHATSAPP_ACCOUNT_ID"),
      phone: r.phone,
      template: { name: env("DIGEST_TEMPLATE_NAME", "zapidly_daily_digest"), language: env("DIGEST_TEMPLATE_LANG", "he") },
      variables: Object.fromEntries(params.map((v, i) => [String(i + 1), v])),
    });
    sent++;
    sentIds.push(r.clerkUserId);
    // Persist after each send so a crash mid-loop still leaves an accurate
    // "who's done" list for the next retry.
    await prisma.digestLog.update({
      where: { tenantId_date: { tenantId, date } },
      data: { itemCount: digest.total, recipients: sentIds },
    });
  }
  return { sent };
}

/**
 * Owner replied to the digest (24h window now open): send the full list as
 * free text. Returns whether the inbound was handled here — the webhook route
 * must skip its normal tenant-channel routing when this returns true.
 *
 * `accountId !== DIGEST_WHATSAPP_ACCOUNT_ID` guarantees this never intercepts
 * a normal tenant's inbound message: a real tenant channel's `accountId`
 * cannot equal the platform digest number's account id.
 */
export async function handleDigestReply(o: { accountId: string; conversationId: string; from: string }): Promise<boolean> {
  const digestAccountId = env("DIGEST_WHATSAPP_ACCOUNT_ID");
  if (!digestFeatureOn() || !digestAccountId || o.accountId !== digestAccountId) return false;
  // Cross-tenant by necessity: the inbound arrives on the shared platform
  // number, before any tenant is known — the reply is matched to a tenant by
  // phone, scoped to recipients who have explicitly opted in.
  const recipients = await prisma.digestRecipient.findMany({ where: { optedInAt: { not: null } } });
  const r = recipients.find((x) => phoneDigitsMatch(x.phone, o.from));
  if (!r) return true; // our account, unknown sender: swallow, never route to a tenant agent
  const items = await loadDueDigestItems(r.tenantId, new Date());
  const ui = uiCopy(env("DIGEST_TEMPLATE_LANG", "he") === "en" ? "en" : "he");
  const text = items.length
    ? digestFullText(items, ui.crm.reasons, env("NEXT_PUBLIC_APP_URL"))
    : ui.crm.needsEmpty;
  await sendZernioInboxMessage({ accountId: o.accountId, conversationId: o.conversationId, text });
  return true;
}

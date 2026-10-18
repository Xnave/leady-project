/**
 * Sends the WhatsApp daily digest from the Zapidly platform number: which
 * leads are due, the per-tenant runner with its `DigestLog` idempotency guard,
 * and everything an owner can send back (confirm opt-in, unsubscribe, ask for
 * the full list). Everything here is a no-op unless `digestFeatureOn()` - see
 * `./flags`.
 */
import { prisma } from "@/lib/db";
import { leadDisplayName } from "@/lib/leads";
import { uiCopy } from "@/lib/ui";
import { listWhatsAppTemplates, sendWhatsAppTemplate, sendZernioInboxMessage } from "@/lib/zernio";
import {
  buildDigest,
  digestDelivery,
  digestFullText,
  localDateAndHour,
  parseOwnerCommand,
  pendingRecipients,
  phoneDigits,
  serviceWindowOpen,
  type DigestItem,
} from "./digest";
import {
  DIGEST_TEMPLATES,
  digestTemplateParams,
  digestTemplateText,
  pickDigestTemplate,
  resolveDigestSector,
} from "./digest-templates";
import { digestFeatureOn } from "./flags";
import { attentionWhere } from "./needs";
import { isFollowUpReason } from "./types";
import { whereItStands } from "./view";

const env = (k: string, d = "") => process.env[k] ?? d;

/** Leads due for a nudge right now, tenant-scoped, demo leads excluded. */
export async function loadDueDigestItems(tenantId: string, now: Date): Promise<DigestItem[]> {
  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      NOT: { externalUserId: { startsWith: "demo-" } },
      ...attentionWhere(now),
    },
    select: {
      id: true,
      displayName: true,
      externalUserId: true,
      fields: true,
      attentionReason: true,
      attentionAt: true,
      nextStepText: true,
      conversations: { orderBy: { createdAt: "desc" }, take: 1, select: { summary: true } },
    },
    take: 200,
  });
  return leads
    .filter((l) => isFollowUpReason(l.attentionReason) && l.attentionAt)
    .map((l) => ({
      leadId: l.id,
      name: leadDisplayName(l),
      reason: l.attentionReason as DigestItem["reason"],
      stand: whereItStands({
        nextStepText: l.nextStepText,
        requestLine: null,
        summary: l.conversations[0]?.summary ?? null,
        intentLabel: null,
        lastLeadText: null,
      }),
      at: l.attentionAt!,
    }));
}

/** Opt-in codes expire so a leaked screenshot can't be replayed later. */
const OPT_IN_CODE_TTL_MS = 24 * 60 * 60 * 1000;

function digestUi() {
  return uiCopy(env("DIGEST_TEMPLATE_LANG", "he") === "en" ? "en" : "he");
}

/**
 * `name:language` of every APPROVED template on the platform number. Read
 * once per cron run; an empty set (no account, Zernio down) just means every
 * recipient falls back to the free-text window or waits.
 */
export async function loadApprovedDigestTemplates(): Promise<string[]> {
  const accountId = env("DIGEST_WHATSAPP_ACCOUNT_ID");
  if (!accountId) return [];
  try {
    const templates = await listWhatsAppTemplates(accountId);
    return templates.filter((t) => t.status === "APPROVED").map((t) => `${t.name}:${t.language}`);
  } catch (err) {
    console.warn(JSON.stringify({ msg: "digest.templates_unavailable", error: String(err) }));
    return [];
  }
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
 * recipient's `clerkUserId` to `DigestLog.recipients` - so a retry after a
 * partial failure only sends to whoever is still missing from that list.
 *
 * Per recipient (`digestDelivery`): free text when their 24h window is open,
 * else the sector's approved template, else nothing (they get the full list
 * the next time they message the platform number). One recipient's failure
 * is logged and skipped; it never blocks the others.
 */
export async function runDigestForTenant(
  tenantId: string,
  now: Date,
  approvedTemplates: ReadonlySet<string> = new Set(),
): Promise<{ sent: number; waiting?: number; failed?: number; skipped?: "already_sent" | "empty" | "no_recipients" }> {
  if (!digestFeatureOn()) return { sent: 0, skipped: "no_recipients" };
  const accountId = env("DIGEST_WHATSAPP_ACCOUNT_ID");
  const [tenant, capabilities] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true, name: true, digestSector: true },
    }),
    prisma.capabilityInstance.findMany({ where: { tenantId }, select: { capabilityId: true, enabled: true } }),
  ]);
  const { date } = localDateAndHour(now, tenant.timezone);
  const recipients = await prisma.digestRecipient.findMany({ where: { tenantId, optedInAt: { not: null } } });
  if (recipients.length === 0) return { sent: 0, skipped: "no_recipients" as const };

  const items = await loadDueDigestItems(tenantId, now);
  const digest = buildDigest(items);
  if (!digest) return { sent: 0, skipped: "empty" as const };

  // Find or create today's log row. The unique index means a concurrent
  // create loses the race harmlessly - re-read picks up whichever row won.
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

  const sector = resolveDigestSector(tenant.digestSector, capabilities);
  const template = pickDigestTemplate(sector, approvedTemplates);
  // The recipient label is the staff email or role, never a first name, so
  // the greeting addresses the business.
  const params = digestTemplateParams(digest, tenant.name);
  let sent = 0;
  let waiting = 0;
  let failed = 0;
  for (const r of pending) {
    const how = digestDelivery({
      windowOpen: serviceWindowOpen(r.lastInboundAt, now),
      hasConversation: Boolean(r.conversationId),
      hasTemplate: Boolean(template),
    });
    try {
      if (how === "wait") {
        waiting++;
        console.log(JSON.stringify({ msg: "digest.waiting_for_owner", tenantId, recipientId: r.id }));
        continue;
      }
      if (how === "text") {
        await sendZernioInboxMessage({
          accountId,
          conversationId: r.conversationId,
          // Same wording as the template, approved or not, so the owner
          // reads one digest whichever path delivered it.
          text: digestTemplateText(DIGEST_TEMPLATES[sector], params, env("NEXT_PUBLIC_APP_URL")),
        });
      } else if (template) {
        const opened = await sendWhatsAppTemplate({
          accountId,
          phone: r.phone,
          template: { name: template.name, language: template.language },
          params,
        });
        if (opened.conversationId && opened.conversationId !== r.conversationId) {
          await prisma.digestRecipient.update({ where: { id: r.id }, data: { conversationId: opened.conversationId } });
        }
      }
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ msg: "digest.send_failed", tenantId, recipientId: r.id, how, error: String(err) }));
      continue;
    }
    sent++;
    sentIds.push(r.clerkUserId);
    // Persist after each send so a crash mid-loop still leaves an accurate
    // "who's done" list for the next retry.
    await prisma.digestLog.update({
      where: { tenantId_date: { tenantId, date } },
      data: { itemCount: digest.total, recipients: sentIds },
    });
  }
  return { sent, waiting, failed };
}

/**
 * An inbound message on the platform number. Returns whether it was handled
 * here - the webhook route must skip its normal tenant-channel routing when
 * this returns true.
 *
 * `accountId !== DIGEST_WHATSAPP_ACCOUNT_ID` guarantees this never intercepts
 * a normal tenant's inbound message: a real tenant channel's `accountId`
 * cannot equal the platform digest number's account id.
 *
 * Nothing is answered unless the webhook signature was verified: the sender
 * phone is the only identity here, and an unsigned request could claim any
 * owner's phone and read their leads.
 */
export async function handleDigestReply(o: {
  accountId: string;
  conversationId: string;
  from: string;
  text: string;
  signatureVerified: boolean;
}): Promise<boolean> {
  const digestAccountId = env("DIGEST_WHATSAPP_ACCOUNT_ID");
  if (!digestFeatureOn() || !digestAccountId || o.accountId !== digestAccountId) return false;
  if (!o.signatureVerified) {
    console.error(JSON.stringify({ msg: "digest.unsigned_reply_refused" }));
    return true;
  }
  const phone = phoneDigits(o.from);
  if (!phone) return true;
  const now = new Date();
  const ui = digestUi();
  const reply = (text: string) => sendZernioInboxMessage({ accountId: o.accountId, conversationId: o.conversationId, text });
  const command = parseOwnerCommand(o.text);

  // Cross-tenant by necessity: the inbound arrives on the shared platform
  // number, before any tenant is known. A recipient is found only by a
  // one-time code it was issued, or by a phone WhatsApp itself vouched for.
  if (command.kind === "start") {
    const pendingOptIn = await prisma.digestRecipient.findUnique({ where: { optInCode: command.code } });
    if (!pendingOptIn || !pendingOptIn.optInCodeAt || now.getTime() - pendingOptIn.optInCodeAt.getTime() > OPT_IN_CODE_TTL_MS) {
      await reply(ui.crm.digestCodeInvalid);
      return true;
    }
    const taken = await prisma.digestRecipient.findFirst({
      where: { phone, optedInAt: { not: null }, NOT: { id: pendingOptIn.id } },
      select: { id: true },
    });
    if (taken) {
      await reply(ui.crm.digestPhoneTaken);
      return true;
    }
    await prisma.digestRecipient.update({
      where: { id: pendingOptIn.id },
      data: { phone, optedInAt: now, optInCode: null, optInCodeAt: null, conversationId: o.conversationId, lastInboundAt: now },
    });
    await reply(ui.crm.digestConnected);
    return true;
  }

  const r = await prisma.digestRecipient.findFirst({ where: { phone, optedInAt: { not: null } } });
  if (!r) return true; // our account, unknown sender: swallow, never route to a tenant agent
  if (command.kind === "stop") {
    await prisma.digestRecipient.update({ where: { id: r.id }, data: { optedInAt: null, lastInboundAt: now } });
    await reply(ui.crm.digestStopped);
    return true;
  }
  await prisma.digestRecipient.update({ where: { id: r.id }, data: { lastInboundAt: now, conversationId: o.conversationId } });
  const items = await loadDueDigestItems(r.tenantId, now);
  await reply(items.length ? digestFullText(items, ui.crm.reasons, env("NEXT_PUBLIC_APP_URL")) : ui.crm.needsEmpty);
  return true;
}

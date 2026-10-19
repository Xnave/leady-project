import { persistInboundIfNew, loadTurnContext } from "@/lib/conversations";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { prisma } from "@/lib/db";
import { replyLang } from "@/lib/copy";
import { resolveReplyLanguage, isChatLanguage } from "@/lib/flow/locale";
import { enqueueAgentTurn, sendAndSave } from "@/lib/flow/run-turn";
import { rotateConversation } from "@/lib/flow/rotate-conversation";
import { personaGreeting } from "@/lib/persona/greeting";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { sendZernioInboxMessage, type ZernioInbound } from "@/lib/zernio";
import {
  decorateRapidDemoText,
  demoExpiredText,
  demoInUseText,
  tasksEmptyText,
  tasksListText,
  unboundCommandText,
} from "./copy";
import { demoBindDecision, parseDemoCode, parseDemoCommand } from "./guards";
import { formatHitlTaskLine } from "./outbound";

export function isSharedDemoAccount(inboundAccountId: string, sharedAccountId: string | null): boolean {
  return Boolean(sharedAccountId) && inboundAccountId === sharedAccountId;
}

const DEFAULT_WHATSAPP_NUMBER = "972555076806";

/** A hit can be reused. A miss is not cached, so a channel connected later still matches. */
let cachedAccountId: string | undefined;

/**
 * Match the shared demo number only when both sides are real phone lengths.
 * A channel id of "6" or "06" must not win just because the needle ends with it.
 * A national number (no country code) still matches the full international form.
 */
export function whatsappAccountMatches(accountDigits: string, needleDigits: string): boolean {
  if (accountDigits.length < 8 || needleDigits.length < 8) return false;
  return (
    accountDigits === needleDigits ||
    accountDigits.endsWith(needleDigits) ||
    needleDigits.endsWith(accountDigits)
  );
}

function digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Zernio account id of the WhatsApp number that hosts demos.
 * Set `RAPID_DEMO_WHATSAPP_ACCOUNT_ID` to skip the lookup. Without it, the
 * channel's digits must equal `RAPID_DEMO_WHATSAPP_NUMBER` exactly.
 */
export async function resolveRapidDemoAccountId(): Promise<string | null> {
  const pinned = process.env.RAPID_DEMO_WHATSAPP_ACCOUNT_ID?.trim();
  if (pinned) return pinned;
  if (cachedAccountId) return cachedAccountId;
  const needle = digits(process.env.RAPID_DEMO_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER);
  if (!whatsappAccountMatches(needle, needle)) return null;
  const channels = await prisma.channelConnection.findMany({
    where: { provider: "whatsapp", enabled: true, providerExternalId: { not: null } },
    select: { providerAccountId: true, providerExternalId: true },
  });
  const match = channels.find((channel) => {
    const external = channel.providerExternalId ?? "";
    if (external.startsWith("local-")) return false;
    return whatsappAccountMatches(digits(channel.providerAccountId), needle);
  });
  if (!match?.providerExternalId) return null;
  cachedAccountId = match.providerExternalId;
  return cachedAccountId;
}

async function demoLang(tenantId: string, customerText: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { chatLanguage: true },
  });
  const policy = tenant?.chatLanguage && isChatLanguage(tenant.chatLanguage) ? tenant.chatLanguage : "multi";
  return resolveReplyLanguage(policy, customerText);
}

async function sendDirect(accountId: string, conversationId: string, text: string, lang: "en" | "he") {
  await sendZernioInboxMessage({
    accountId,
    conversationId,
    text: decorateRapidDemoText(text, lang),
  });
}

async function replyTerminal(
  accountId: string,
  inbound: ZernioInbound,
  tenantId: string | null,
  textFor: (lang: "en" | "he") => string,
): Promise<void> {
  const lang = tenantId
    ? await demoLang(tenantId, inbound.text)
    : resolveReplyLanguage("multi", inbound.text);
  await sendZernioInboxMessage({
    accountId,
    conversationId: inbound.conversationId,
    text: textFor(lang),
  });
}

/**
 * Returns true when this inbound was consumed by a rapid demo.
 * Otherwise the webhook continues to the Zapidly tenant agent.
 */
export async function routeRapidDemoInbound(inbound: ZernioInbound): Promise<boolean> {
  const accountId = await resolveRapidDemoAccountId();
  if (!isSharedDemoAccount(inbound.accountId, accountId) || !accountId) return false;

  const code = parseDemoCode(inbound.text);
  const now = new Date();
  const demo = code
    ? await prisma.rapidDemo.findFirst({ where: { code, status: "active" } })
    : await prisma.rapidDemo.findFirst({
        where: { boundPhone: inbound.from, status: "active" },
        orderBy: { updatedAt: "desc" },
      });

  if (!demo?.tenantId || !demo.expiresAt || demo.expiresAt.getTime() <= now.getTime()) {
    if (demo?.expiresAt && demo.expiresAt.getTime() <= now.getTime()) {
      const flipped = await prisma.rapidDemo.updateMany({
        where: { id: demo.id, status: "active" },
        data: { status: "expired", boundPhone: null },
      });
      // One explanation, then later messages (no longer bound) reach the sales agent.
      if (flipped.count === 1) {
        await replyTerminal(accountId, inbound, demo.tenantId, demoExpiredText).catch((err) => {
          console.warn(JSON.stringify({ msg: "rapid_demo.expired_reply_failed", error: String(err) }));
        });
        return true;
      }
    }
    return false;
  }

  const command = code ? null : parseDemoCommand(inbound.text);
  if (command) {
    await handleDemoCommand({
      command,
      tenantId: demo.tenantId,
      phone: inbound.from,
      accountId,
      zernioConversationId: inbound.conversationId,
      text: inbound.text,
    });
    return true;
  }

  const decision = demoBindDecision(demo.boundPhone, inbound.from);
  if (decision === "in_use") {
    await replyTerminal(accountId, inbound, demo.tenantId, demoInUseText).catch((err) => {
      console.warn(JSON.stringify({ msg: "rapid_demo.in_use_reply_failed", error: String(err) }));
    });
    return true;
  }

  let justBound = false;
  if (decision === "bind") {
    const claimed = await prisma.rapidDemo.updateMany({
      where: { id: demo.id, status: "active", boundPhone: null },
      data: { boundPhone: inbound.from },
    });
    if (claimed.count !== 1) {
      const current = await prisma.rapidDemo.findFirst({
        where: { id: demo.id },
        select: { boundPhone: true },
      });
      if (current?.boundPhone !== inbound.from) {
        await replyTerminal(accountId, inbound, demo.tenantId, demoInUseText).catch((err) => {
          console.warn(JSON.stringify({ msg: "rapid_demo.in_use_reply_failed", error: String(err) }));
        });
        return true;
      }
    } else {
      justBound = true;
      await prisma.rapidDemo.updateMany({
        where: { boundPhone: inbound.from, status: "active", NOT: { id: demo.id } },
        data: { boundPhone: null },
      });
    }
  }

  const channelId = await ensureLocalDemoChannel(demo.tenantId);
  const channel = await prisma.channelConnection.findFirst({
    where: { id: channelId, tenantId: demo.tenantId },
    include: { agent: true, tenant: true },
  });
  if (!channel) return false;

  const inserted = await persistInboundIfNew({
    tenantId: demo.tenantId,
    channelId,
    agentId: channel.agentId,
    providerMessageId: inbound.platformMessageId,
    from: inbound.from,
    text: inbound.text,
    displayName: inbound.senderName,
    extraFields: {
      rapidDemo: true,
      zernioConversationId: inbound.conversationId,
      replyAccountId: accountId,
    },
    channel,
  });
  if (!inserted) return true;

  // First bind: reply with the same intro prod extract wrote on the tenant
  // (personaGreeting), and skip the LLM turn so we don't greet twice.
  if (code && justBound) {
    const ctx = await loadTurnContext(demo.tenantId, inserted.conversationId);
    const lang = replyLang(ctx, inbound.text);
    await sendAndSave(ctx, personaGreeting(ctx, lang), {
      idempotencyKey: `starter-${inserted.messageId}`,
    });
    await safeRefreshLeadState(demo.tenantId, inserted.leadId);
    return true;
  }

  try {
    await enqueueAgentTurn({
      tenantId: demo.tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
  } catch (err) {
    console.warn(JSON.stringify({ msg: "rapid_demo.enqueue_failed", error: String(err) }));
    await safeRefreshLeadState(demo.tenantId, inserted.leadId);
  }
  return true;
}

async function handleDemoCommand(opts: {
  command: "restart" | "tasks";
  tenantId: string;
  phone: string;
  accountId: string;
  zernioConversationId: string;
  text: string;
}): Promise<void> {
  const channelId = await ensureLocalDemoChannel(opts.tenantId);
  const lead = await prisma.lead.findFirst({
    where: { tenantId: opts.tenantId, channelId, externalUserId: opts.phone },
    select: { id: true },
  });
  if (!lead) {
    const lang = await demoLang(opts.tenantId, opts.text);
    await sendDirect(opts.accountId, opts.zernioConversationId, unboundCommandText(lang), lang);
    return;
  }

  const previous = await prisma.message.findFirst({
    where: { tenantId: opts.tenantId, role: "lead", conversation: { leadId: lead.id } },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  const lang = await demoLang(opts.tenantId, previous?.text || opts.text);

  if (opts.command === "restart") {
    const rotated = await rotateConversation({
      tenantId: opts.tenantId,
      leadId: lead.id,
      reason: "start_new_conversation",
    });
    const ctx = await loadTurnContext(opts.tenantId, rotated.conversationId);
    await sendAndSave(ctx, personaGreeting(ctx, lang));
    return;
  }

  const tasks = await prisma.hitlTask.findMany({
    where: { tenantId: opts.tenantId, leadId: lead.id, status: "open" },
    orderBy: { createdAt: "asc" },
  });
  const open = await prisma.conversation.findFirst({
    where: { tenantId: opts.tenantId, leadId: lead.id, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const conversationId =
    open?.id ??
    (
      await rotateConversation({
        tenantId: opts.tenantId,
        leadId: lead.id,
        reason: "start_new_conversation",
      })
    ).conversationId;
  const ctx = await loadTurnContext(opts.tenantId, conversationId);
  const body =
    tasks.length === 0 ? tasksEmptyText(lang) : tasksListText(lang, tasks.map((task) => formatHitlTaskLine(task, lang)));
  await sendAndSave(ctx, body);
}

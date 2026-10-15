import { persistInboundIfNew, loadTurnContext } from "@/lib/conversations";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { prisma } from "@/lib/db";
import { cannedFallbackIntro, replyLang } from "@/lib/copy";
import { resolveReplyLanguage, isChatLanguage } from "@/lib/flow/locale";
import { enqueueAgentTurn, sendAndSave } from "@/lib/flow/run-turn";
import { rotateConversation } from "@/lib/flow/rotate-conversation";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { sendZernioInboxMessage, type ZernioInbound } from "@/lib/zernio";
import {
  decorateRapidDemoText,
  starterText,
  tasksEmptyText,
  tasksListText,
  unboundCommandText,
} from "./copy";
import { parseDemoCode, parseDemoCommand } from "./guards";
import { formatHitlTaskLine } from "./outbound";

const DEFAULT_WHATSAPP_NUMBER = "972555076806";

/** Process-local. Production should set RAPID_DEMO_WHATSAPP_ACCOUNT_ID and skip the lookup. */
let cachedAccountId: string | null | undefined;

function digits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isSharedDemoAccount(inboundAccountId: string, sharedAccountId: string | null): boolean {
  return Boolean(sharedAccountId) && inboundAccountId === sharedAccountId;
}

/** Zernio account id of the Zapidly WhatsApp number that also hosts demos. */
export async function resolveRapidDemoAccountId(): Promise<string | null> {
  const pinned = process.env.RAPID_DEMO_WHATSAPP_ACCOUNT_ID?.trim();
  if (pinned) return pinned;
  if (cachedAccountId !== undefined) return cachedAccountId;
  const needle = digits(process.env.RAPID_DEMO_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER);
  if (!needle) {
    cachedAccountId = null;
    return null;
  }
  const channels = await prisma.channelConnection.findMany({
    where: { provider: "whatsapp", enabled: true, providerExternalId: { not: null } },
    select: { providerAccountId: true, providerExternalId: true },
  });
  const match = channels.find((channel) => {
    const external = channel.providerExternalId ?? "";
    if (external.startsWith("local-")) return false;
    const account = digits(channel.providerAccountId);
    if (!account) return false;
    return account.endsWith(needle) || needle.endsWith(account);
  });
  cachedAccountId = match?.providerExternalId ?? null;
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
    if (demo && demo.expiresAt && demo.expiresAt.getTime() <= now.getTime()) {
      await prisma.rapidDemo.update({
        where: { id: demo.id },
        data: { status: "expired", boundPhone: null },
      });
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

  const alreadyBound = demo.boundPhone === inbound.from;
  if (!alreadyBound) {
    await prisma.rapidDemo.updateMany({
      where: { boundPhone: inbound.from, status: "active", NOT: { id: demo.id } },
      data: { boundPhone: null },
    });
    await prisma.rapidDemo.update({
      where: { id: demo.id },
      data: { boundPhone: inbound.from },
    });
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

  if (code && !alreadyBound) {
    const ctx = await loadTurnContext(demo.tenantId, inserted.conversationId);
    await sendAndSave(ctx, starterText(replyLang(ctx, inbound.text)), {
      idempotencyKey: `starter-${inserted.messageId}`,
    });
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
    await sendAndSave(ctx, cannedFallbackIntro(ctx));
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

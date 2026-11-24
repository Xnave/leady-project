import { prisma } from "@/lib/db";
import { normalizeClientPhone } from "@/lib/client-sources/phone";
import { isStopReply } from "./rules";

/**
 * Any inbound from a campaign phone ends the follow-up sequence.
 * A whole-message stop word also writes a suppression, which the next send re-checks.
 * Never throws: a reply must not fail the webhook.
 */
export async function recordCampaignReply(tenantId: string, from: string, text: string, now = new Date()): Promise<void> {
  const normalized = normalizeClientPhone(from, "972");
  const phone = normalized.status === "ok" ? normalized.phone : from.replace(/\D/g, "");
  if (!phone) return;
  if (isStopReply(text)) {
    const existing = await prisma.suppression.findFirst({ where: { tenantId, phone }, select: { id: true } });
    if (!existing) {
      await prisma.suppression.create({ data: { tenantId, phone, reason: "opt_out" } });
    }
  }
  await prisma.campaignSend.updateMany({
    where: { tenantId, phone, startedAt: null, status: "queued" },
    data: { startedAt: now, status: "skipped", skipReason: "open_conversation" },
  });
  await prisma.campaignSend.updateMany({
    where: { tenantId, phone, startedAt: null, status: { in: ["sending", "sent", "unknown"] } },
    data: { startedAt: now },
  });
}

export async function safeRecordCampaignReply(tenantId: string, from: string, text: string): Promise<void> {
  try {
    await recordCampaignReply(tenantId, from, text);
  } catch (err) {
    console.error("[campaigns] reply", err instanceof Error ? err.message : err);
  }
}

import { appendAdminDecision } from "@/lib/admin-decisions";
import { prisma } from "@/lib/db";
import { refreshLeadState } from "./refresh";
import type { PipelineStage } from "./types";

export type Actor = { actorUserId: string; actorLabel: string };

async function assertLead(tenantId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true, stage: true } });
  if (!lead) throw new CrmNotFound();
  return lead;
}

export class CrmNotFound extends Error {}

export async function setManualStage(o: {
  tenantId: string;
  leadId: string;
  stage: PipelineStage;
  reason: string;
  actor: Actor;
}) {
  const lead = await assertLead(o.tenantId, o.leadId);
  const now = new Date();
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { stage: o.stage, stageSource: "manual", stageReason: o.reason, stageChangedAt: now },
    }),
    prisma.leadStageEvent.create({
      data: {
        tenantId: o.tenantId,
        leadId: lead.id,
        from: lead.stage,
        to: o.stage,
        source: "manual",
        reason: o.reason,
        actorUserId: o.actor.actorUserId,
      },
    }),
    appendAdminDecision({
      tenantId: o.tenantId,
      leadId: lead.id,
      category: "lead",
      action: "stage",
      actorUserId: o.actor.actorUserId,
      actorLabel: o.actor.actorLabel,
      details: { from: lead.stage, to: o.stage, reason: o.reason },
    }),
  ]);
  await refreshLeadState(o.tenantId, lead.id, { now });
}

export async function setNextStep(o: {
  tenantId: string;
  leadId: string;
  text: string | null;
  at: Date | null;
  actor: Actor;
}) {
  const lead = await assertLead(o.tenantId, o.leadId);
  const done = o.at === null;
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { nextStepText: done ? null : o.text, nextStepAt: o.at },
    }),
    appendAdminDecision({
      tenantId: o.tenantId,
      leadId: lead.id,
      category: "lead",
      action: done ? "next_step_done" : "next_step_set",
      actorUserId: o.actor.actorUserId,
      actorLabel: o.actor.actorLabel,
      details: done ? {} : { text: o.text, at: o.at?.toISOString() },
    }),
  ]);
  await refreshLeadState(o.tenantId, lead.id);
}

export async function snoozeLead(o: { tenantId: string; leadId: string; until: Date; actor: Actor }) {
  const lead = await prisma.lead.findFirst({
    where: { id: o.leadId, tenantId: o.tenantId },
    select: { id: true, followUpReason: true },
  });
  if (!lead) throw new CrmNotFound();
  if (lead.followUpReason !== "cold" && lead.followUpReason !== "reminder") return false;
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { snoozedUntil: o.until } }),
    appendAdminDecision({
      tenantId: o.tenantId,
      leadId: lead.id,
      category: "lead",
      action: "snooze",
      actorUserId: o.actor.actorUserId,
      actorLabel: o.actor.actorLabel,
      details: { until: o.until.toISOString(), reason: lead.followUpReason },
    }),
  ]);
  return true;
}

export async function addNote(o: { tenantId: string; leadId: string; body: string; pinned: boolean; actor: Actor }) {
  await assertLead(o.tenantId, o.leadId);
  return prisma.leadNote.create({
    data: {
      tenantId: o.tenantId,
      leadId: o.leadId,
      authorUserId: o.actor.actorUserId,
      authorLabel: o.actor.actorLabel,
      body: o.body,
      pinned: o.pinned,
    },
  });
}

export async function updateNote(o: { tenantId: string; leadId: string; noteId: string; body?: string; pinned?: boolean }) {
  const res = await prisma.leadNote.updateMany({
    where: { id: o.noteId, leadId: o.leadId, tenantId: o.tenantId },
    data: { ...(o.body !== undefined ? { body: o.body } : {}), ...(o.pinned !== undefined ? { pinned: o.pinned } : {}) },
  });
  if (res.count === 0) throw new CrmNotFound();
}

export async function deleteNote(o: { tenantId: string; leadId: string; noteId: string }) {
  const res = await prisma.leadNote.deleteMany({ where: { id: o.noteId, leadId: o.leadId, tenantId: o.tenantId } });
  if (res.count === 0) throw new CrmNotFound();
}

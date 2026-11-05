import { prisma } from "@/lib/db";
import type { FlowDefinition, HitlPolicy, LeadSchema, TalkStage } from "@/lib/flow/types";
import { validateFlow } from "@/lib/flow/validate";

/** Add or remove a capability id on the talk stage. Bumps flowVersion only when the list changes. */
export async function syncTalkCapability(opts: {
  tenantId: string;
  capabilityId: string;
  enabled: boolean;
}): Promise<{ flowVersion: number; changed: boolean }> {
  const agent = await prisma.agent.findFirst({ where: { tenantId: opts.tenantId } });
  if (!agent) throw new Error("no agent");
  const flow = structuredClone(agent.flow) as FlowDefinition;
  const talk = flow.stages.talk as TalkStage | undefined;
  if (!talk || talk.type !== "talk") throw new Error("no talk stage");
  const current = [...(talk.capabilities ?? [])];
  const has = current.includes(opts.capabilityId);
  if (has === opts.enabled) return { flowVersion: agent.flowVersion, changed: false };
  talk.capabilities = opts.enabled
    ? [...current, opts.capabilityId]
    : current.filter((id) => id !== opts.capabilityId);
  validateFlow(
    flow,
    agent.leadSchema as LeadSchema,
    agent.hitlPolicy as HitlPolicy,
  );
  const nextVersion = agent.flowVersion + 1;
  await prisma.$transaction([
    prisma.agentConfigRevision.create({
      data: {
        tenantId: opts.tenantId,
        agentId: agent.id,
        kind: "flow",
        version: nextVersion,
        payload: { capabilities: talk.capabilities },
      },
    }),
    prisma.agent.update({
      where: { id: agent.id },
      data: {
        flow,
        flowVersion: nextVersion,
        flowChangedAt: new Date(),
      },
    }),
  ]);
  return { flowVersion: nextVersion, changed: true };
}

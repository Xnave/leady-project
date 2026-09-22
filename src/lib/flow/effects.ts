import { registerTalkEffect, resolveTalkCapabilities } from "./registry";

function hitlReasonKey(raw?: string): string {
  const t = (raw ?? "").trim();
  if (t === "support_unresolved") return t;
  if (t === "escalation_requested" || t === "asked_for_person") return "escalation_requested";
  if (/unresolved|could not/i.test(t)) return "support_unresolved";
  return "escalation_requested";
}

/**
 * Register a talk effect that submits a tentative request for human approval:
 * run the durable effect, park the conversation on `waiting_human`, tell the
 * customer, and stop the turn.
 *
 * Booking and reservations are both this shape, and so is any future vertical —
 * a capability calls this instead of hand-rolling a handler.
 */
export function registerApprovalEffect(opts: {
  /** Effect id, which is also the registered action id. */
  effectId: string;
  /** Only runs when this capability is active on the talk stage. */
  capabilityId: string;
}): void {
  registerTalkEffect(opts.effectId, async ({ ctx, stage, ports, reply }) => {
    if (!resolveTalkCapabilities(stage).includes(opts.capabilityId)) return {};
    const result = await ports.runEffect(ctx, opts.effectId);
    if (!result.ok) {
      return { reply: result.reply || reply, failedAction: opts.effectId };
    }
    await ports.persistStage(ctx, "waiting_human");
    ctx.conversation.flowState = "waiting_human";
    await ports.sendAndSave(ctx, result.reply);
    return {
      reply: result.reply,
      halt: {
        stage: "waiting_human",
        action: opts.effectId,
        ok: true,
      },
    };
  });
}

/**
 * Register a talk effect that finishes without HITL: run the durable action,
 * send the reply, leave the conversation on talk, and stop the turn.
 * Used by self-serve flows (e.g. send booking link) that must not create a Request.
 */
export function registerSelfServeEffect(opts: {
  effectId: string;
  capabilityId: string;
}): void {
  registerTalkEffect(opts.effectId, async ({ ctx, stage, ports, reply }) => {
    if (!resolveTalkCapabilities(stage).includes(opts.capabilityId)) return {};
    const result = await ports.runEffect(ctx, opts.effectId);
    if (!result.ok) {
      return { reply: result.reply || reply, failedAction: opts.effectId };
    }
    await ports.sendAndSave(ctx, result.reply);
    return {
      reply: result.reply,
      halt: {
        stage: "talk",
        action: opts.effectId,
        ok: true,
      },
    };
  });
}

/** Built-in talk effects — registered so the interpreter dispatches via the registry. */
export function registerBuiltinTalkEffects(): void {
  registerTalkEffect("request_human", async ({ effect }) => ({
    escalateReason: hitlReasonKey(
      typeof effect.args?.reason === "string" ? effect.args.reason : undefined,
    ),
  }));

  // The staff offer was already accepted inside the capability tool; this only
  // tells the interpreter to close the talk stage.
  registerTalkEffect("accept_offered_slot", async () => ({
    completeAction: "accept_offered_slot",
  }));

  registerTalkEffect("start_new_conversation", async () => {
    // Handled by the interpreter after the effect loop (needs intro from args).
    return {};
  });
}

export { hitlReasonKey };

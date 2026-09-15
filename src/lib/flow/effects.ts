import { registerTalkEffect, resolveTalkCapabilities } from "./registry";

function hitlReasonKey(raw?: string): string {
  const t = (raw ?? "").trim();
  if (t === "support_unresolved") return t;
  if (t === "escalation_requested" || t === "asked_for_person") return "escalation_requested";
  if (/unresolved|could not/i.test(t)) return "support_unresolved";
  return "escalation_requested";
}

/** Built-in talk effects — registered so the interpreter dispatches via the registry. */
export function registerBuiltinTalkEffects(): void {
  registerTalkEffect("book_meeting", async ({ ctx, stage, ports, reply }) => {
    if (
      stage.allowBook === false ||
      !resolveTalkCapabilities(stage).includes("booking")
    ) {
      return {};
    }
    const booked = await ports.bookMeeting(ctx);
    if (booked.ok) {
      await ports.persistStage(ctx, "waiting_human");
      ctx.conversation.flowState = "waiting_human";
      await ports.sendAndSave(ctx, booked.reply);
      return {
        reply: booked.reply,
        bookedOk: true,
        halt: {
          stage: "waiting_human",
          action: "book_meeting",
          ok: true,
        },
      };
    }
    return { reply: booked.reply || reply, bookedOk: false };
  });

  registerTalkEffect("request_human", async ({ effect }) => ({
    escalateReason: hitlReasonKey(
      typeof effect.args?.reason === "string" ? effect.args.reason : undefined,
    ),
  }));

  registerTalkEffect("accept_offered_slot", async () => {
    // Meeting already approved inside the capability tool.
    return {};
  });

  registerTalkEffect("start_new_conversation", async () => {
    // Handled by interpreter after the effect loop (needs intro from args).
    return {};
  });
}

export { hitlReasonKey };

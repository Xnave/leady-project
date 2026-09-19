import { registerAction, registerOutcomeFlag } from "../registry";
import type { TurnContext } from "../types";
import { registerApprovalEffect, registerBuiltinTalkEffects } from "../effects";
import { registerBookingCapability } from "./booking";
import { registerReservationsCapability } from "./reservations";

let registered = false;

/** Idempotent bootstrap of built-in actions + capabilities. */
export function ensureFlowRegistry(): void {
  if (registered) return;
  registered = true;

  registerBuiltinTalkEffects();
  registerBookingCapability();
  registerReservationsCapability();

  // Durable side effects. Each capability owns its implementation; the interpreter
  // reaches them through the single generic `runEffect` port.
  registerAction("book_meeting", async (ctx: TurnContext) => {
    const { requestTentativeMeeting } = await import("@/lib/meetings");
    return requestTentativeMeeting(ctx);
  });
  registerApprovalEffect({ effectId: "book_meeting", capabilityId: "booking" });

  registerAction("create_reservation_hold", async (ctx: TurnContext) => {
    const { requestTentativeReservation } = await import("@/lib/reservations");
    return requestTentativeReservation(ctx);
  });
  registerApprovalEffect({
    effectId: "create_reservation_hold",
    capabilityId: "reservations",
  });

  // Legacy TalkOutcome booleans, declared here rather than hardcoded in the kernel.
  registerOutcomeFlag({ flag: "book", effectId: "book_meeting" });
  registerOutcomeFlag({
    flag: "acceptOfferedSlot",
    effectId: "accept_offered_slot",
    completesStage: true,
  });
}

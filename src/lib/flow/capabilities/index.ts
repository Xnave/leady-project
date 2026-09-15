import { registerAction } from "../registry";
import type { TurnContext } from "../types";
import { registerBuiltinTalkEffects } from "../effects";
import { registerBookingCapability } from "./booking";
import { registerOrdersCapability } from "./orders";
import { registerDocsCapability } from "./docs";

let registered = false;

/** Idempotent bootstrap of built-in actions + capabilities. */
export function ensureFlowRegistry(): void {
  if (registered) return;
  registered = true;

  registerBuiltinTalkEffects();
  registerBookingCapability();
  registerOrdersCapability();
  registerDocsCapability();

  registerAction("book_meeting", async () => {
    throw new Error("book_meeting action must be wired via interpreter ports");
  });

  registerAction("request_human", async () => {
    throw new Error("request_human action must be wired via interpreter ports");
  });

  // Durable side effects for peer packs — safe until product wires persistence/UI.
  registerAction("create_order", async (_ctx: TurnContext) => ({
    ok: false,
    reply: "Orders are not enabled for this agent yet.",
  }));
  registerAction("request_document_review", async (_ctx: TurnContext) => ({
    ok: false,
    reply: "Document review is not enabled for this agent yet.",
  }));
}

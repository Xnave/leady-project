import { isIdleConversationReset } from "./intro";
import type { TurnContext } from "./types";

function lastLeadText(ctx: TurnContext): string {
  return [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

/** Short yes/ok — used for confirm_details and for agreeing to a new thread. */
export function looksLikeShortAffirmation(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  return /^(כן|כן\.|yep|yes|yeah|ok|okay|בסדר|מאשר|נכון|מאושר|סבבה|יאללה|טוב)[!?.]*$/iu.test(
    t,
  );
}

export function askedToStartNewConversation(agentText: string): boolean {
  const t = agentText.trim();
  if (!t) return false;
  return /new conversation|new chat|שיחה חדשה|start over|start a new|נתחיל מחדש|clean start/i.test(
    t,
  );
}

/**
 * The start_new_conversation tool is legal when:
 * - the customer just said a short yes after we asked to reset, or
 * - this turn is an idle-gap / inbound-reopen where a clean start may apply.
 * On inbound_reopen the model may decide + word the intro in the same talk call
 * (no separate ask-then-yes turn required).
 */
export function canCallStartNewConversation(ctx: TurnContext): boolean {
  if (ctx.conversation.lifecycleReason === "inbound_reopen") return true;
  if (!looksLikeShortAffirmation(lastLeadText(ctx))) return false;
  const lastAgent =
    [...ctx.messages].reverse().find((m) => m.role === "agent")?.text ?? "";
  if (askedToStartNewConversation(lastAgent)) return true;
  return isIdleConversationReset(ctx);
}

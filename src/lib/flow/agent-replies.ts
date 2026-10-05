import type { TurnContext } from "@/lib/flow/types";

/**
 * Tenant and channel mute switches. Undefined means enabled (default true).
 * Either off → agent must not send replies (inbound still persists).
 */
export function agentRepliesAllowed(
  ctx: Pick<TurnContext, "tenant" | "channel">,
): boolean {
  if (ctx.tenant?.agentRepliesEnabled === false) return false;
  if (ctx.channel?.agentRepliesEnabled === false) return false;
  return true;
}

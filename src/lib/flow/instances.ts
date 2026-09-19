/**
 * Reading configured capability instances off a turn context. Capabilities call
 * these instead of naming tenant columns, which is what lets a new business type
 * be a `CapabilityInstance` row rather than a schema change.
 */
import type { CapabilityInstanceSnapshot, TurnContext } from "./types";

/** Enabled instances of a capability, in creation order. */
export function capabilityInstances(
  ctx: TurnContext,
  capabilityId: string,
): CapabilityInstanceSnapshot[] {
  return (ctx.tenant?.capabilityInstances ?? []).filter(
    (i) => i.capabilityId === capabilityId && i.enabled,
  );
}

/**
 * Raw config of the instance a turn is running against. A tenant with several
 * instances of one capability resolves by `kind`; otherwise the first enabled
 * one wins.
 */
export function instanceConfig(
  ctx: TurnContext,
  capabilityId: string,
  kind?: string,
): Record<string, unknown> {
  const all = capabilityInstances(ctx, capabilityId);
  const match = kind ? all.find((i) => i.kind === kind) : all[0];
  return match?.config ?? {};
}

/** The `Request.kind` new requests of this capability should carry. */
export function instanceKind(
  ctx: TurnContext,
  capabilityId: string,
  fallback: string,
): string {
  return capabilityInstances(ctx, capabilityId)[0]?.kind ?? fallback;
}

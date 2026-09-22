/** System actor when a self-serve booking link is sent (no human decision). */
export const AUTOMATIC_ACTOR = "automatic";

/** Local DEV_AUTH_BYPASS / unsigned staff identity — not “automatic”. */
export const GLOBAL_ADMIN_ACTOR = "global_admin";

export function resolveActorLabel(actorUserId: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (actorUserId === "customer") return "customer";
  if (actorUserId === AUTOMATIC_ACTOR) return AUTOMATIC_ACTOR;
  if (actorUserId === GLOBAL_ADMIN_ACTOR) return GLOBAL_ADMIN_ACTOR;
  if (actorUserId === "owner") return "admin";
  return actorUserId || "admin";
}

export type DecisionActorLabels = {
  admin: string;
  automatic: string;
  globalAdmin: string;
  /** Omit or leave empty — customer is not a “who approved” option in the inbox. */
  customer?: string;
};

/**
 * Operator-facing label for a stored decision actor.
 * Returns null when the actor should not be shown (e.g. customer confirm).
 */
export function formatDecisionActor(
  actorUserId: string | null | undefined,
  labels: DecisionActorLabels,
  actorLabel?: string | null,
): string | null {
  const id = (actorUserId ?? "").trim();
  const label = (actorLabel ?? "").trim();
  if (id === "customer" || label === "customer") {
    return labels.customer?.trim() || null;
  }
  if (id === AUTOMATIC_ACTOR || label === AUTOMATIC_ACTOR) return labels.automatic;
  if (id === GLOBAL_ADMIN_ACTOR || label === GLOBAL_ADMIN_ACTOR) {
    return labels.globalAdmin;
  }
  if (label === "admin" || id === "owner") return labels.admin;
  return label || id || labels.admin;
}

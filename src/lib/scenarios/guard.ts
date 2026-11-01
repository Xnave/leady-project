import { timingSafeEqual } from "node:crypto";
import type { ScenarioCapability, ScenarioTarget } from "./types";

export const SCENARIO_SENDER_PREFIX = "demo-scenario-";

export type ScenarioEnv = {
  production: boolean;
  secret: string;
  bookingTenantId: string;
  reservationTenantId: string;
  reservationLinkTenantId: string;
  canaryBookingTenantId: string;
  canaryReservationTenantId: string;
  devTenantId: string;
  allowlist: string[];
};

export function readScenarioEnv(
  source: Record<string, string | undefined>,
  production: boolean,
): ScenarioEnv {
  return {
    production,
    secret: source.SCENARIO_RUNNER_SECRET?.trim() ?? "",
    bookingTenantId: source.SCENARIO_BOOKING_TENANT_ID?.trim() ?? "",
    reservationTenantId: source.SCENARIO_RESERVATION_TENANT_ID?.trim() ?? "",
    reservationLinkTenantId: source.SCENARIO_RESERVATION_LINK_TENANT_ID?.trim() ?? "",
    canaryBookingTenantId: source.SCENARIO_CANARY_BOOKING_TENANT_ID?.trim() ?? "",
    canaryReservationTenantId: source.SCENARIO_CANARY_RESERVATION_TENANT_ID?.trim() ?? "",
    devTenantId: source.DEV_TENANT_ID?.trim() ?? "",
    allowlist: (source.SCENARIO_TENANT_ALLOWLIST ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export function scenarioAuthorized(authorization: string | null, secret: string): boolean {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!secret || !token || token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export function scenarioSender(scenarioId: string, runId: string): string {
  const id = scenarioId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48) || "run";
  const run = runId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "0";
  return `${SCENARIO_SENDER_PREFIX}${id}-${run}`;
}

export function isScenarioSender(externalUserId: string): boolean {
  return externalUserId.startsWith(SCENARIO_SENDER_PREFIX);
}

/** Local midnight of `YYYY-MM-DD`. Leads created earlier than this are "before" that day. */
export function parseScenarioBefore(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** Scenario senders only. `before` keeps leads created on that local day and later. */
export function scenarioLeadPurgeWhere(tenantIds: string[], before?: Date) {
  return {
    tenantId: { in: tenantIds },
    externalUserId: { startsWith: SCENARIO_SENDER_PREFIX },
    ...(before ? { createdAt: { lt: before } } : {}),
  };
}

export type TenantResolve =
  | { ok: true; tenantIds: string[] }
  | { ok: false; status: 403 | 503; error: string };

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function localBooking(env: ScenarioEnv): string {
  return env.bookingTenantId || env.devTenantId;
}

/**
 * Which tenants this call may touch.
 * A capability narrows the list to one id. Purge omits it and receives every id for the target.
 * On a production server the client cannot pick a tenant except with target `live` and an allowlisted id.
 */
export function scenarioTenantIds(
  env: ScenarioEnv,
  input: { target: ScenarioTarget; capability?: ScenarioCapability; tenantId?: string },
): TenantResolve {
  if (env.production) return productionTenants(env, input);
  return localTenants(env, input);
}

function productionTenants(
  env: ScenarioEnv,
  input: { target: ScenarioTarget; capability?: ScenarioCapability; tenantId?: string },
): TenantResolve {
  const allowed = unique([
    env.canaryBookingTenantId,
    env.canaryReservationTenantId,
    ...env.allowlist,
  ]);
  if (allowed.length === 0) return { ok: false, status: 503, error: "empty_allowlist" };
  if (input.target === "live") {
    if (!input.tenantId || !allowed.includes(input.tenantId)) {
      return { ok: false, status: 403, error: "forbidden_tenant" };
    }
    return { ok: true, tenantIds: [input.tenantId] };
  }
  if (input.capability) {
    const id = input.capability === "booking" ? env.canaryBookingTenantId : env.canaryReservationTenantId;
    if (!id || !allowed.includes(id)) return { ok: false, status: 503, error: "missing_canary" };
    return { ok: true, tenantIds: [id] };
  }
  const ids = unique([env.canaryBookingTenantId, env.canaryReservationTenantId]).filter((id) =>
    allowed.includes(id),
  );
  if (ids.length === 0) return { ok: false, status: 503, error: "missing_canary" };
  return { ok: true, tenantIds: ids };
}

function localTenants(
  env: ScenarioEnv,
  input: { target: ScenarioTarget; capability?: ScenarioCapability; tenantId?: string },
): TenantResolve {
  const booking = localBooking(env);
  const reservation = env.reservationTenantId;
  const link = env.reservationLinkTenantId;
  if (input.target === "live") {
    if (!input.tenantId || !env.allowlist.includes(input.tenantId)) {
      return { ok: false, status: 403, error: "forbidden_tenant" };
    }
    return { ok: true, tenantIds: [input.tenantId] };
  }
  if (input.target === "canary") {
    const canaryBooking = env.canaryBookingTenantId || booking;
    const canaryReservation = env.canaryReservationTenantId || reservation;
    return oneOrAll(input.capability, canaryBooking, canaryReservation, link);
  }
  if (input.tenantId) {
    const known = unique([
      booking,
      reservation,
      link,
      env.canaryBookingTenantId,
      env.canaryReservationTenantId,
      ...env.allowlist,
    ]);
    if (!known.includes(input.tenantId)) return { ok: false, status: 403, error: "forbidden_tenant" };
    return { ok: true, tenantIds: [input.tenantId] };
  }
  return oneOrAll(input.capability, booking, reservation, link);
}

function oneOrAll(
  capability: ScenarioCapability | undefined,
  booking: string,
  reservation: string,
  link = "",
): TenantResolve {
  if (capability === "booking") {
    return booking ? { ok: true, tenantIds: [booking] } : { ok: false, status: 503, error: "missing_tenant" };
  }
  if (capability === "reservations") {
    return reservation
      ? { ok: true, tenantIds: [reservation] }
      : { ok: false, status: 503, error: "missing_tenant" };
  }
  const ids = unique([booking, reservation, link]);
  if (ids.length === 0) return { ok: false, status: 503, error: "missing_tenant" };
  return { ok: true, tenantIds: ids };
}

import { NextResponse } from "next/server";
import {
  DEFAULT_INSTANCE_KIND,
  disableCapabilityInstance,
  loadCapabilityInstances,
  upsertCapabilityInstance,
} from "@/lib/capability-instances";
import { parseBookingConfig } from "@/lib/flow/booking-config";
import { parseReservationConfig } from "@/lib/flow/reservation-config";
import { getCapability } from "@/lib/flow/registry";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { requireTenantId } from "@/lib/tenant";

/**
 * Each capability sanitizes its own instance config on write, so a bad payload
 * can never reach the runtime. Adding a capability adds a parser here, not a
 * column or an endpoint.
 */
const CONFIG_PARSERS: Record<string, (raw: unknown) => unknown> = {
  booking: parseBookingConfig,
  reservations: parseReservationConfig,
};

/** GET every configured request type for the tenant. */
export async function GET() {
  const tenantId = await requireTenantId();
  return NextResponse.json({ instances: await loadCapabilityInstances(tenantId) });
}

/** PUT one instance: create it, replace its config, or disable it. */
export async function PUT(req: Request) {
  const tenantId = await requireTenantId();
  const body = (await req.json().catch(() => null)) as {
    capabilityId?: string;
    kind?: string;
    enabled?: boolean;
    config?: unknown;
  } | null;

  const capabilityId = String(body?.capabilityId ?? "").trim();
  ensureFlowRegistry();
  if (!capabilityId || !getCapability(capabilityId)) {
    return NextResponse.json({ error: "unknown_capability" }, { status: 400 });
  }

  const kind =
    String(body?.kind ?? "").trim() || DEFAULT_INSTANCE_KIND[capabilityId] || capabilityId;

  if (body?.enabled === false) {
    await disableCapabilityInstance({ tenantId, kind });
    return NextResponse.json({ ok: true });
  }

  const parse = CONFIG_PARSERS[capabilityId];
  const instance = await upsertCapabilityInstance({
    tenantId,
    capabilityId,
    kind,
    config: parse ? parse(body?.config) : (body?.config ?? {}),
  });
  return NextResponse.json({ instance });
}

import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, setManualStage, snoozeLead } from "@/lib/crm/actions";
import { snoozePresetUntil } from "@/lib/crm/input";
import { isPipelineStage } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

type BulkBody = {
  ids?: unknown;
  op?: unknown;
  stage?: unknown;
  reason?: unknown;
  days?: unknown;
};

export async function PATCH(req: Request) {
  const tenantId = await requireTenantId();
  const body = (await req.json().catch(() => null)) as BulkBody | null;
  if (!body) return NextResponse.json({ error: "bad_body" }, { status: 400 });

  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string").slice(0, 100) : [];
  if (ids.length === 0) return NextResponse.json({ error: "bad_ids" }, { status: 400 });

  if (body.op === "stage") {
    if (!isPipelineStage(body.stage)) return NextResponse.json({ error: "bad_stage" }, { status: 400 });
    const stage = body.stage;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    const actor = await resolveStaffActor();
    let done = 0;
    for (const id of ids) {
      try {
        await setManualStage({ tenantId, leadId: id, stage, reason, actor });
        done += 1;
      } catch (e) {
        if (!(e instanceof CrmNotFound)) throw e;
      }
    }
    return NextResponse.json({ ok: true, done });
  }

  if (body.op === "snooze") {
    if (body.days !== 1 && body.days !== 3 && body.days !== 7) {
      return NextResponse.json({ error: "bad_days" }, { status: 400 });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const until = snoozePresetUntil(body.days, new Date(), tenant?.timezone ?? "Asia/Jerusalem");
    const actor = await resolveStaffActor();
    let done = 0;
    for (const id of ids) {
      try {
        const ok = await snoozeLead({ tenantId, leadId: id, until, actor });
        if (ok) done += 1;
      } catch (e) {
        if (!(e instanceof CrmNotFound)) throw e;
      }
    }
    return NextResponse.json({ ok: true, done });
  }

  if (body.op === "read") {
    const res = await prisma.lead.updateMany({ where: { id: { in: ids }, tenantId }, data: { adminUnread: false } });
    return NextResponse.json({ ok: true, done: res.count });
  }

  return NextResponse.json({ error: "bad_op" }, { status: 400 });
}

import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, setManualStage, snoozeLead } from "@/lib/crm/actions";
import { parseBulkBody, snoozePresetUntil } from "@/lib/crm/input";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export async function PATCH(req: Request) {
  const tenantId = await requireTenantId();
  const body = parseBulkBody(await req.json().catch(() => null));
  if ("error" in body) return NextResponse.json(body, { status: 400 });
  const { ids } = body;

  if (body.op === "stage") {
    const { stage, reason } = body;
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

  const res = await prisma.lead.updateMany({
    where: { id: { in: ids }, tenantId },
    data: { adminUnread: body.op === "unread" },
  });
  return NextResponse.json({ ok: true, done: res.count });
}

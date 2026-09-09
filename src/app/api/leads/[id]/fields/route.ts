import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { splitCrmAndSession } from "@/lib/flow/booking";
import type { LeadFields, LeadSchema } from "@/lib/flow/types";
import { normalizeLeadStatus } from "@/lib/ui";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const lead = await prisma.lead.findFirstOrThrow({
    where: { id, tenantId },
    include: { conversations: { take: 1, orderBy: { updatedAt: "desc" }, include: { agent: true } } },
  });
  const schema = (lead.conversations[0]?.agent.leadSchema ?? { fields: {} }) as LeadSchema;
  const fields: Record<string, unknown> = { ...(lead.fields as Record<string, unknown>) };
  for (const key of Object.keys(schema.fields)) {
    const raw = form.get(`field_${key}`);
    if (typeof raw === "string") fields[key] = raw;
  }
  const { crm } = splitCrmAndSession(fields as LeadFields);
  const status = normalizeLeadStatus(String(form.get("status") ?? lead.status));
  await prisma.lead.update({
    where: { id },
    data: { fields: crm as Prisma.InputJsonValue, status },
  });
  const back = req.headers.get("referer") ?? `/leads/${id}`;
  return NextResponse.redirect(back, 303);
}

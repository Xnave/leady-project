import { prisma } from "@/lib/db";
import { leadWhere, parseLeadFilters } from "@/lib/lead-query";
import { leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { normalizeLeadStatus } from "@/lib/ui";

const MAX_ROWS = 5000;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const tenantId = await requireTenantId();
  const url = new URL(req.url);
  const filters = parseLeadFilters({
    q: url.searchParams.get("q") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });

  const leads = await prisma.lead.findMany({
    where: leadWhere(tenantId, filters),
    orderBy: { updatedAt: "desc" },
    take: MAX_ROWS,
    include: {
      channel: { select: { provider: true } },
      conversations: { take: 1, orderBy: { updatedAt: "desc" } },
    },
  });

  const header = [
    "name",
    "channel",
    "external_id",
    "phone",
    "email",
    "intent",
    "status",
    "stage",
    "created_at",
    "last_active",
  ];
  const rows = leads.map((lead) => {
    const fields = (lead.fields ?? {}) as Record<string, unknown>;
    const convo = lead.conversations[0];
    return [
      leadDisplayName(lead),
      lead.channel.provider,
      lead.externalUserId,
      fields.phone ?? "",
      fields.email ?? "",
      fields.intent ?? "",
      normalizeLeadStatus(lead.status),
      convo?.flowState ?? "",
      lead.createdAt.toISOString(),
      (convo?.updatedAt ?? lead.updatedAt).toISOString(),
    ].map(csvCell).join(",");
  });

  // BOM so Excel opens Hebrew names in the right encoding.
  const body = `﻿${[header.join(","), ...rows].join("\r\n")}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { logCrmPerf } from "@/lib/perf";
import { requireTenantId } from "@/lib/tenant";

const ALLOWED = new Set([
  "crm.client.peek_shell",
  "crm.client.peek_open",
  "crm.client.peek_paint",
  "crm.client.peek_full",
  "crm.client.nav",
  "crm.client.mark_read",
]);

const bodySchema = z.object({
  msg: z.string().max(64),
  ms: z.number().finite().min(0).max(120_000),
  leadId: z.string().max(64).optional(),
  scope: z.enum(["lite", "full"]).optional(),
  path: z.string().max(256).optional(),
  extra: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** Client CRM timings — auth + log only; no DB. */
export async function POST(req: Request) {
  let tenantId: string;
  try {
    tenantId = await requireTenantId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = bodySchema.safeParse(await req.json().catch(() => null));
  if (!raw.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });
  const { msg, ms, leadId, scope, path, extra } = raw.data;
  if (!ALLOWED.has(msg)) return NextResponse.json({ error: "bad_msg" }, { status: 400 });
  logCrmPerf(
    msg,
    {
      tenantId,
      source: "client",
      ms,
      ...(leadId ? { leadId } : {}),
      ...(scope ? { scope } : {}),
      ...(path ? { path } : {}),
      ...(extra ? { extra } : {}),
    },
    { force: true },
  );
  return NextResponse.json({ ok: true });
}

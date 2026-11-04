import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { isAdminSession } from "@/lib/admin";
import { parseAdminSettings } from "@/lib/campaigns/settings";
import { loadCampaignSettings, saveAdminSettings, tenantWhatsAppAccount } from "@/lib/campaigns/store";
import { prisma } from "@/lib/db";

/** Platform admins only: the client campaigns add-on and its legal settings for one tenant. */
async function gate(id: string): Promise<NextResponse | null> {
  if (!(await isAdminSession())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await gate(id);
  if (denied) return denied;
  const [settings, account] = await Promise.all([loadCampaignSettings(id), tenantWhatsAppAccount(id)]);
  return NextResponse.json({ settings, whatsapp: account });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await gate(id);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const current = await loadCampaignSettings(id);
  const { actorLabel } = await resolveStaffActor();
  const patch = parseAdminSettings(body, current, actorLabel);
  if ("error" in patch) return NextResponse.json({ error: patch.error }, { status: 400 });
  const settings = await saveAdminSettings(id, patch);
  console.log(
    JSON.stringify({ msg: "campaigns.admin_settings", tenantId: id, actor: actorLabel, enabled: settings.enabled, adPrefixEnabled: settings.adPrefixEnabled }),
  );
  return NextResponse.json({ settings });
}

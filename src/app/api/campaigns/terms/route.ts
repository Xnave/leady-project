import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { acceptCampaignTerms, campaignsEnabled } from "@/lib/campaigns/store";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/** Tenant owner or admin accepts the current campaign terms. */
export async function POST() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  if (!(await campaignsEnabled(access.tenantId))) return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  const { actorLabel } = await resolveStaffActor();
  const settings = await acceptCampaignTerms(access.tenantId, actorLabel);
  return NextResponse.json({ settings });
}

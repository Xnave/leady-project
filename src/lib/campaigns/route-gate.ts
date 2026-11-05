import { NextResponse } from "next/server";
import { tenantRoleOr403, type TenantAccess } from "@/lib/tenant-role";
import { campaignsEnabled } from "./store";

/** Campaign routes: owner/admin of a tenant with the add-on on. */
export async function campaignAccessOr403(): Promise<TenantAccess | NextResponse> {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  if (!(await campaignsEnabled(access.tenantId))) return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  return access;
}

export function errorStatus(error: string): number {
  if (error === "not_found" || error === "template_not_found") return 404;
  if (error === "not_enabled") return 403;
  if (error === "not_draft" || error === "bad_transition") return 409;
  return 400;
}

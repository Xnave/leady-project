import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { campaignsEnabled, listTemplates, refreshPendingTemplates, submitTemplate } from "@/lib/campaigns/store";
import { TEMPLATE_CATEGORIES, TEMPLATE_LANGUAGES, type TemplateCategory, type TemplateLanguage } from "@/lib/campaigns/templates";
import { tenantRoleOr403 } from "@/lib/tenant-role";

async function gate() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  if (!(await campaignsEnabled(access.tenantId))) return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  return access;
}

export async function GET() {
  const access = await gate();
  if (access instanceof Response) return access;
  await refreshPendingTemplates(access.tenantId);
  return NextResponse.json({ templates: await listTemplates(access.tenantId) });
}

const ERROR_STATUS = { not_enabled: 403, terms_required: 403, no_whatsapp: 409, provider_unavailable: 503, invalid: 400 } as const;

export async function POST(req: Request) {
  const access = await gate();
  if (access instanceof Response) return access;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const category = TEMPLATE_CATEGORIES.includes(body.category as TemplateCategory) ? (body.category as TemplateCategory) : null;
  const language = TEMPLATE_LANGUAGES.includes(body.language as TemplateLanguage) ? (body.language as TemplateLanguage) : null;
  if (!category || !language) return NextResponse.json({ error: "invalid", issues: [] }, { status: 400 });
  const { actorLabel } = await resolveStaffActor();
  const result = await submitTemplate({
    tenantId: access.tenantId,
    actor: actorLabel,
    draft: {
      title: typeof body.title === "string" ? body.title : "",
      body: typeof body.body === "string" ? body.body : "",
      examples: Array.isArray(body.examples) ? body.examples.map((e) => (typeof e === "string" ? e : "")) : [],
      category,
      language,
    },
  });
  if (!result.ok) {
    return NextResponse.json(result.error === "invalid" ? { error: "invalid", issues: result.issues } : { error: result.error }, {
      status: ERROR_STATUS[result.error],
    });
  }
  return NextResponse.json({ template: result.template });
}

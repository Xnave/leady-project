import { NextResponse } from "next/server";
import { loadInstanceConfig, upsertCapabilityInstance } from "@/lib/capability-instances";
import { hasClientSourceCredentials } from "@/lib/client-sources/store";
import { syncTalkCapability } from "@/lib/documents/enable";
import { parseDocumentConfig, publicDocumentConfig } from "@/lib/flow/document-config";
import { FlowConfigError } from "@/lib/flow/types";
import { prisma } from "@/lib/db";
import { tenantRoleOr403 } from "@/lib/tenant-role";
import type { FlowDefinition, TalkStage } from "@/lib/flow/types";

export async function GET() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const [config, agent] = await Promise.all([
    loadInstanceConfig({ tenantId, capabilityId: "documents" }),
    prisma.agent.findFirst({ where: { tenantId }, select: { flow: true } }),
  ]);
  const talk = (agent?.flow as FlowDefinition | undefined)?.stages?.talk as TalkStage | undefined;
  const hasKey = await hasClientSourceCredentials(tenantId, "smartnpv");
  return NextResponse.json({
    ...publicDocumentConfig(config),
    hasKey,
    testOnly: !hasKey,
    enabled: Boolean(talk?.type === "talk" && talk.capabilities?.includes("documents")),
  });
}

export async function POST(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const body = (await req.json().catch(() => null)) as {
    enabled?: boolean;
    baseUrl?: string;
    rules?: unknown;
    testPhones?: string;
    unrecognizedIntro?: string;
  } | null;
  const existing = await loadInstanceConfig({ tenantId, capabilityId: "documents" });
  const existingPhones = Array.isArray(existing.testPhones)
    ? existing.testPhones.filter((item): item is string => typeof item === "string")
    : [];
  let config;
  try {
    config = parseDocumentConfig(
      { ...(body ?? {}), apiKey: "" },
      "",
      existingPhones,
      typeof existing.unrecognizedIntro === "string" ? existing.unrecognizedIntro : "",
      existing,
    );
  } catch (err) {
    const message = err instanceof FlowConfigError ? err.errors.join("\n") : "Invalid documents config";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const enabled = body?.enabled !== false;
  await upsertCapabilityInstance({
    tenantId,
    capabilityId: "documents",
    kind: "mortgage",
    enabled,
    config,
  });
  await syncTalkCapability({ tenantId, capabilityId: "documents", enabled });
  const hasKey = await hasClientSourceCredentials(tenantId, "smartnpv");
  return NextResponse.json({ ok: true, hasKey, testOnly: !hasKey });
}

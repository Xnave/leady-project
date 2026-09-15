import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { adminBypass } from "@/lib/admin";
import { buildAgentSystemPrompt, flowForCatalog, hitlForCatalog } from "@/lib/flow/catalog";
import { defaultLeadSchema } from "@/lib/flow/validate";
import { CLERK_ROLE_ADMIN, normalizeEmail } from "@/lib/org-roles";
import { appOrigin } from "@/lib/request-url";

export async function ensureLocalDemoChannel(tenantId: string): Promise<string> {
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  if (!agent) throw new Error("No agent for tenant");
  const accountId = `demo-${tenantId}`;
  const existing = await prisma.channelConnection.findFirst({
    where: { tenantId, providerAccountId: accountId },
  });
  if (existing) return existing.id;
  const row = await prisma.channelConnection.create({
    data: {
      tenantId,
      agentId: agent.id,
      provider: "whatsapp",
      providerAccountId: accountId,
      providerExternalId: `local-${tenantId}`,
      apiBase: "https://zernio.com/api/v1",
      accessTokenEnc: encryptSecret("demo"),
      hmacSecretEnc: encryptSecret("demo"),
      verifyToken: `leady-${tenantId.slice(0, 12)}`,
      enabled: true,
    },
  });
  return row.id;
}

function clerkConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim());
}

export async function createTenant(opts: {
  name: string;
  phone?: string;
  ownerEmail: string;
  /** Clerk user id of the platform admin creating the org (removed after invite). */
  createdByUserId?: string | null;
}) {
  const name = opts.name.trim();
  const phone = (opts.phone ?? "").trim();
  const ownerEmail = normalizeEmail(opts.ownerEmail);
  if (!name) throw new Error("Name required");
  if (!ownerEmail || !ownerEmail.includes("@")) throw new Error("Owner email required");

  let clerkOrgId: string;
  const useClerk = !adminBypass() && clerkConfigured();

  let ownerClerkUserId: string | null = null;

  if (useClerk) {
    const client = await clerkClient();
    const org = await client.organizations.createOrganization({
      name,
      ...(opts.createdByUserId ? { createdBy: opts.createdByUserId } : {}),
    });
    clerkOrgId = org.id;

    // Prefer direct membership when the owner already has a Clerk account —
    // invite emails are easy to miss in local/dev and still leave them on /no-access.
    const existing = await client.users.getUserList({
      emailAddress: [ownerEmail],
      limit: 1,
    });
    const existingOwner = existing.data[0];
    if (existingOwner) {
      await client.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: existingOwner.id,
        role: CLERK_ROLE_ADMIN,
      });
      ownerClerkUserId = existingOwner.id;
    } else {
      await client.organizations.createOrganizationInvitation({
        organizationId: org.id,
        emailAddress: ownerEmail,
        role: CLERK_ROLE_ADMIN,
        redirectUrl: `${appOrigin()}/activating`,
        ...(opts.createdByUserId ? { inviterUserId: opts.createdByUserId } : {}),
      });
    }

    // Platform admins must not remain org members — they use impersonation.
    if (opts.createdByUserId) {
      try {
        await client.organizations.deleteOrganizationMembership({
          organizationId: org.id,
          userId: opts.createdByUserId,
        });
      } catch {
        // Org may already have no membership for creator in some Clerk configs.
      }
    }
  } else {
    clerkOrgId = `local-${crypto.randomUUID()}`;
  }

  const intro = "";
  const tenant = await prisma.tenant.create({
    data: {
      clerkOrgId,
      name,
      phone,
      intro,
      ownerEmail,
      ownerClerkUserId,
      chatLanguage: "he",
    },
  });
  const flow = flowForCatalog("inbox");
  const hitl = hitlForCatalog("inbox");
  await prisma.agent.create({
    data: {
      tenantId: tenant.id,
      name: "Inbox agent",
      catalogId: "inbox",
      systemPrompt: buildAgentSystemPrompt(name, intro || name, phone, "he"),
      knowledgeText: "",
      flow,
      leadSchema: defaultLeadSchema,
      hitlPolicy: hitl,
    },
  });
  await ensureLocalDemoChannel(tenant.id);
  return tenant;
}

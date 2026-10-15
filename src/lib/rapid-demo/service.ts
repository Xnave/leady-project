import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  applyMissingName,
  chosenCapabilities,
  buildKnowledgeMarkdown,
  composeRapidProfile,
  profileNeedsName,
  readStoredExtract,
  researchBusinessMarkdown,
  type RapidExtract,
} from "./extract";
import { fetchPublicSite, publicSiteHost } from "./fetch-site";
import {
  decideDemoReuse,
  demoTtlMs,
  fileHost,
  generateDemoCode,
  hashIp,
  isActiveDemo,
  rateLimitDecision,
  type DemoReuseRow,
} from "./guards";
import { activationPrefill, type DemoLang } from "./copy";
import { provisionRapidDemoTenant } from "./provision";

const DRAFT_TTL_MS = 60 * 60 * 1000;

export type RapidDemoSuccess =
  | { ok: true; ignored: true }
  | {
      ok: true;
      status: "created";
      code: string;
      name: string;
      expiresAt: string;
      /** WhatsApp prefill for the visitor link (includes the demo code). */
      waPrefill: string;
    }
  | { ok: true; status: "needs_name"; draftId: string }
  | {
      ok: true;
      status: "confirm";
      draftId: string;
      name: string;
      phone?: string;
      venueAddress?: string;
    };

export type RapidDemoFailure = {
  ok: false;
  error:
    | "rate_limited"
    | "hourly_cap"
    | "daily_cap"
    | "demo_exists"
    | "invalid_url"
    | "fetch_failed"
    | "missing_input"
    | "missing_identity"
    | "draft_expired";
  /** Present when error is demo_exists — so the visitor can open the live demo. */
  code?: string;
  name?: string;
  waPrefill?: string;
};

export type RapidDemoResult = RapidDemoSuccess | RapidDemoFailure;

type Identity = { ipHash: string; browserId: string };

function identityOf(input: { clientIp?: string; browserId?: string }): Identity | null {
  const ip = input.clientIp?.trim() ?? "";
  const browserId = input.browserId?.trim().slice(0, 80) ?? "";
  if (!ip && !browserId) return null;
  return { ipHash: ip ? hashIp(ip) : "", browserId };
}

function visitorOr(identity: Identity): Prisma.RapidDemoWhereInput[] {
  const or: Prisma.RapidDemoWhereInput[] = [];
  if (identity.ipHash) or.push({ ipHash: identity.ipHash });
  if (identity.browserId) or.push({ browserId: identity.browserId });
  return or;
}

function ownsDraft(row: { ipHash: string; browserId: string }, identity: Identity): boolean {
  if (identity.ipHash && row.ipHash === identity.ipHash) return true;
  if (identity.browserId && row.browserId === identity.browserId) return true;
  return false;
}

function isIdentityConflict(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("code" in err) || (err as { code: unknown }).code !== "P2002") {
    return false;
  }
  const target = JSON.stringify("meta" in err ? (err as { meta?: unknown }).meta : "");
  return /ip|browser|one_active/i.test(target);
}

async function rateLimit(identity: Identity): Promise<RapidDemoFailure | null> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const or = visitorOr(identity);
  const [visitorHour, visitorDay, globalHour, globalDay] = await Promise.all([
    prisma.rapidDemo.count({ where: { createdAt: { gte: hourAgo }, OR: or } }),
    prisma.rapidDemo.count({ where: { createdAt: { gte: dayAgo }, OR: or } }),
    prisma.rapidDemo.count({ where: { createdAt: { gte: hourAgo } } }),
    prisma.rapidDemo.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);
  const decision = rateLimitDecision({ visitorHour, visitorDay, globalHour, globalDay });
  return decision === "ok" ? null : { ok: false, error: decision };
}

async function expireStale(identity: Identity): Promise<void> {
  await prisma.rapidDemo.updateMany({
    where: { status: "active", expiresAt: { lt: new Date() }, OR: visitorOr(identity) },
    data: { status: "expired", boundPhone: null },
  });
}

async function visitorDemos(identity: Identity): Promise<DemoReuseRow[]> {
  return prisma.rapidDemo.findMany({
    where: { OR: visitorOr(identity) },
    select: { websiteHost: true, status: true, expiresAt: true, code: true },
  });
}

function prefillLang(extract: unknown): DemoLang {
  const chat = readStoredExtract(extract).chatLanguage;
  return chat === "en" ? "en" : "he";
}

function createdPayload(row: { code: string; expiresAt: Date | null; extract: unknown }, name: string): RapidDemoSuccess {
  return {
    ok: true,
    status: "created",
    code: row.code,
    name,
    expiresAt: (row.expiresAt ?? new Date(Date.now() + demoTtlMs())).toISOString(),
    waPrefill: activationPrefill({ code: row.code, name, lang: prefillLang(row.extract) }),
  };
}

async function demoExistsPayload(code: string): Promise<RapidDemoFailure> {
  const existing = await prisma.rapidDemo.findFirst({ where: { code } });
  if (!existing) return { ok: false, error: "demo_exists" };
  const name = readStoredExtract(existing.extract).name ?? "";
  return {
    ok: false,
    error: "demo_exists",
    code: existing.code,
    name,
    waPrefill: activationPrefill({ code: existing.code, name, lang: prefillLang(existing.extract) }),
  };
}

async function insertRow(
  data: Omit<Prisma.RapidDemoCreateInput, "code">,
): Promise<{ row: { id: string; code: string; expiresAt: Date | null; extract: unknown } } | "conflict"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await prisma.rapidDemo.create({
        data: { ...data, code: generateDemoCode() },
        select: { id: true, code: true, expiresAt: true, extract: true },
      });
      return { row };
    } catch (err) {
      if (isIdentityConflict(err)) return "conflict";
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a demo code");
}

async function withResearch(profile: RapidExtract): Promise<RapidExtract> {
  if (!profile.websiteUrl || !profile.name) return profile;
  const researched = await researchBusinessMarkdown({
    name: profile.name,
    website: profile.websiteUrl,
    pageText: profile.pageText,
  });
  if (researched) return { ...profile, knowledgeMd: researched };
  return { ...profile, knowledgeMd: buildKnowledgeMarkdown(profile, profile.pageText || profile.knowledgeMd) };
}

export async function previewRapidDemo(input: {
  website?: string;
  text?: string;
  capabilities?: unknown;
  clientIp?: string;
  browserId?: string;
}): Promise<RapidDemoResult> {
  const identity = identityOf(input);
  if (!identity) return { ok: false, error: "missing_identity" };

  const website = input.website?.trim() ?? "";
  const text = input.text?.trim().slice(0, 24_000) ?? "";
  if (!website && !text) return { ok: false, error: "missing_input" };

  const websiteHost = website ? publicSiteHost(website) : fileHost(text);
  if (!websiteHost) return { ok: false, error: "invalid_url" };

  await expireStale(identity);
  const reuse = decideDemoReuse(await visitorDemos(identity), websiteHost, new Date());
  if (reuse.type === "conflict") return demoExistsPayload(reuse.code);
  if (reuse.type === "reuse") {
    const existing = await prisma.rapidDemo.findFirst({ where: { code: reuse.code } });
    if (existing) {
      const name = readStoredExtract(existing.extract).name ?? "";
      return createdPayload(existing, name);
    }
  }

  const limited = await rateLimit(identity);
  if (limited) return limited;

  let source = text;
  if (website) {
    const fetched = await fetchPublicSite(website);
    if (!fetched.ok) return { ok: false, error: fetched.error };
    source = fetched.text;
  }

  const profile = await composeRapidProfile({
    source,
    capabilities: chosenCapabilities(input.capabilities),
    website: website || undefined,
  });
  const inserted = await insertRow({
    status: "draft",
    websiteHost,
    ipHash: identity.ipHash,
    browserId: identity.browserId,
    knowledgeMd: profile.knowledgeMd,
    extract: profile as unknown as Prisma.InputJsonValue,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });
  if (inserted === "conflict") {
    const active = (await visitorDemos(identity)).find((row) => isActiveDemo(row, new Date()));
    return active ? demoExistsPayload(active.code) : { ok: false, error: "demo_exists" };
  }
  if (profileNeedsName(profile)) {
    return { ok: true, status: "needs_name", draftId: inserted.row.id };
  }
  return {
    ok: true,
    status: "confirm",
    draftId: inserted.row.id,
    name: profile.name?.trim() ?? "",
    ...(profile.phone ? { phone: profile.phone } : {}),
    ...(profile.venueAddress ? { venueAddress: profile.venueAddress } : {}),
  };
}

export async function createRapidDemoFromDraft(input: {
  draftId?: string;
  name?: string;
  capabilities?: unknown;
  clientIp?: string;
  browserId?: string;
}): Promise<RapidDemoResult> {
  const identity = identityOf(input);
  if (!identity) return { ok: false, error: "missing_identity" };
  const draftId = input.draftId?.trim() ?? "";
  const name = input.name?.trim().slice(0, 120) ?? "";
  if (!draftId || !name) return { ok: false, error: "missing_input" };

  await expireStale(identity);

  const draft = await prisma.rapidDemo.findFirst({ where: { id: draftId, status: "draft" } });
  if (!draft || !draft.expiresAt || draft.expiresAt.getTime() <= Date.now() || !ownsDraft(draft, identity)) {
    return { ok: false, error: "draft_expired" };
  }

  const reuse = decideDemoReuse(await visitorDemos(identity), draft.websiteHost, new Date());
  if (reuse.type === "conflict") return demoExistsPayload(reuse.code);
  if (reuse.type === "reuse") {
    const existing = await prisma.rapidDemo.findFirst({ where: { code: reuse.code } });
    if (existing) return createdPayload(existing, readStoredExtract(existing.extract).name || name);
  }

  const storedExtract = readStoredExtract(draft.extract, draft.knowledgeMd);
  const hadName = Boolean(storedExtract.name?.trim());
  const stored = applyMissingName(storedExtract, name);
  if (hadName && stored.name !== storedExtract.name && stored.pageText) {
    stored.knowledgeMd = buildKnowledgeMarkdown(stored, stored.pageText);
  }
  const named = input.capabilities === undefined ? stored : { ...stored, capabilities: chosenCapabilities(input.capabilities) };
  const profile = hadName ? named : await withResearch(named);
  const expiresAt = new Date(Date.now() + demoTtlMs());
  const { tenantId } = await provisionRapidDemoTenant(profile);
  try {
    const row = await prisma.rapidDemo.update({
      where: { id: draft.id },
      data: {
        status: "active",
        tenantId,
        expiresAt,
        knowledgeMd: profile.knowledgeMd,
        extract: profile as unknown as Prisma.InputJsonValue,
      },
      select: { code: true, expiresAt: true, extract: true },
    });
    return createdPayload(row, profile.name ?? name);
  } catch (err) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (isIdentityConflict(err)) {
      const active = (await visitorDemos(identity)).find((row) => isActiveDemo(row, new Date()));
      return active ? demoExistsPayload(active.code) : { ok: false, error: "demo_exists" };
    }
    throw err;
  }
}

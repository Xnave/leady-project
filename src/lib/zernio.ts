import fs from "node:fs";
import path from "node:path";

const API = "https://zernio.com/api/v1";

function hydrateZerinoEnv() {
  const file = path.join(process.cwd(), ".env");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (
      key === "zerino_api_key" ||
      key === "ZERNIO_API_KEY" ||
      key === "zerino_sandbox_number" ||
      key === "ZERNIO_SANDBOX_NUMBER" ||
      key === "ZERNIO_WEBHOOK_SECRET"
    ) {
      process.env[key] = value;
    }
  }
}

function env(...names: string[]): string {
  hydrateZerinoEnv();
  for (const name of names) {
    const v = (process.env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function zernioApiKey(): string {
  return env("ZERNIO_API_KEY", "zerino_api_key");
}

export function zernioSandboxNumber(): string {
  const raw = env("ZERNIO_SANDBOX_NUMBER", "zerino_sandbox_number");
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return `+${digits.replace(/^\+/, "")}`;
}

export function zernioConfigured(): boolean {
  return zernioApiKey().startsWith("sk_");
}

export function zernioWebhookSecret(): string {
  return env("ZERNIO_WEBHOOK_SECRET");
}

export class ZernioApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, body: unknown) {
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
    const message =
      (typeof record?.error === "string" && record.error) ||
      (typeof record?.message === "string" && record.message) ||
      JSON.stringify(body);
    super(`Zernio ${status}: ${message}`);
    this.name = "ZernioApiError";
    this.status = status;
    this.code = typeof record?.code === "string" ? record.code : undefined;
    this.details =
      record?.details && typeof record.details === "object"
        ? (record.details as Record<string, unknown>)
        : undefined;
  }
}

async function zernio<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = zernioApiKey();
  if (!key) throw new Error("Set ZERNIO_API_KEY or zerino_api_key in .env");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  if (!res.ok) {
    throw new ZernioApiError(res.status, body);
  }
  return body as T;
}

export type ZernioSandbox = {
  accountId: string;
  phoneNumber: string;
  template?: { name: string; language: string };
};

export async function fetchZernioSandbox(): Promise<ZernioSandbox | null> {
  const data = await zernio<{
    sandbox?: ZernioSandbox | null;
  }>("/whatsapp/phone-numbers");
  return data.sandbox ?? null;
}

function profileIdFrom(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const root = body as Record<string, unknown>;
  const nested = (root.profile ?? root.data) as Record<string, unknown> | undefined;
  const id =
    (typeof root._id === "string" && root._id) ||
    (typeof root.id === "string" && root.id) ||
    (typeof nested?._id === "string" && nested._id) ||
    (typeof nested?.id === "string" && nested.id) ||
    "";
  return id;
}

export function zernioProfileName(tenantName: string, tenantId: string): string {
  const suffix = tenantId.slice(0, 8);
  const base = tenantName.trim() || "tenant";
  return `${base} · ${suffix}`;
}

export async function createZernioProfile(name: string): Promise<string> {
  try {
    const body = await zernio<unknown>("/profiles", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const id = profileIdFrom(body);
    if (!id) throw new Error("Zernio profile create returned no id");
    return id;
  } catch (err) {
    if (
      err instanceof ZernioApiError &&
      err.status === 409 &&
      err.code === "profile_name_conflict"
    ) {
      const existingProfileId =
        typeof err.details?.existingProfileId === "string"
          ? err.details.existingProfileId
          : "";
      if (existingProfileId) return existingProfileId;
    }
    throw err;
  }
}

export async function zernioConnectUrl(opts: {
  platform: "whatsapp" | "instagram";
  profileId: string;
  redirectUrl: string;
}): Promise<string> {
  const qs = new URLSearchParams({
    profileId: opts.profileId,
    redirect_url: opts.redirectUrl,
  });
  const data = await zernio<{ authUrl?: string; auth_url?: string }>(
    `/connect/${opts.platform}?${qs.toString()}`,
  );
  const url = data.authUrl || data.auth_url || "";
  if (!url) throw new Error("Zernio did not return an auth URL");
  return url;
}

export async function zernioWhatsAppConnectUrl(opts: {
  profileId: string;
  redirectUrl: string;
}): Promise<string> {
  return zernioConnectUrl({ ...opts, platform: "whatsapp" });
}

export type ZernioWebhookSettings = {
  _id: string;
  name: string;
  url: string;
  events: string[];
  isActive?: boolean;
};

//for local scripts
export async function createZernioWebhookSettings(opts: {
  name: string;
  url: string;
  events: string[];
  secret?: string;
  isActive?: boolean;
}): Promise<ZernioWebhookSettings> {
  const data = await zernio<{ webhook?: ZernioWebhookSettings; success?: boolean }>(
    "/webhooks/settings",
    {
      method: "POST",
      body: JSON.stringify({
        name: opts.name,
        url: opts.url,
        events: opts.events,
        ...(opts.secret ? { secret: opts.secret } : {}),
        isActive: opts.isActive ?? true,
      }),
    },
  );
  const webhook = data.webhook;
  if (!webhook?._id) throw new Error("Zernio webhook create returned no webhook");
  return webhook;
}

//for local scripts
export async function listZernioWebhookSettings(): Promise<ZernioWebhookSettings[]> {
  const data = await zernio<{ webhooks?: ZernioWebhookSettings[] }>("/webhooks/settings");
  return data.webhooks ?? [];
}

/**
 * Path of Zernio's bulk template send (SDK: whatsapp.sendWhatsAppBulk).
 * Verify against the API reference before enabling the digest — this has not
 * been confirmed against a live send (no platform number / approved template
 * yet). See task-14 report for details.
 */
const WHATSAPP_BULK_PATH = "/whatsapp/bulk";

export async function sendWhatsAppTemplate(opts: {
  accountId: string;
  phone: string;
  template: { name: string; language: string };
  variables: Record<string, string>;
}): Promise<void> {
  await zernio(WHATSAPP_BULK_PATH, {
    method: "POST",
    body: JSON.stringify({
      accountId: opts.accountId,
      recipients: [{ phone: opts.phone, variables: opts.variables }],
      template: opts.template,
    }),
  });
}

export async function sendZernioInboxMessage(opts: {
  accountId: string;
  conversationId: string;
  text: string;
}): Promise<void> {
  await zernio(`/inbox/conversations/${encodeURIComponent(opts.conversationId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      accountId: opts.accountId,
      message: opts.text,
    }),
  });
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type ZernioInbound = {
  eventId: string;
  platformMessageId: string;
  accountId: string;
  conversationId: string;
  from: string;
  text: string;
  platform?: string;
  senderName?: string;
  senderUsername?: string;
};

export type ZernioInboxContact = {
  name: string;
  username: string;
  participantId: string;
};

export function parseZernioInboxContact(payload: unknown): ZernioInboxContact {
  const root =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  const profile =
    data.instagramProfile && typeof data.instagramProfile === "object"
      ? (data.instagramProfile as Record<string, unknown>)
      : {};
  const participants = Array.isArray(data.participants) ? data.participants : [];
  const firstParticipant =
    participants[0] && typeof participants[0] === "object"
      ? (participants[0] as Record<string, unknown>)
      : {};
  const url =
    asTrimmedString(data.url) ||
    asTrimmedString(data.profileUrl) ||
    asTrimmedString(profile.url);
  const usernameFromUrl = url.match(/instagram\.com\/([^/?#]+)/i)?.[1] ?? "";
  const username = (
    asTrimmedString(data.participantUsername) ||
    asTrimmedString(data.username) ||
    asTrimmedString(profile.username) ||
    asTrimmedString(firstParticipant.username) ||
    usernameFromUrl
  ).replace(/^@/, "");
  const name =
    asTrimmedString(data.participantName) ||
    asTrimmedString(data.name) ||
    asTrimmedString(firstParticipant.name);
  const participantId =
    asTrimmedString(data.participantId) || asTrimmedString(firstParticipant.id);
  return { name, username, participantId };
}

export async function fetchZernioInboxContact(opts: {
  accountId: string;
  conversationId: string;
}): Promise<ZernioInboxContact | null> {
  const qs = new URLSearchParams({ accountId: opts.accountId });
  try {
    const body = await zernio<unknown>(
      `/inbox/conversations/${encodeURIComponent(opts.conversationId)}?${qs.toString()}`,
    );
    const contact = parseZernioInboxContact(body);
    if (!contact.name && !contact.username && !contact.participantId) return null;
    return contact;
  } catch {
    return null;
  }
}

export function parseZernioMessageReceived(payload: unknown): ZernioInbound | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.event !== "message.received") return null;
  const message = root.message as Record<string, unknown> | undefined;
  if (!message) return null;
  if (message.direction !== "incoming") return null;
  const account = (root.account as Record<string, unknown> | undefined) ?? {};
  const sender = (message.sender as Record<string, unknown> | undefined) ?? {};
  const conversation = (root.conversation as Record<string, unknown> | undefined) ?? {};
  const senderUsername = (
    asTrimmedString(sender.username) || asTrimmedString(conversation.participantUsername)
  ).replace(/^@/, "");
  const senderName =
    asTrimmedString(sender.name) || asTrimmedString(conversation.participantName);
  const from =
    asTrimmedString(sender.phoneNumber) ||
    asTrimmedString(sender.id) ||
    asTrimmedString(sender._id) ||
    senderUsername;
  const conversationId =
    asTrimmedString(message.conversationId) || asTrimmedString(conversation.id);
  const accountId = asTrimmedString(account.id);
  const platformMessageId =
    asTrimmedString(message.platformMessageId) ||
    asTrimmedString(message.id) ||
    asTrimmedString(root.id);
  const platform =
    asTrimmedString(message.platform) || asTrimmedString(account.platform) || undefined;
  if (!from || !platformMessageId || !conversationId) return null;
  return {
    eventId: asTrimmedString(root.id) || platformMessageId,
    platformMessageId,
    accountId,
    conversationId,
    from,
    text: typeof message.text === "string" ? message.text : "",
    platform,
    senderName: senderName || undefined,
    senderUsername: senderUsername || undefined,
  };
}

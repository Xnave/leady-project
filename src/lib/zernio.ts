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
    const message =
      typeof body === "object" && body && "message" in body
        ? JSON.stringify((body as { message: unknown }).message)
        : text;
    throw new Error(`Zernio ${res.status}: ${message}`);
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

export type ZernioInbound = {
  eventId: string;
  platformMessageId: string;
  accountId: string;
  conversationId: string;
  from: string;
  text: string;
  platform?: string;
};

export function parseZernioMessageReceived(payload: unknown): ZernioInbound | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.event !== "message.received") return null;
  const message = root.message as Record<string, unknown> | undefined;
  if (!message) return null;
  if (message.direction === "outgoing") return null;
  const account = (root.account as Record<string, unknown> | undefined) ?? {};
  const sender = (message.sender as Record<string, unknown> | undefined) ?? {};
  const conversation = (root.conversation as Record<string, unknown> | undefined) ?? {};
  const from =
    (typeof sender.phoneNumber === "string" && sender.phoneNumber) ||
    (typeof sender.id === "string" && sender.id) ||
    "";
  const text = typeof message.text === "string" ? message.text : "";
  const conversationId =
    (typeof message.conversationId === "string" && message.conversationId) ||
    (typeof conversation.id === "string" && conversation.id) ||
    "";
  const accountId = typeof account.id === "string" ? account.id : "";
  const platformMessageId =
    (typeof message.platformMessageId === "string" && message.platformMessageId) ||
    (typeof message.id === "string" && message.id) ||
    (typeof root.id === "string" && root.id) ||
    "";
  if (!from || !platformMessageId || !conversationId) return null;
  return {
    eventId: typeof root.id === "string" ? root.id : platformMessageId,
    platformMessageId,
    accountId,
    conversationId,
    from,
    text,
    platform: typeof message.platform === "string" ? message.platform : undefined,
  };
}

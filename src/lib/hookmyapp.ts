const API = "https://api.hookmyapp.com";

function apiKey(): string {
  const key = process.env.HOOKMYAPP_API_KEY ?? "";
  if (!key.startsWith("hmok_")) {
    throw new Error("Set HOOKMYAPP_API_KEY (hmok_…) from HookMyApp Org → API keys");
  }
  return key;
}

function orgId(): string {
  const id = process.env.HOOKMYAPP_ORG_ID ?? "";
  if (!id.startsWith("org_")) {
    throw new Error("Set HOOKMYAPP_ORG_ID (org_…) from the HookMyApp dashboard");
  }
  return id;
}

export function hookmyappConfigured(): boolean {
  return Boolean(
    process.env.HOOKMYAPP_API_KEY?.startsWith("hmok_") &&
      process.env.HOOKMYAPP_ORG_ID?.startsWith("org_"),
  );
}

async function hma<T>(
  path: string,
  opts: RequestInit & { workspaceId?: string } = {},
): Promise<T> {
  const { workspaceId, ...init } = opts;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey()}`);
  headers.set("Content-Type", "application/json");
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
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
    throw new Error(`HookMyApp ${res.status}: ${message}`);
  }
  return body as T;
}

export async function ensureCustomerWorkspace(opts: {
  name: string;
  externalId: string;
  existingWorkspaceId?: string | null;
}): Promise<string> {
  if (opts.existingWorkspaceId) return opts.existingWorkspaceId;
  const created = await hma<{ id: string }>(`/organizations/${orgId()}/customers`, {
    method: "POST",
    body: JSON.stringify({ name: opts.name.slice(0, 80), externalId: opts.externalId }),
  });
  return created.id;
}

export async function createOnboardingLink(opts: {
  channelType: "whatsapp" | "instagram";
  label: string;
  workspaceId: string;
  webhookUrl: string;
  verifyToken: string;
  successRedirectUrl: string;
  connectedNotificationUrl: string;
}): Promise<{ url: string; publicId: string; verifyToken?: string | null }> {
  return hma("/org/onboarding-links", {
    method: "POST",
    body: JSON.stringify({
      channelType: opts.channelType,
      label: opts.label.slice(0, 80),
      targetWorkspaceId: opts.workspaceId,
      destinationWebhookUrl: opts.webhookUrl,
      destinationVerifyTokenOverride: opts.verifyToken,
      successRedirectUrl: opts.successRedirectUrl,
      connectedNotificationUrl: opts.connectedNotificationUrl,
    }),
  });
}

type HmaChannel = {
  id?: string;
  publicId?: string;
  type?: string;
  channelType?: string;
  phoneNumberId?: string;
  accountId?: string;
  instagramAccountId?: string;
};

export async function listWorkspaceChannels(workspaceId: string): Promise<HmaChannel[]> {
  const data = await hma<HmaChannel[] | { channels?: HmaChannel[] }>("/meta/channels", {
    workspaceId,
  });
  if (Array.isArray(data)) return data;
  return data.channels ?? [];
}

export async function readChannelEnv(
  workspaceId: string,
  channelId: string,
): Promise<Record<string, string>> {
  const env = await hma<Record<string, string> | { env?: Record<string, string> }>(
    `/meta/channels/${channelId}/env`,
    { workspaceId },
  );
  if (
    env &&
    typeof env === "object" &&
    "env" in env &&
    env.env &&
    typeof env.env === "object"
  ) {
    return env.env;
  }
  return (env ?? {}) as Record<string, string>;
}

export async function readChannelToken(workspaceId: string, channelId: string): Promise<string> {
  const data = await hma<{ token?: string; accessToken?: string }>(
    `/meta/channels/${channelId}/token`,
    { workspaceId },
  );
  return data.token ?? data.accessToken ?? "";
}

export async function readWebhookHmac(workspaceId: string, channelId: string): Promise<string> {
  const data = await hma<{ secret?: string; hmacSecret?: string; WEBHOOK_HMAC_SECRET?: string }>(
    `/webhook-config/${channelId}/hmac`,
    { workspaceId },
  );
  return data.secret ?? data.hmacSecret ?? data.WEBHOOK_HMAC_SECRET ?? "";
}

export async function setWebhookUrl(
  workspaceId: string,
  channelId: string,
  url: string,
  verifyToken: string,
) {
  await hma(`/webhook-config/${channelId}`, {
    method: "PUT",
    workspaceId,
    body: JSON.stringify({ url, verifyToken }),
  });
}

export function parseChannelIdentity(env: Record<string, string>, fallback?: HmaChannel) {
  const provider: "whatsapp" | "instagram" = env.INSTAGRAM_ACCOUNT_ID
    ? "instagram"
    : fallback?.channelType === "instagram" || fallback?.type === "instagram"
      ? "instagram"
      : "whatsapp";
  const providerAccountId =
    env.WHATSAPP_PHONE_NUMBER_ID ||
    env.INSTAGRAM_ACCOUNT_ID ||
    fallback?.phoneNumberId ||
    fallback?.instagramAccountId ||
    fallback?.accountId ||
    "";
  const accessToken =
    env.WHATSAPP_ACCESS_TOKEN || env.INSTAGRAM_ACCESS_TOKEN || "";
  const hmac = env.WEBHOOK_HMAC_SECRET || "";
  const verifyToken = env.VERIFY_TOKEN || "";
  const channelId = env.HOOKMYAPP_CHANNEL_ID || fallback?.id || fallback?.publicId || "";
  const apiBase =
    env.META_GRAPH_API_URL ||
    env.WHATSAPP_API_URL ||
    env.INSTAGRAM_API_URL ||
    "https://gateway.hookmyapp.com/meta";
  return { provider, providerAccountId, accessToken, hmac, verifyToken, channelId, apiBase };
}

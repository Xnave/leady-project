import { uiCopy, type UiLang } from "@/lib/ui";

export function isDemoLead(externalUserId: string): boolean {
  return externalUserId.startsWith("demo-");
}

export function looksLikePlatformUserId(value: string): boolean {
  return /^\d{8,}$/.test(value.trim());
}

export function displayNameFromLeadFields(fields: Record<string, unknown> | null | undefined): string | undefined {
  const name = typeof fields?.name === "string" ? fields.name.trim() : "";
  if (!name || looksLikePlatformUserId(name)) return undefined;
  return name;
}

export function normalizeInstagramUsername(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^@/, "");
}

export function instagramProfileUrl(username: string | null | undefined): string {
  const handle = normalizeInstagramUsername(username);
  if (!handle || looksLikePhoneNumberish(handle)) return "";
  return `https://instagram.com/${encodeURIComponent(handle)}`;
}

export function whatsappChatUrl(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  if (digits.length < 8) return "";
  return `https://wa.me/${digits}`;
}

function looksLikePhoneNumberish(value: string): boolean {
  const t = value.trim();
  return /^\+?\d[\d\s-]{6,}\d$/.test(t) || looksLikePlatformUserId(t);
}

export function leadInstagramUsername(fields?: unknown): string {
  const record = (fields ?? {}) as Record<string, unknown>;
  const raw = normalizeInstagramUsername(
    typeof record.instagramUsername === "string" ? record.instagramUsername : "",
  );
  if (!raw || looksLikePhoneNumberish(raw)) return "";
  return raw;
}

export function contactDisplayName(opts: {
  name?: string | null;
  username?: string | null;
  fallback: string;
}): string {
  const name = opts.name?.trim() ?? "";
  const username = normalizeInstagramUsername(opts.username);
  const usableName = name && !looksLikePlatformUserId(name) ? name : "";
  if (usableName && username && !usableName.toLowerCase().includes(username.toLowerCase())) {
    return `${usableName} (@${username})`;
  }
  if (usableName) return usableName;
  if (username) return `@${username}`;
  return opts.fallback;
}

export function instagramIdentityFields(
  name?: string | null,
  username?: string | null,
): Record<string, string> {
  const extra: Record<string, string> = {};
  const cleanName = name?.trim() ?? "";
  const user = normalizeInstagramUsername(username);
  if (cleanName && !looksLikePlatformUserId(cleanName)) extra.name = cleanName;
  if (user) extra.instagramUsername = user;
  return extra;
}

export function leadDisplayName(lead: {
  displayName?: string | null;
  externalUserId: string;
  fields?: unknown;
}): string {
  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  const fromFields = typeof fields.name === "string" ? fields.name.trim() : "";
  const username = leadInstagramUsername(fields);
  const stored = lead.displayName?.trim() ?? "";
  const usableStored = stored && !looksLikePlatformUserId(stored) ? stored : "";
  return (
    contactDisplayName({
      name: fromFields || usableStored,
      username,
      fallback: "",
    }) ||
    usableStored ||
    lead.externalUserId
  );
}

export function channelLabel(
  lang: UiLang,
  channel: { provider: string; providerAccountId: string } | null | undefined,
): string {
  const ui = uiCopy(lang);
  if (!channel) return ui.common.empty;
  const provider =
    channel.provider === "instagram" ? ui.common.instagram : ui.common.whatsapp;
  return `${provider} · ${channel.providerAccountId}`;
}

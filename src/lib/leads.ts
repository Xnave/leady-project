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

/**
 * Display phones for UI: +972… → 0…, spaced as 052-659-5639.
 * Non-IL numbers stay digit-grouped lightly.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim();
  if (!raw) return "";
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("972") && digits.length >= 11) {
    digits = `0${digits.slice(3)}`;
  } else if (raw.startsWith("+972") && digits.startsWith("972")) {
    digits = `0${digits.slice(3)}`;
  }
  // Israeli mobile 05X-XXX-XXXX
  if (/^05\d{8}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (/^0\d{8,9}$/.test(digits)) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return digits || raw;
}

/** True when stored name looks like a nickname / partial / non-person name. */
export function looksLikeIncompleteCustomerName(name: string | null | undefined): boolean {
  const t = (name ?? "").trim();
  if (!t) return true;
  if (looksLikePlatformUserId(t)) return true;
  if (looksLikePhoneNumberish(t)) return true;
  // Emoji / symbols only or mostly
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t)) return true;
  // Single very short token (e.g. "N", "Avi" alone is ok at 3+ hebrew/latin letters)
  const cleaned = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
  if (!cleaned) return true;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1 && parts[0].length < 2) return true;
  // Nickname / partial: single token (no family name) unless agent already verified.
  if (parts.length < 2) return true;
  // Display names that are clearly channel nicknames with heart/fire etc.
  if (/[\p{Emoji_Presentation}]/u.test(t)) return true;
  return false;
}

/** True when booking may treat `name` as filled (agent-collected or looks complete). */
export function isCustomerNameSatisfied(fields: Record<string, unknown> | null | undefined): boolean {
  const name = typeof fields?.name === "string" ? fields.name.trim() : "";
  if (!name) return false;
  const verified =
    fields?.name_collected_by_agent === true ||
    fields?.name_collected_by_agent === "1" ||
    fields?.name_collected_by_agent === "true";
  if (verified) return true;
  return !looksLikeIncompleteCustomerName(name);
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

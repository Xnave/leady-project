import { uiCopy, type UiLang } from "@/lib/ui";

export function isDemoLead(externalUserId: string): boolean {
  return externalUserId.startsWith("demo-");
}

export function leadDisplayName(lead: {
  displayName?: string | null;
  externalUserId: string;
  fields?: unknown;
}): string {
  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  const fromFields = typeof fields.name === "string" ? fields.name.trim() : "";
  return fromFields || lead.displayName?.trim() || lead.externalUserId;
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

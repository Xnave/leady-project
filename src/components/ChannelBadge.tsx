import { uiCopy, type UiLang } from "@/lib/ui";

export function ChannelBadge({
  lang,
  channel,
}: {
  lang: UiLang;
  channel: { provider: string; providerAccountId: string } | null | undefined;
}) {
  const ui = uiCopy(lang);
  if (!channel) return <span className="muted">{ui.common.empty}</span>;

  const label =
    channel.provider === "instagram" ? ui.common.instagram : ui.common.whatsapp;
  const number = channel.providerAccountId.trim();

  return (
    <span className="channel-badge" title={number || undefined}>
      {label}
    </span>
  );
}

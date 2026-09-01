import { ConnectWhatsAppButton } from "@/components/ConnectWhatsAppButton";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { zernioConfigured } from "@/lib/zernio";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const channels = await prisma.channelConnection.findMany({
    where: { tenantId },
    include: { agent: true },
  });
  const ready = zernioConfigured();
  const liveWa = channels.find(
    (ch) =>
      ch.provider === "whatsapp" &&
      !ch.providerAccountId.startsWith("demo-") &&
      !String(ch.providerExternalId ?? "").startsWith("local-"),
  );

  return (
    <div>
      <PageHeader title={ui.page.channelsTitle} />
      {connected ? <p className="card">{ui.common.connectedNumber}</p> : null}
      {error ? <p className="card">{error}</p> : null}
      <div className="card stack">
        <h2>{ui.common.whatsapp}</h2>
        {ready ? (
          <>
            {liveWa ? (
              <p>
                {ui.common.connectedNumber}: <strong>{liveWa.providerAccountId}</strong>
                <br />
                <span className="muted">
                  {ui.common.accountId}: {liveWa.providerExternalId}
                </span>
              </p>
            ) : (
              <p className="muted">{ui.page.setupBlurb}</p>
            )}
            <ConnectWhatsAppButton
              label={liveWa ? ui.common.reconnectWhatsApp : ui.common.connectWhatsApp}
              errorLabel={ui.errors.connectFailed}
            />
          </>
        ) : (
          <p className="muted">{ui.common.zernioMissing}</p>
        )}
      </div>
      <div className="card stack">
        <h2>{ui.common.instagram}</h2>
        <button type="button" disabled>
          {ui.common.comingSoon}
        </button>
      </div>
      {channels.map((ch) => (
        <div key={ch.id} className="card">
          <strong>{ch.provider === "instagram" ? ui.common.instagram : ui.common.whatsapp}</strong>
          {" · "}
          {ch.providerAccountId}
          <p className="muted">
            {ch.agent.name} · {ch.enabled ? ui.common.on : ui.common.off}
          </p>
        </div>
      ))}
    </div>
  );
}

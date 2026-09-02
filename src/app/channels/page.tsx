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
  const isConnected = Boolean(liveWa);

  return (
    <div>
      <PageHeader title={ui.page.channelsTitle} />
      {connected ? (
        <div className="status-banner ok">{ui.channels.connectedSuccess}</div>
      ) : null}
      {error ? <div className="status-banner warn">{error}</div> : null}

      <div className="channels-hero">
        <div className="card stack">
          <div className="channel-row">
            <h2>{ui.channels.whatsAppPrimary}</h2>
            <span className={`badge${isConnected ? "" : " badge-warn"}`}>
              {isConnected ? ui.channels.statusConnected : ui.channels.statusDisconnected}
            </span>
          </div>
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
                <p className="muted">{ui.channels.notConnectedHint}</p>
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
        <div className="card">
          <h2>{ui.channels.connectStepsTitle}</h2>
          <ol className="connect-steps">
            <li>{ui.channels.stepConnect}</li>
            <li>{ui.channels.stepVerify}</li>
            <li>{ui.channels.stepLive}</li>
          </ol>
        </div>
      </div>

      <div className="card stack">
        <h2>{ui.common.instagram}</h2>
        <p className="muted">{ui.common.comingSoon}</p>
        <button type="button" disabled>
          {ui.common.comingSoon}
        </button>
      </div>

      {channels.length > 0 ? (
        <div className="card">
          <h2>{ui.channels.allConnections}</h2>
          {channels.map((ch) => (
            <div key={ch.id} className="channel-row stage-node">
              <div>
                <strong>{ch.provider === "instagram" ? ui.common.instagram : ui.common.whatsapp}</strong>
                {" · "}
                {ch.providerAccountId}
                <p className="muted">
                  {ch.agent.name} · {ch.enabled ? ui.common.on : ui.common.off}
                </p>
              </div>
              <span className={`badge${ch.enabled ? "" : " badge-demo"}`}>
                {ch.enabled ? ui.common.on : ui.common.off}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

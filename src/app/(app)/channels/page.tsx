import { ConnectChannelButton } from "@/components/ConnectChannelButton";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { zernioConfigured } from "@/lib/zernio";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";
import { normalizeCatalogId } from "@/lib/flow/catalog";

export const dynamic = "force-dynamic";

function isLiveChannel(ch: {
  providerAccountId: string;
  providerExternalId: string | null;
}) {
  return (
    !ch.providerAccountId.startsWith("demo-") &&
    !String(ch.providerExternalId ?? "").startsWith("local-")
  );
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const channels = await prisma.channelConnection.findMany({
    where: { tenantId },
    include: { agent: true },
  });
  const ready = zernioConfigured();
  const liveWa = channels.find((ch) => ch.provider === "whatsapp" && isLiveChannel(ch));
  const liveIg = channels.find((ch) => ch.provider === "instagram" && isLiveChannel(ch));

  const rows = [
    {
      provider: "whatsapp" as const,
      label: ui.common.whatsapp,
      live: liveWa,
      connectLabel: liveWa ? ui.common.reconnectWhatsApp : ui.common.connectWhatsApp,
    },
    {
      provider: "instagram" as const,
      label: ui.common.instagram,
      live: liveIg,
      connectLabel: liveIg ? ui.common.reconnectInstagram : ui.common.connectInstagram,
    },
  ];

  return (
    <div>
      <PageHeader title={ui.page.channelsTitle} />
      {connected === "instagram" ? (
        <div className="status-banner ok">{ui.channels.instagramConnectedSuccess}</div>
      ) : connected ? (
        <div className="status-banner ok">{ui.channels.connectedSuccess}</div>
      ) : null}
      {error ? <div className="status-banner warn">{error}</div> : null}
      {!ready ? <p className="muted">{ui.common.zernioMissing}</p> : null}

      {!liveWa && ready ? (
        <div className="card">
          <h2>{ui.channels.connectStepsTitle}</h2>
          <ol className="connect-steps">
            <li>{ui.channels.stepConnect}</li>
            <li>{ui.channels.stepVerify}</li>
            <li>{ui.channels.stepLive}</li>
          </ol>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{ui.common.channel}</th>
              <th>{ui.channels.identity}</th>
              <th>{ui.common.status}</th>
              <th>{ui.common.flow}</th>
              <th>{ui.channels.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.provider}>
                <td>{row.label}</td>
                <td>
                  {row.live?.providerAccountId ? (
                    <span dir="ltr" className="ltr-isolate">
                      {row.live.providerAccountId}
                    </span>
                  ) : (
                    ui.common.empty
                  )}
                </td>
                <td>
                  <span className={`badge${row.live?.enabled ? "" : " badge-warn"}`}>
                    {row.live?.enabled
                      ? ui.channels.statusConnected
                      : ui.channels.statusDisconnected}
                  </span>
                </td>
                <td className="muted">
                  {row.live?.agent
                    ? ui.catalog[normalizeCatalogId(row.live.agent.catalogId)].title
                    : ui.common.empty}
                </td>
                <td className="table-actions">
                  {ready ? (
                    <ConnectChannelButton
                      provider={row.provider}
                      label={row.connectLabel}
                      errorLabel={ui.errors.connectFailed}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

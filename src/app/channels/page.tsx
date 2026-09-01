import { prisma } from "@/lib/db";
import { ensureDevZernioChannel } from "@/lib/channels/zernio-dev";
import { zernioConfigured, zernioSandboxNumber } from "@/lib/zernio";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; synced?: string }>;
}) {
  const { connected, synced } = await searchParams;
  const tenantId = await requireTenantId();
  if (zernioConfigured()) {
    try {
      await ensureDevZernioChannel(tenantId);
    } catch (err) {
      console.error(err);
    }
  }
  const channels = await prisma.channelConnection.findMany({
    where: { tenantId },
    include: { agent: true },
  });
  const sandbox = zernioSandboxNumber();
  const ready = zernioConfigured();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <div>
      <h1>Channels</h1>
      {connected ? <p className="card">Connect finished.</p> : null}
      {synced ? <p className="muted">Synced: {synced}</p> : null}
      <div className="card">
        <h2>Zernio WhatsApp</h2>
        {ready ? (
          <>
            <p className="muted">
              Dev tenant uses the Zernio sandbox number{" "}
              <strong>{sandbox || "(from API)"}</strong>. Inbound webhook:
              <code> {appUrl}/api/webhooks/zernio</code>
              {appUrl.startsWith("https://")
                ? ". Point a Zernio webhook at that URL, event message.received."
                : ". Use a public HTTPS URL (tunnel) — localhost will not receive WhatsApp."}
            </p>
          </>
        ) : (
          <p className="muted">
            Add <code>zerino_api_key</code> and <code>zerino_sandbox_number</code> to{" "}
            <code>.env</code>, then restart the server.
          </p>
        )}
      </div>
      {channels.map((ch) => (
        <div key={ch.id} className="card">
          <strong>{ch.provider}</strong> · {ch.providerAccountId}
          <p className="muted">
            Agent: {ch.agent.name} · {ch.enabled ? "on" : "off"}
            {ch.apiBase.includes("zernio") ? " · Zernio" : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

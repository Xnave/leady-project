"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ZernioGateMode } from "@/lib/zernio-sender-gate";

type Labels = {
  createTenant: string;
  tenantName: string;
  tenantPhone: string;
  ownerEmail: string;
  openAsTenant: string;
  createFailed: string;
  createdClaimOnSignIn: string;
  search: string;
  forbidden: string;
  zernioGateTitle: string;
  zernioGateSender: string;
  zernioGateAdd: string;
  zernioGateRemove: string;
  zernioGateEmpty: string;
  zernioGateFormat: string;
  zernioGateHintProduction: string;
  zernioGateHintPreview: string;
  zernioGateHintLocal: string;
  tenantsTab: string;
  demosTab: string;
  demoCode: string;
  demoWebsite: string;
  demoCreated: string;
  demoExpires: string;
  demoNotStarted: string;
  demoLeads: string;
  demoMessages: string;
  demoViewAs: string;
  demoEmpty: string;
  demoStatus: string;
};

type TenantRow = { id: string; name: string; phone: string; ownerEmail?: string };

export type AdminDemoRow = {
  id: string;
  name: string;
  code: string;
  websiteHost: string;
  statusLabel: string;
  created: string;
  expires: string;
  phone: string;
  /** Display phone plus the stored number, so search matches either form. */
  phoneQuery: string;
  leadCount: number | null;
  messageCount: number | null;
  tenantId: string | null;
};

export function AdminClient({
  labels,
  unlocked,
  tenants,
  demos,
  gateMode,
  gatedSenders,
}: {
  labels: Labels;
  unlocked: boolean;
  tenants: TenantRow[];
  demos: AdminDemoRow[];
  gateMode: ZernioGateMode;
  gatedSenders: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [tab, setTab] = useState<"tenants" | "demos">("tenants");
  const [query, setQuery] = useState("");
  const [demoQuery, setDemoQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sender, setSender] = useState("");
  const [gateError, setGateError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.phone.toLowerCase().includes(q) ||
        (t.ownerEmail ?? "").toLowerCase().includes(q),
    );
  }, [tenants, query]);

  const filteredDemos = useMemo(() => {
    const q = demoQuery.trim().toLowerCase();
    if (!q) return demos;
    return demos.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.code.toLowerCase().includes(q) ||
        d.websiteHost.toLowerCase().includes(q) ||
        d.phoneQuery.toLowerCase().includes(q),
    );
  }, [demos, demoQuery]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, phone, ownerEmail }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      ownerAccess?: "member" | "invited" | "claim_on_signin";
    };
    if (!res.ok) {
      setError(data.error ?? labels.createFailed);
      return;
    }
    if (data.ownerAccess === "claim_on_signin") {
      setNotice(labels.createdClaimOnSignIn);
    }
    setName("");
    setPhone("");
    setOwnerEmail("");
    router.refresh();
  }

  async function addSender(e: FormEvent) {
    e.preventDefault();
    setGateError("");
    const res = await fetch("/api/admin/zernio-senders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setGateError(data.error ?? labels.createFailed);
      return;
    }
    setSender("");
    router.refresh();
  }

  async function removeSender(key: string) {
    setGateError("");
    const res = await fetch("/api/admin/zernio-senders", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender: key }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setGateError(data.error ?? labels.createFailed);
      return;
    }
    router.refresh();
  }

  if (!unlocked) {
    return <p className="muted">{labels.forbidden}</p>;
  }

  const gateHint =
    gateMode === "pause"
      ? labels.zernioGateHintProduction
      : gateMode === "allow"
        ? labels.zernioGateHintPreview
        : labels.zernioGateHintLocal;

  return (
    <div className="stack">
      <div className="crm-bar" role="tablist">
        <div className="crm-tabs">
          <button
            type="button"
            className="crm-tab"
            role="tab"
            aria-selected={tab === "tenants"}
            onClick={() => setTab("tenants")}
          >
            {labels.tenantsTab}
          </button>
          <button
            type="button"
            className="crm-tab"
            role="tab"
            aria-selected={tab === "demos"}
            onClick={() => setTab("demos")}
          >
            {labels.demosTab}
          </button>
        </div>
      </div>
      {tab === "demos" ? (
        <DemosTable labels={labels} demos={filteredDemos} query={demoQuery} onQuery={setDemoQuery} />
      ) : null}
      {tab === "tenants" ? (
        <>
        <section className="card stack">
          <h2>{labels.zernioGateTitle}</h2>
          <p className="muted">{gateHint}</p>
          <p className="muted">{labels.zernioGateFormat}</p>
          <form onSubmit={(e) => void addSender(e)} className="create-inline">
            <label>
              {labels.zernioGateSender}
              <input value={sender} onChange={(e) => setSender(e.target.value)} required />
            </label>
            <button type="submit">{labels.zernioGateAdd}</button>
          </form>
          {gateError ? <p className="muted">{gateError}</p> : null}
          {gatedSenders.length === 0 ? <p className="muted">{labels.zernioGateEmpty}</p> : null}
          <ul>
            {gatedSenders.map((key) => (
              <li key={key}>
                <span>{key}</span>{" "}
                <button type="button" className="btn-secondary" onClick={() => void removeSender(key)}>
                  {labels.zernioGateRemove}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <form onSubmit={(e) => void create(e)} className="card create-inline">
          <label>
            {labels.tenantName}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            {labels.tenantPhone}
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            {labels.ownerEmail}
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
          </label>
          <button type="submit">{labels.createTenant}</button>
        </form>
        {error ? <p className="muted">{error}</p> : null}
        {notice ? <p className="muted">{notice}</p> : null}
        <label>
          {labels.search}
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{labels.tenantName}</th>
                <th>{labels.ownerEmail}</th>
                <th>{labels.tenantPhone}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted">{t.ownerEmail || "-"}</td>
                  <td className="muted">{t.phone || t.id}</td>
                  <td className="table-actions">
                    <form action="/api/admin/impersonate" method="post">
                      <input type="hidden" name="tenantId" value={t.id} />
                      <button type="submit" className="btn-secondary">
                        {labels.openAsTenant}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : null}
    </div>
  );
}

function DemosTable({
  labels,
  demos,
  query,
  onQuery,
}: {
  labels: Labels;
  demos: AdminDemoRow[];
  query: string;
  onQuery: (value: string) => void;
}) {
  return (
    <>
      <label>
        {labels.search}
        <input value={query} onChange={(e) => onQuery(e.target.value)} />
      </label>
      {demos.length === 0 ? <p className="muted">{labels.demoEmpty}</p> : null}
      {demos.length === 0 ? null : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{labels.tenantName}</th>
                <th>{labels.demoCode}</th>
                <th>{labels.demoWebsite}</th>
                <th>{labels.demoStatus}</th>
                <th>{labels.demoCreated}</th>
                <th>{labels.demoExpires}</th>
                <th>{labels.tenantPhone}</th>
                <th>{labels.demoLeads}</th>
                <th>{labels.demoMessages}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {demos.map((d) => (
                <tr key={d.id}>
                  <td>{d.name || "-"}</td>
                  <td>{d.code}</td>
                  <td className="muted">{d.websiteHost || "-"}</td>
                  <td>{d.statusLabel}</td>
                  <td className="muted">{d.created}</td>
                  <td className="muted">{d.expires || "-"}</td>
                  <td className="muted">{d.phone || (d.leadCount ? "-" : labels.demoNotStarted)}</td>
                  <td>{d.leadCount ?? "-"}</td>
                  <td>{d.messageCount ?? "-"}</td>
                  <td className="table-actions">
                    {d.tenantId ? (
                      <form action="/api/admin/impersonate" method="post">
                        <input type="hidden" name="tenantId" value={d.tenantId} />
                        <button type="submit" className="btn-secondary">
                          {labels.demoViewAs}
                        </button>
                      </form>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

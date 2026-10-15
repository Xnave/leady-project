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
};

type TenantRow = { id: string; name: string; phone: string; ownerEmail?: string };

export function AdminClient({
  labels,
  unlocked,
  tenants,
  gateMode,
  gatedSenders,
}: {
  labels: Labels;
  unlocked: boolean;
  tenants: TenantRow[];
  gateMode: ZernioGateMode;
  gatedSenders: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [query, setQuery] = useState("");
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
    </div>
  );
}

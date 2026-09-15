"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
};

type TenantRow = { id: string; name: string; phone: string; ownerEmail?: string };

export function AdminClient({
  labels,
  unlocked,
  tenants,
}: {
  labels: Labels;
  unlocked: boolean;
  tenants: TenantRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  if (!unlocked) {
    return <p className="muted">{labels.forbidden}</p>;
  }

  return (
    <div className="stack">
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
                <td className="muted">{t.ownerEmail || "—"}</td>
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

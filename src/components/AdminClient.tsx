"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Labels = {
  adminUnlock: string;
  adminSecret: string;
  unlock: string;
  createTenant: string;
  tenantName: string;
  tenantPhone: string;
  openAsTenant: string;
  badSecret: string;
  createFailed: string;
  search: string;
};

type TenantRow = { id: string; name: string; phone: string };

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
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) => t.name.toLowerCase().includes(q) || t.phone.toLowerCase().includes(q),
    );
  }, [tenants, query]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      setError(labels.badSecret);
      return;
    }
    router.refresh();
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.createFailed);
      return;
    }
    setName("");
    setPhone("");
    router.refresh();
  }

  if (!unlocked) {
    return (
      <form onSubmit={(e) => void unlock(e)} className="card stack form-narrow">
        <p>{labels.adminUnlock}</p>
        <label>
          {labels.adminSecret}
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <div>
          <button type="submit">{labels.unlock}</button>
        </div>
        {error ? <p className="muted">{error}</p> : null}
      </form>
    );
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
        <button type="submit">{labels.createTenant}</button>
      </form>
      {error ? <p className="muted">{error}</p> : null}
      <label>
        {labels.search}
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{labels.tenantName}</th>
              <th>{labels.tenantPhone}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
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

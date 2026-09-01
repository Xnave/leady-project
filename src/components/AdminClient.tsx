"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Labels = {
  adminUnlock: string;
  adminSecret: string;
  unlock: string;
  createTenant: string;
  tenantName: string;
  tenantPhone: string;
  openAsTenant: string;
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
  const [error, setError] = useState("");

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      setError("Bad secret");
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
      setError(data.error ?? "Could not create");
      return;
    }
    setName("");
    setPhone("");
    router.refresh();
  }

  if (!unlocked) {
    return (
      <form onSubmit={(e) => void unlock(e)} className="card stack">
        <p>{labels.adminUnlock}</p>
        <label>
          {labels.adminSecret}
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <button type="submit">{labels.unlock}</button>
        {error ? <p className="muted">{error}</p> : null}
      </form>
    );
  }

  return (
    <div className="stack">
      <form onSubmit={(e) => void create(e)} className="card stack">
        <h2>{labels.createTenant}</h2>
        <label>
          {labels.tenantName}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {labels.tenantPhone}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button type="submit">{labels.createTenant}</button>
        {error ? <p className="muted">{error}</p> : null}
      </form>
      {tenants.map((t) => (
        <form key={t.id} action="/api/admin/impersonate" method="post" className="card row-actions">
          <input type="hidden" name="tenantId" value={t.id} />
          <div>
            <strong>{t.name}</strong>
            <p className="muted">{t.phone || t.id}</p>
          </div>
          <button type="submit">{labels.openAsTenant}</button>
        </form>
      ))}
    </div>
  );
}

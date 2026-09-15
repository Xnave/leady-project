"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Labels = {
  inviteEmail: string;
  inviteRole: string;
  inviteSend: string;
  members: string;
  pendingInvites: string;
  roleOwner: string;
  roleAdmin: string;
  roleMember: string;
  promote: string;
  demote: string;
  remove: string;
  revoke: string;
  loadFailed: string;
  empty: string;
  inviteClaimOnSignIn: string;
};

type Member = {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: "owner" | "admin" | "member";
};

type Invite = {
  id: string;
  email: string;
  role: "admin" | "member";
  status: string;
};

export function TeamClient({ labels }: { labels: Labels }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [actorRole, setActorRole] = useState<"owner" | "admin" | "member">("member");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError("");
    const res = await fetch("/api/team");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.loadFailed);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as {
      members: Member[];
      invites: Invite[];
      actorRole: "owner" | "admin" | "member";
    };
    setMembers(data.members);
    setInvites(data.invites);
    setActorRole(data.actorRole);
    setLoading(false);
  }, [labels.loadFailed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const res = await fetch("/api/team/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      mode?: "member" | "invited" | "pending_signin";
    };
    if (!res.ok) {
      setError(data.error ?? labels.loadFailed);
      return;
    }
    if (data.mode === "pending_signin") {
      setNotice(labels.inviteClaimOnSignIn);
    }
    setEmail("");
    await refresh();
  }

  async function setMemberRole(userId: string, next: "admin" | "member") {
    setError("");
    const res = await fetch(`/api/team/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.loadFailed);
      return;
    }
    await refresh();
  }

  async function remove(userId: string) {
    setError("");
    const res = await fetch(`/api/team/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.loadFailed);
      return;
    }
    await refresh();
  }

  async function revoke(id: string) {
    setError("");
    const res = await fetch(`/api/team/invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? labels.loadFailed);
      return;
    }
    await refresh();
  }

  function roleLabel(r: string) {
    if (r === "owner") return labels.roleOwner;
    if (r === "admin") return labels.roleAdmin;
    return labels.roleMember;
  }

  if (loading) return <p className="muted">…</p>;

  return (
    <div className="stack">
      <form onSubmit={(e) => void invite(e)} className="card create-inline">
        <label>
          {labels.inviteEmail}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {labels.inviteRole}
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
            <option value="member">{labels.roleMember}</option>
            <option value="admin">{labels.roleAdmin}</option>
          </select>
        </label>
        <button type="submit">{labels.inviteSend}</button>
      </form>
      {error ? <p className="muted">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <h3>{labels.members}</h3>
      {members.length === 0 ? <p className="muted">{labels.empty}</p> : null}
      <div className="table-wrap">
        <table>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.name || m.email || m.userId}
                  {m.email && m.name ? <div className="muted">{m.email}</div> : null}
                </td>
                <td>{roleLabel(m.role)}</td>
                <td className="table-actions">
                  {m.role === "owner" ? null : (
                    <>
                      {m.role === "member" ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void setMemberRole(m.userId, "admin")}
                        >
                          {labels.promote}
                        </button>
                      ) : null}
                      {m.role === "admin" && actorRole === "owner" ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void setMemberRole(m.userId, "member")}
                        >
                          {labels.demote}
                        </button>
                      ) : null}
                      {m.role === "member" || actorRole === "owner" ? (
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => void remove(m.userId)}
                        >
                          {labels.remove}
                        </button>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{labels.pendingInvites}</h3>
      {invites.length === 0 ? <p className="muted">{labels.empty}</p> : null}
      <div className="table-wrap">
        <table>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.email}</td>
                <td>{roleLabel(inv.role)}</td>
                <td className="table-actions">
                  {inv.role === "member" || actorRole === "owner" ? (
                    <button type="button" className="btn-ghost" onClick={() => void revoke(inv.id)}>
                      {labels.revoke}
                    </button>
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

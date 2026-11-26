"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { absTime } from "@/components/crm/format";
import { formatPhoneDisplay } from "@/lib/leads";
import type { UiLang } from "@/lib/ui";

export type RecipientRow = {
  id: string;
  name: string;
  phone: string;
  status: string;
  skipReason: string;
  error: string;
  sentAt: string | null;
  leadId: string | null;
};

const STATUSES = ["sent", "queued", "sending", "failed", "skipped", "unknown"] as const;
type SortKey = "name" | "phone" | "status" | "sentAt";
type SortDir = "asc" | "desc";

type Saved = { query: string; statuses: string[] };

function storageKey(campaignId: string) {
  return `zapidly.campaignRecipients.${campaignId}`;
}

function readSaved(campaignId: string): Saved {
  try {
    const raw = localStorage.getItem(storageKey(campaignId));
    if (!raw) return { query: "", statuses: [] };
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses.filter((s) => typeof s === "string") : [],
    };
  } catch {
    return { query: "", statuses: [] };
  }
}

function phoneText(phone: string) {
  return phone.startsWith("none:") ? "" : formatPhoneDisplay(phone);
}

/** Recipient table with a name search and status filter kept in this browser. */
export function CampaignRecipients({
  campaignId,
  rows,
  lang,
  labels,
  statusLabels,
  skipLabels,
  empty,
  noMatches,
}: {
  campaignId: string;
  rows: RecipientRow[];
  lang: UiLang;
  labels: { name: string; status: string; all: string; cols: { n: string; name: string; phone: string; status: string; when: string } };
  statusLabels: Record<string, string>;
  skipLabels: Record<string, string>;
  empty: string;
  noMatches: string;
}) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = readSaved(campaignId);
    setQuery(saved.query);
    setStatuses(saved.statuses);
    setReady(true);
  }, [campaignId]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(storageKey(campaignId), JSON.stringify({ query, statuses }));
  }, [campaignId, query, statuses, ready]);

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (statuses.length && !statuses.includes(row.status)) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q);
    });
    if (!sort) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (row: RecipientRow) => {
      if (sort.key === "name") return row.name;
      if (sort.key === "phone") return phoneText(row.phone);
      if (sort.key === "status") return statusLabels[row.status] ?? row.status;
      return row.sentAt ?? "";
    };
    return [...filtered].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return av.localeCompare(bv, lang) * dir;
    });
  }, [rows, query, statuses, sort, statusLabels, lang]);

  function toggle(status: string) {
    setStatuses((current) => (current.includes(status) ? current.filter((s) => s !== status) : [...current, status]));
  }

  function cycle(key: SortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  const picked = statuses.map((status) => statusLabels[status] ?? status).join(", ");

  return (
    <div className="campaign-recipients">
      <div className="campaign-filters">
        <label>
          {labels.name}
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="campaign-status-filter" ref={menuRef}>
          <span id="campaign-status-label">{labels.status}</span>
          <button
            type="button"
            className="btn-secondary"
            aria-haspopup="listbox"
            aria-expanded={menu}
            aria-labelledby="campaign-status-label"
            onClick={() => setMenu((open) => !open)}
          >
            {picked || labels.all}
          </button>
          {menu ? (
            <div className="campaign-status-menu" role="listbox" aria-multiselectable="true" aria-labelledby="campaign-status-label">
              {STATUSES.map((status) => (
                <label key={status}>
                  <input type="checkbox" checked={statuses.includes(status)} onChange={() => toggle(status)} />
                  {statusLabels[status] ?? status}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : shown.length === 0 ? (
        <p className="muted">{noMatches}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{labels.cols.n}</th>
                {(["name", "phone", "status", "sentAt"] as const).map((key) => (
                  <th key={key} aria-sort={sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="campaign-sort" onClick={() => cycle(key)}>
                      {labels.cols[key === "sentAt" ? "when" : key]}
                      {sort?.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((s, index) => (
                <tr key={s.id}>
                  <td className="muted">{index + 1}</td>
                  <td>{s.leadId ? <Link href={`/leads/${encodeURIComponent(s.leadId)}`}>{s.name || "-"}</Link> : s.name || "-"}</td>
                  <td dir="ltr" className="muted">
                    {phoneText(s.phone) || "-"}
                  </td>
                  <td>
                    {statusLabels[s.status] ?? s.status}
                    {s.skipReason ? ` · ${skipLabels[s.skipReason] ?? s.skipReason}` : ""}
                    {s.status === "failed" && s.error ? <span className="muted"> · {s.error.slice(0, 80)}</span> : null}
                  </td>
                  <td className="muted">{s.sentAt ? absTime(s.sentAt, lang) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

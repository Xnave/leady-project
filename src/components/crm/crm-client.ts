import type { LeadViewDTO } from "@/lib/crm/view";

/** Fetch helpers for the CRM API routes. Every call throws on a non-2xx response. */
async function send<T = { ok: boolean }>(url: string, method: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
  });
  if (!res.ok) throw new Error(`${method} ${url} ${res.status}`);
  return res.json() as Promise<T>;
}

export type SnoozeDays = 1 | 3 | 7;
export type BulkBody = {
  ids: string[];
  op: "stage" | "snooze" | "read";
  stage?: string;
  reason?: string;
  days?: SnoozeDays;
};

export const crmApi = {
  setStage: (id: string, stage: string, reason = "") => send(`/api/leads/${id}/stage`, "PATCH", { stage, reason }),
  setNextStep: (id: string, body: { text: string | null; at: string } | { done: true }) =>
    send(`/api/leads/${id}/next-step`, "PUT", body),
  /** `keepalive` so a snooze committed while the page unloads still reaches the server. */
  snooze: (id: string, days: SnoozeDays) => send(`/api/leads/${id}/snooze`, "POST", { days }, true),
  addNote: (id: string, body: string) => send(`/api/leads/${id}/notes`, "POST", { body }),
  pinNote: (id: string, noteId: string, pinned: boolean) =>
    send(`/api/leads/${id}/notes/${noteId}`, "PATCH", { pinned }),
  bulk: (body: BulkBody) => send<{ ok: boolean; done: number }>(`/api/leads/bulk`, "PATCH", body, body.op === "snooze"),
  /** The read route is a POST that takes `{ unread }`. */
  markRead: (id: string) => send(`/api/leads/${id}/read`, "POST", { unread: false }),
  view: (id: string) => send<LeadViewDTO>(`/api/leads/${id}/view`, "GET"),
};

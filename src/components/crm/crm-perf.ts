/** Fire-and-forget CRM client timings → `/api/perf/crm` → Vercel Runtime Logs. */
export type CrmClientFields = {
  ms: number;
  leadId?: string;
  scope?: "lite" | "full";
  path?: string;
  extra?: Record<string, number | string | boolean>;
};

const ALLOWED = new Set([
  "crm.client.peek_shell",
  "crm.client.peek_open",
  "crm.client.peek_paint",
  "crm.client.peek_full",
  "crm.client.nav",
  "crm.client.mark_read",
]);

export function markCrmClient(msg: string, fields: CrmClientFields): void {
  if (!ALLOWED.has(msg)) return;
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    msg,
    ms: Math.round(fields.ms),
    ...(fields.leadId ? { leadId: fields.leadId } : {}),
    ...(fields.scope ? { scope: fields.scope } : {}),
    ...(fields.path ? { path: fields.path } : {}),
    ...(fields.extra ? { extra: fields.extra } : {}),
  });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon("/api/perf/crm", new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
    void fetch("/api/perf/crm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never block the CRM UI on telemetry.
  }
}

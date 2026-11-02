"use client";

import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";

export function DocumentChecklist({
  checklist,
  ui,
}: {
  checklist: LeadViewDTO["documents"];
  ui: UiCopy;
}) {
  if (!checklist || checklist.slots.length === 0) return null;
  const copy = ui.documentsUi;
  return (
    <section className="crm-sec" aria-label={copy.title}>
      <div className="crm-sec-h">{copy.title}</div>
      <ul className="crm-doc-list">
        {checklist.slots.map((slot) => {
          const status = slot.status === "uploaded" ? copy.uploaded : copy.missing;
          const reason = slot.lastReason ? copy.reasons[slot.lastReason] ?? slot.lastReason : "";
          return (
            <li key={slot.id}>
              <bdi>{slot.label}</bdi>
              <span className="muted"> · {status}</span>
              {reason ? (
                <span className="muted">
                  {" "}
                  · {copy.reason}: {reason}
                </span>
              ) : null}
              {slot.remoteId ? <span className="muted"> · {copy.remote} {slot.remoteId}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

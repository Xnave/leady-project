import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";

function statusLabel(ui: UiCopy, status: string): string {
  if (status === "pending") return ui.common.pending;
  if (status === "approved") return ui.reservation.approved;
  if (status === "rejected" || status === "declined") return ui.reservation.rejected;
  return status;
}

/** The Details tab (and the full page's side column): captured fields, then the lead's requests. */
export function LeadDetails({ dto, ui }: { dto: LeadViewDTO; ui: UiCopy }) {
  return (
    <>
      <section className="crm-sec crm-sec-flush" aria-label={ui.crm.tabsLead.details}>
        <div className="crm-sec-h">{ui.crm.tabsLead.details}</div>
        {dto.details.length ? (
          <dl className="crm-dl">
            {dto.details.map((f) => (
              <div key={f.label} className="crm-dl-row">
                <dt>{f.label}</dt>
                <dd>
                  <bdi>{f.value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="crm-muted">{ui.common.empty}</p>
        )}
      </section>
      {dto.requests.length ? (
        <section className="crm-sec" aria-label={ui.crm.timelineFilters.requests}>
          <div className="crm-sec-h">{ui.crm.timelineFilters.requests}</div>
          <ul className="crm-reqs">
            {dto.requests.map((r) => (
              <li key={r.id} className="crm-req">
                <b>
                  <bdi>{r.headline}</bdi>
                </b>
                <span className="crm-muted">{statusLabel(ui, r.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

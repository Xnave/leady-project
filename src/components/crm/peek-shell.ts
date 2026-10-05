import type { LeadRowDTO, LeadViewDTO } from "@/lib/crm/view";

/**
 * Instant peek chrome from the list row — header / stand / follow-up paint before
 * `GET /view?scope=lite` returns. Chat/notes/task stay empty until the fetch lands.
 */
export function shellFromRow(row: LeadRowDTO): LeadViewDTO {
  return {
    ...row,
    phone: "",
    email: "",
    waUrl: "",
    igUrl: "",
    stageReason: "",
    stageChangedAt: row.lastAt,
    notes: [],
    timeline: [],
    conversationId: null,
    conversationStatus: null,
    messages: [],
    details: [],
    requests: [],
    openTask: null,
  };
}

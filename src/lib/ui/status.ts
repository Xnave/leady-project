import type { LeadStatusId } from "./types";

export const LEAD_STATUSES: LeadStatusId[] = ["new", "open", "in_progress", "won", "lost"];

export function normalizeLeadStatus(raw: string | undefined | null): LeadStatusId {
  if (raw === "closed") return "lost";
  if (raw === "new" || raw === "open" || raw === "in_progress" || raw === "won" || raw === "lost") {
    return raw;
  }
  return "open";
}

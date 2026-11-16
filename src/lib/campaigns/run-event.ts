/** One campaign run per 5-minute tick slot. Confirm, resume, and the tick share this id. */
export const CAMPAIGN_RUN_EVENT = "campaigns/run.requested";
export const CAMPAIGN_TICK_MS = 5 * 60 * 1000;

export function campaignRunSlot(now: Date): number {
  return Math.floor(now.getTime() / CAMPAIGN_TICK_MS);
}

export function campaignRunEvent(tenantId: string, campaignId: string, now: Date) {
  return {
    id: `campaign-run-${campaignId}-${campaignRunSlot(now)}`,
    name: CAMPAIGN_RUN_EVENT,
    data: { tenantId, campaignId },
  };
}

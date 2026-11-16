import { describe, expect, it } from "vitest";
import { CAMPAIGN_RUN_EVENT, CAMPAIGN_TICK_MS, campaignRunEvent } from "./run-event";

describe("campaignRunEvent", () => {
  const at = new Date("2026-11-05T09:00:30.000Z");
  const slotStart = new Date(Math.floor(at.getTime() / CAMPAIGN_TICK_MS) * CAMPAIGN_TICK_MS);

  it("uses one id per campaign per 5-minute slot", () => {
    const first = campaignRunEvent("t1", "c1", slotStart);
    const laterInSlot = campaignRunEvent("t1", "c1", new Date(slotStart.getTime() + CAMPAIGN_TICK_MS - 1));
    const nextSlot = campaignRunEvent("t1", "c1", new Date(slotStart.getTime() + CAMPAIGN_TICK_MS));
    expect(first.id).toBe(laterInSlot.id);
    expect(first.id).not.toBe(nextSlot.id);
    expect(first).toMatchObject({
      name: CAMPAIGN_RUN_EVENT,
      data: { tenantId: "t1", campaignId: "c1" },
    });
  });

  it("does not share an id across campaigns", () => {
    expect(campaignRunEvent("t1", "c1", at).id).not.toBe(campaignRunEvent("t1", "c2", at).id);
  });
});

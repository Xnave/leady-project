import { describe, expect, it } from "vitest";
import {
  allowList,
  audienceSchema,
  followsSource,
  startedAtRange,
  estimateCostUsd,
  CHUNK_SIZE,
  averageRowMs,
  inSendWindow,
  summarizeRunTiming,
  nextStatus,
  resolveParams,
  runStepCeiling,
  sendBudget,
  skipReasonFor,
  startOfZonedDay,
  type RecipientState,
} from "./rules";

const TZ = "Asia/Jerusalem";
// November: Israel is UTC+2.
const il = (iso: string) => new Date(`${iso}+02:00`);

describe("inSendWindow", () => {
  it("sends on weekdays 09:00-20:00 local", () => {
    expect(inSendWindow(il("2026-11-05T08:59:00"), TZ)).toBe(false); // Thursday
    expect(inSendWindow(il("2026-11-05T09:00:00"), TZ)).toBe(true);
    expect(inSendWindow(il("2026-11-05T19:59:00"), TZ)).toBe(true);
    expect(inSendWindow(il("2026-11-05T20:00:00"), TZ)).toBe(false);
    expect(inSendWindow(il("2026-11-08T10:00:00"), TZ)).toBe(true); // Sunday
  });

  it("stops at 14:00 on Friday and never sends on Saturday", () => {
    expect(inSendWindow(il("2026-11-06T13:59:00"), TZ)).toBe(true);
    expect(inSendWindow(il("2026-11-06T14:00:00"), TZ)).toBe(false);
    expect(inSendWindow(il("2026-11-07T12:00:00"), TZ)).toBe(false);
  });

  it("honors each day's range and falls back to the Israeli default", () => {
    const custom = {
      days: [
        { weekday: 4, startMinute: 10 * 60, endMinute: 18 * 60 },
        { weekday: 5, startMinute: 9 * 60, endMinute: 12 * 60 },
        { weekday: 6, startMinute: 9 * 60, endMinute: 18 * 60 },
      ],
    };
    expect(inSendWindow(il("2026-11-07T12:00:00"), TZ, custom)).toBe(true);
    expect(inSendWindow(il("2026-11-05T09:30:00"), TZ, custom)).toBe(false);
    expect(inSendWindow(il("2026-11-05T10:00:00"), TZ, custom)).toBe(true);
    expect(inSendWindow(il("2026-11-06T11:30:00"), TZ, custom)).toBe(true);
    expect(inSendWindow(il("2026-11-06T12:00:00"), TZ, custom)).toBe(false);
    expect(inSendWindow(il("2026-11-05T09:00:00"), TZ)).toBe(true);
    expect(inSendWindow(il("2026-11-05T19:30:00"), TZ)).toBe(true);
  });
});

describe("startOfZonedDay", () => {
  it("is local midnight as a UTC instant", () => {
    expect(startOfZonedDay(il("2026-11-05T01:30:00"), TZ).toISOString()).toBe("2026-11-04T22:00:00.000Z");
    expect(startOfZonedDay(il("2026-11-05T23:30:00"), TZ).toISOString()).toBe("2026-11-04T22:00:00.000Z");
    // Summer time (UTC+3)
    expect(startOfZonedDay(new Date("2026-07-01T12:00:00Z"), TZ).toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });
});

const now = new Date("2026-11-05T10:00:00Z");
const day = 24 * 3600 * 1000;
const ok: RecipientState = {
  phone: "972501234567",
  phoneStatus: "ok",
  suppressed: false,
  allowListed: null,
  lastCampaignSentAt: null,
  lastConversationAt: null,
  conversationOpen: false,
  activeCase: false,
  leadStage: null,
  archived: false,
};

describe("skipReasonFor", () => {
  it("lets a clean recipient through", () => {
    expect(skipReasonFor(ok, now)).toBeNull();
  });

  it("skips each rule", () => {
    expect(skipReasonFor({ ...ok, phone: "", phoneStatus: "missing" }, now)).toBe("no_phone");
    expect(skipReasonFor({ ...ok, phoneStatus: "invalid" }, now)).toBe("invalid_phone");
    expect(skipReasonFor({ ...ok, suppressed: true }, now)).toBe("suppressed");
    expect(skipReasonFor({ ...ok, allowListed: false }, now)).toBe("not_allowlisted");
    expect(skipReasonFor({ ...ok, lastCampaignSentAt: new Date(now.getTime() - 6 * day) }, now)).toBe("frequency_cap");
    expect(skipReasonFor({ ...ok, conversationOpen: true, lastConversationAt: new Date(now.getTime() - day) }, now)).toBe("open_conversation");
    expect(skipReasonFor({ ...ok, activeCase: true }, now)).toBe("active_case");
    expect(skipReasonFor({ ...ok, leadStage: "lost" }, now)).toBe("lost_lead");
    expect(skipReasonFor({ ...ok, leadStage: "not_relevant" }, now)).toBe("lost_lead");
    expect(skipReasonFor({ ...ok, archived: true }, now)).toBe("archived_client");
  });

  it("frees a recipient after the cap and after a conversation goes quiet", () => {
    expect(skipReasonFor({ ...ok, lastCampaignSentAt: new Date(now.getTime() - 8 * day) }, now)).toBeNull();
    expect(skipReasonFor({ ...ok, conversationOpen: true, lastConversationAt: new Date(now.getTime() - 5 * day) }, now)).toBeNull();
  });

  it("suppression wins over everything after the phone", () => {
    expect(skipReasonFor({ ...ok, suppressed: true, allowListed: false, archived: true }, now)).toBe("suppressed");
  });
});

describe("allowList", () => {
  it("always applies outside production", () => {
    expect(allowList({ production: false, list: "+972 50-123-4567, 972521111111", only: "" })).toEqual(
      new Set(["972501234567", "972521111111"]),
    );
    expect(allowList({ production: false, list: "", only: "" })).toEqual(new Set());
  });

  it("applies in production only while the test-send switch is on", () => {
    expect(allowList({ production: true, list: "972501234567", only: "" })).toBeNull();
    expect(allowList({ production: true, list: "972501234567", only: "1" })).toEqual(new Set(["972501234567"]));
  });
});

describe("sendBudget", () => {
  it("takes the smallest of daily ceiling, batch and run cap", () => {
    expect(sendBudget({ dailyCeiling: 200, sentToday: 150, batchSize: null, sentInBatch: 0 })).toEqual({ budget: 50, limitedBy: null });
    expect(sendBudget({ dailyCeiling: 200, sentToday: 0, batchSize: 25, sentInBatch: 20 })).toEqual({ budget: 5, limitedBy: null });
    expect(sendBudget({ dailyCeiling: 200, sentToday: 200, batchSize: 25, sentInBatch: 0 }).limitedBy).toBe("daily_ceiling");
    expect(sendBudget({ dailyCeiling: 200, sentToday: 0, batchSize: 25, sentInBatch: 25 }).limitedBy).toBe("batch");
    expect(sendBudget({ dailyCeiling: 200, sentToday: 0, batchSize: null, sentInBatch: 0, maxSendsPerRun: 40 })).toEqual({ budget: 40, limitedBy: null });
    expect(sendBudget({ dailyCeiling: 1000, sentToday: 0, batchSize: null, sentInBatch: 0, maxSendsPerRun: 40 }).budget).toBe(40);
  });

  it("sizes the step loop from the budget and the chunk", () => {
    expect(runStepCeiling(300)).toBe(Math.ceil(300 / CHUNK_SIZE));
    expect(runStepCeiling(1, CHUNK_SIZE)).toBe(1);
    expect(runStepCeiling(0, CHUNK_SIZE)).toBe(0);
  });

  it("splits the run, the send, and the average work per recipient", () => {
    const timing = summarizeRunTiming(2000, [
      { elapsedMs: 1000, processMs: 400, rows: 2 },
      { elapsedMs: 500, processMs: 100, rows: 2 },
    ]);
    expect(timing).toEqual({ lastRunMs: 2000, lastSendMs: 1500, lastProcessMs: 500, lastRowCount: 4 });
    expect(averageRowMs(timing.lastProcessMs, timing.lastRowCount)).toBe(125);
    expect(averageRowMs(0, 0)).toBeNull();
  });
});

describe("resolveParams", () => {
  it("fills names, business and fixed text", () => {
    expect(
      resolveParams(
        [
          { source: "first_name", value: "", fallback: "" },
          { source: "business_name", value: "", fallback: "" },
          { source: "text", value: "משכנתא", fallback: "" },
          { source: "full_name", value: "", fallback: "" },
        ],
        { name: "דנה  לוי", businessName: "ליאור משכנתאות" },
      ),
    ).toEqual(["דנה", "ליאור משכנתאות", "משכנתא", "דנה  לוי"]);
  });

  it("uses the fallback, and refuses an empty value", () => {
    expect(resolveParams([{ source: "first_name", value: "", fallback: "לקוח יקר" }], { name: "", businessName: "x" })).toEqual(["לקוח יקר"]);
    expect(resolveParams([{ source: "first_name", value: "", fallback: "" }], { name: " ", businessName: "x" })).toBeNull();
  });
});

describe("audience", () => {
  it("turns years ago into a deal-date range", () => {
    const a = audienceSchema.parse({ kind: "clients", dealYearsAgoMin: 4.5, dealYearsAgoMax: 10 });
    if (a.kind !== "clients") throw new Error("kind");
    expect(a).toMatchObject({ startedYearsAgoMin: 4.5, startedYearsAgoMax: 10, sourceId: null });
    expect(followsSource(a)).toBe(false);
    const following = audienceSchema.parse({ kind: "clients", sourceId: "src-1" });
    const everySource = audienceSchema.parse({ kind: "clients", sourceId: "all" });
    expect(followsSource(following)).toBe(true);
    expect(followsSource(everySource)).toBe(true);
    const r = startedAtRange(a, new Date("2026-11-05T00:00:00Z"));
    expect(r.lte?.toISOString().slice(0, 7)).toBe("2022-05");
    expect(r.gte?.toISOString().slice(0, 7)).toBe("2016-11");
  });

  it("rejects an empty lead list and unknown kinds", () => {
    expect(audienceSchema.safeParse({ kind: "leads", leadIds: [] }).success).toBe(false);
    expect(audienceSchema.safeParse({ kind: "everyone" }).success).toBe(false);
  });
});

describe("nextStatus", () => {
  it("allows only sensible transitions", () => {
    expect(nextStatus("sending", "pause")).toBe("paused");
    expect(nextStatus("paused", "resume")).toBe("scheduled");
    expect(nextStatus("draft", "resume")).toBeNull();
    expect(nextStatus("done", "cancel")).toBeNull();
    expect(nextStatus("paused", "cancel")).toBe("canceled");
  });
});

describe("estimateCostUsd", () => {
  it("prices by category", () => {
    expect(estimateCostUsd(1000, "MARKETING")).toBe(41);
    expect(estimateCostUsd(0, "UTILITY")).toBe(0);
  });
});

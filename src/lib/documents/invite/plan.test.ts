import { describe, expect, it } from "vitest";
import {
  INVITE_CLAIM_STALE_MS,
  INVITE_REMINDER_AFTER_MS,
  inSendWindow,
  inviteFirstName,
  isStopReply,
  planInviteStep,
  whatsappExternalIdVariants,
} from "./plan";

/** Israel is UTC+2 in winter (Nov), UTC+3 in summer (Jun). */
const at = (iso: string) => new Date(iso);

describe("inSendWindow (Asia/Jerusalem)", () => {
  it("opens Sunday at 09:00, not 08:59", () => {
    expect(inSendWindow(at("2026-11-15T07:00:00Z"))).toBe(true);
    expect(inSendWindow(at("2026-11-15T06:59:00Z"))).toBe(false);
  });
  it("closes weekdays at 20:00", () => {
    expect(inSendWindow(at("2026-11-19T17:59:00Z"))).toBe(true);
    expect(inSendWindow(at("2026-11-19T18:00:00Z"))).toBe(false);
  });
  it("closes Friday at 13:00", () => {
    expect(inSendWindow(at("2026-11-13T10:59:00Z"))).toBe(true);
    expect(inSendWindow(at("2026-11-13T11:00:00Z"))).toBe(false);
  });
  it("never sends on Saturday", () => {
    for (let h = 0; h < 24; h++) {
      expect(inSendWindow(new Date(Date.UTC(2026, 10, 14, h, 30)))).toBe(false);
    }
  });
  it("follows summer time", () => {
    expect(inSendWindow(at("2026-06-14T06:00:00Z"))).toBe(true);
    expect(inSendWindow(at("2026-06-14T05:59:00Z"))).toBe(false);
  });
});

describe("planInviteStep", () => {
  const now = at("2026-11-15T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  type Row = { status: string; claimedAt: Date | null; openerAt: Date | null; reminderAt: Date | null };
  const row = (o: Partial<Row>): Row => ({ status: "", claimedAt: null, openerAt: null, reminderAt: null, ...o });
  it("opens a contact with no invite row", () => {
    expect(planInviteStep(null, now)).toBe("opener");
  });
  it("reminds 48h after the opener, not before", () => {
    expect(planInviteStep(row({ status: "invited", openerAt: ago(INVITE_REMINDER_AFTER_MS) }), now)).toBe("reminder");
    expect(planInviteStep(row({ status: "invited", openerAt: ago(47 * 3600_000) }), now)).toBeNull();
  });
  it("escalates 48h after the reminder", () => {
    expect(planInviteStep(row({ status: "reminded", reminderAt: ago(INVITE_REMINDER_AFTER_MS) }), now)).toBe("escalate");
    expect(planInviteStep(row({ status: "reminded", reminderAt: ago(3600_000) }), now)).toBeNull();
  });
  it("turns a stale claim into unknown and never resends it", () => {
    expect(planInviteStep(row({ status: "sending_opener", claimedAt: ago(INVITE_CLAIM_STALE_MS) }), now)).toBe("unknown");
    expect(planInviteStep(row({ status: "sending_reminder", claimedAt: ago(INVITE_CLAIM_STALE_MS) }), now)).toBe("unknown");
    expect(planInviteStep(row({ status: "sending_opener", claimedAt: ago(60_000) }), now)).toBeNull();
  });
  it("does nothing once started, stopped, escalated or unknown", () => {
    for (const status of ["started", "stopped", "escalated", "unknown"]) {
      expect(planInviteStep(row({ status, openerAt: ago(10 * INVITE_REMINDER_AFTER_MS) }), now)).toBeNull();
    }
  });
});

describe("isStopReply", () => {
  it("matches a bare stop word", () => {
    expect(isStopReply("הסר")).toBe(true);
    expect(isStopReply("  STOP! ")).toBe(true);
    expect(isStopReply("תפסיקו.")).toBe(true);
  });
  it("ignores the button and longer sentences", () => {
    expect(isStopReply("בואו נתחיל")).toBe(false);
    expect(isStopReply("אני רוצה להסיר את השעבוד")).toBe(false);
    expect(isStopReply("")).toBe(false);
  });
});

describe("inviteFirstName", () => {
  it("prefers borrower 1 from the checklist", () => {
    expect(inviteFirstName({ name: "כהן דנה", mapped: { checklist: { borrowers: [{ slot: "1", fullName: "דנה כהן" }] } } })).toBe("דנה");
  });
  it("falls back to the contact name", () => {
    expect(inviteFirstName({ name: " רון  לוי ", mapped: {} })).toBe("רון");
    expect(inviteFirstName({ name: "", mapped: null })).toBe("");
  });
});


describe("whatsappExternalIdVariants", () => {
  it("covers the + and bare digit forms of a phone", () => {
    expect(whatsappExternalIdVariants("+972501234567")).toEqual(["+972501234567", "972501234567"]);
    expect(whatsappExternalIdVariants("972501234567")).toEqual(["972501234567", "+972501234567"]);
  });
  it("leaves non-phone ids alone", () => {
    expect(whatsappExternalIdVariants("seed-docs-972521234567")).toEqual(["seed-docs-972521234567"]);
    expect(whatsappExternalIdVariants("")).toEqual([]);
  });
});

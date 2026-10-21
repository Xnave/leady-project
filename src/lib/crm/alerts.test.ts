import { describe, expect, it } from "vitest";
import {
  ALERT_TEMPLATES,
  alertDetail,
  alertKind,
  alertTemplateParams,
  alertTemplateText,
  inQuietHours,
  planAlert,
  quietHoursEnd,
  type AlertKind,
  type AlertSettings,
} from "./alerts";
import { DIGEST_SECTORS, DIGEST_TEMPLATES } from "./digest-templates";

const TZ = "Asia/Jerusalem";
const on: AlertSettings = {
  alertsEnabled: true,
  alertApprovals: true,
  alertHandoffs: true,
  quietHoursEnabled: true,
  quietStartHour: 22,
  quietEndHour: 8,
  quietMode: "hold",
};
// Jerusalem is UTC+3 in October.
const noon = new Date("2026-10-20T09:00:00Z");
const lateNight = new Date("2026-10-20T20:30:00Z"); // 23:30 local

describe("alertKind", () => {
  it("approval tasks are approvals, every other open task is a handoff", () => {
    expect(alertKind("request_approval")).toBe("approval");
    expect(alertKind("more_info")).toBe("handoff");
  });
});

describe("inQuietHours", () => {
  it("handles a window across midnight", () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);
    expect(inQuietHours(21, 22, 8)).toBe(false);
  });
  it("handles a same-day window", () => {
    expect(inQuietHours(14, 13, 16)).toBe(true);
    expect(inQuietHours(16, 13, 16)).toBe(false);
  });
  it("start == end means no off hours", () => {
    expect(inQuietHours(5, 5, 5)).toBe(false);
  });
});

describe("quietHoursEnd", () => {
  it("is the next local end hour, on the hour", () => {
    expect(quietHoursEnd(lateNight, TZ, 22, 8).toISOString()).toBe("2026-10-21T05:00:00.000Z");
  });
  it("works in a half-hour zone", () => {
    // 23:00 in Kolkata (UTC+5:30) -> 08:00 local next day = 02:30Z
    expect(quietHoursEnd(new Date("2026-10-20T17:30:00Z"), "Asia/Kolkata", 22, 8).toISOString()).toBe(
      "2026-10-21T02:30:00.000Z",
    );
  });
  it("crosses the DST change", () => {
    // Israel leaves DST on 2026-10-25 at 02:00; 08:00 local that morning is UTC+2.
    expect(quietHoursEnd(new Date("2026-10-24T21:00:00Z"), TZ, 22, 8).toISOString()).toBe("2026-10-25T06:00:00.000Z");
  });
  it("ends at the first hour after an end hour that spring-forward skips", () => {
    // Israel enters DST on 2027-03-26: 02:00 jumps to 03:00 (UTC+2 -> UTC+3).
    expect(quietHoursEnd(new Date("2027-03-25T21:00:00Z"), TZ, 22, 2).toISOString()).toBe("2027-03-26T00:00:00.000Z");
  });
});

describe("planAlert", () => {
  it("sends now during the day", () => {
    expect(planAlert(on, "approval", noon, TZ, true)).toEqual({ send: true, at: noon });
  });
  it("respects the master switch and per-kind switches", () => {
    expect(planAlert({ ...on, alertsEnabled: false }, "approval", noon, TZ, true)).toEqual({ send: false, reason: "disabled" });
    expect(planAlert({ ...on, alertApprovals: false }, "approval", noon, TZ, true)).toEqual({ send: false, reason: "kind_off" });
    expect(planAlert({ ...on, alertApprovals: false }, "handoff", noon, TZ, true).send).toBe(true);
    expect(planAlert({ ...on, alertHandoffs: false }, "handoff", noon, TZ, true)).toEqual({ send: false, reason: "kind_off" });
  });
  it("holds an off-hours alert until they end", () => {
    expect(planAlert(on, "handoff", lateNight, TZ, true)).toEqual({ send: true, at: new Date("2026-10-21T05:00:00Z") });
  });
  it("leaves an off-hours alert to the digest in digest mode", () => {
    expect(planAlert({ ...on, quietMode: "digest" }, "handoff", lateNight, TZ, true)).toEqual({ send: false, reason: "quiet_hours" });
  });
  it("holds instead in digest mode when the digest is off", () => {
    expect(planAlert({ ...on, quietMode: "digest" }, "handoff", lateNight, TZ, false)).toEqual({
      send: true,
      at: new Date("2026-10-21T05:00:00Z"),
    });
  });
  it("sends at night when off hours are disabled", () => {
    expect(planAlert({ ...on, quietHoursEnabled: false }, "handoff", lateNight, TZ, true)).toEqual({ send: true, at: lateNight });
  });
});

describe("alert template catalog (what Meta reviews)", () => {
  for (const kind of ["approval", "handoff"] as AlertKind[]) {
    const t = ALERT_TEMPLATES[kind];
    it(`${kind}: valid name, numbered variables, an example for each`, () => {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars).toEqual([1, 2, 3]);
      expect(t.example).toHaveLength(vars.length);
    });
    it(`${kind}: body neither starts nor ends with a variable, fits Meta's limits`, () => {
      expect(t.body.trim()).not.toMatch(/^\{\{\d+\}\}/);
      expect(t.body.trim()).not.toMatch(/\{\{\d+\}\}$/);
      expect(t.body.length).toBeLessThanOrEqual(1024);
      expect(t.footer.length).toBeLessThanOrEqual(60);
      expect(t.button.length).toBeLessThanOrEqual(25);
    });
  }
  it("names never collide with the digest templates", () => {
    const digest = new Set(DIGEST_SECTORS.map((s) => DIGEST_TEMPLATES[s].name));
    for (const t of Object.values(ALERT_TEMPLATES)) expect(digest.has(t.name)).toBe(false);
  });
});

describe("alert wording", () => {
  it("approval detail leads with the requested time", () => {
    const task = { reason: "request_approval", payload: { timeText: "12-14/11", summary: "2 guests" } };
    expect(alertDetail("approval", task, {})).toBe("12-14/11 · 2 guests");
  });
  it("handoff detail is the summary, else the reason label", () => {
    expect(alertDetail("handoff", { reason: "asked_for_person", payload: { summary: "Wants a group price" } }, {})).toBe(
      "Wants a group price",
    );
    expect(alertDetail("handoff", { reason: "asked_for_person", payload: {} }, { asked_for_person: "Asked for a person" })).toBe(
      "Asked for a person",
    );
  });
  it("params are sanitized for Meta (no newlines, never empty)", () => {
    expect(alertTemplateParams("Villa\nNofim", "", "a\tb")).toEqual(["Villa Nofim", "-", "a b"]);
  });
  it("free text swaps the call to action for a link to the lead", () => {
    const text = alertTemplateText("approval", ["Villa", "Dana", "12-14/11"], "https://app.example/", "lead1");
    expect(text).toContain("Villa");
    expect(text).toContain("https://app.example/leads/lead1");
    expect(text).not.toContain("היכנסו ל-Zapidly");
    expect(text.endsWith(ALERT_TEMPLATES.approval.footer)).toBe(true);
  });
});

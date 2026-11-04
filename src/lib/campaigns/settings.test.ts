import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_TERMS_VERSION,
  DEFAULT_CAMPAIGN_SETTINGS,
  parseAdminSettings,
  settingsFromRow,
  termsAccepted,
} from "./settings";

const now = new Date("2026-11-03T10:00:00Z");

describe("parseAdminSettings", () => {
  it("enables the add-on and keeps the prefix on by default", () => {
    expect(parseAdminSettings({ enabled: true }, DEFAULT_CAMPAIGN_SETTINGS, "admin@x", now)).toEqual({
      enabled: true,
      adPrefixEnabled: true,
      adPrefixOffNote: "",
      adPrefixOffBy: "",
      adPrefixOffAt: null,
      dailySendCeiling: 200,
    });
  });

  it("refuses to turn the prefix off without a legal note", () => {
    expect(parseAdminSettings({ adPrefixEnabled: false }, DEFAULT_CAMPAIGN_SETTINGS, "a", now)).toEqual({ error: "prefix_note_required" });
    expect(parseAdminSettings({ adPrefixEnabled: false, adPrefixOffNote: "ok" }, DEFAULT_CAMPAIGN_SETTINGS, "a", now)).toEqual({
      error: "prefix_note_required",
    });
  });

  it("records who turned it off, when and why", () => {
    const patch = parseAdminSettings(
      { adPrefixEnabled: false, adPrefixOffNote: "  Lawyer X approved utility-style wording, 3.11  " },
      DEFAULT_CAMPAIGN_SETTINGS,
      "admin@x",
      now,
    );
    expect(patch).toMatchObject({ adPrefixEnabled: false, adPrefixOffNote: "Lawyer X approved utility-style wording, 3.11", adPrefixOffBy: "admin@x", adPrefixOffAt: now });
  });

  it("keeps the original approval when other fields change while it is off", () => {
    const off = { ...DEFAULT_CAMPAIGN_SETTINGS, adPrefixEnabled: false, adPrefixOffNote: "Lawyer approved", adPrefixOffBy: "first@x", adPrefixOffAt: "2026-10-01T00:00:00.000Z" };
    const patch = parseAdminSettings({ dailySendCeiling: 500 }, off, "second@x", now);
    expect(patch).toMatchObject({ adPrefixOffBy: "first@x", adPrefixOffAt: new Date("2026-10-01T00:00:00.000Z"), dailySendCeiling: 500 });
  });

  it("clears the note when the prefix goes back on", () => {
    const off = { ...DEFAULT_CAMPAIGN_SETTINGS, adPrefixEnabled: false, adPrefixOffNote: "Lawyer approved", adPrefixOffBy: "a" };
    expect(parseAdminSettings({ adPrefixEnabled: true }, off, "b", now)).toMatchObject({ adPrefixOffNote: "", adPrefixOffBy: "", adPrefixOffAt: null });
  });

  it("validates the daily ceiling", () => {
    for (const bad of [0, -1, 1.5, "abc", 1_000_000]) {
      expect(parseAdminSettings({ dailySendCeiling: bad }, DEFAULT_CAMPAIGN_SETTINGS, "a", now)).toEqual({ error: "ceiling_invalid" });
    }
  });
});

describe("terms", () => {
  it("counts acceptance only for the current terms version", () => {
    expect(termsAccepted({ termsVersion: CAMPAIGN_TERMS_VERSION, termsAcceptedAt: now.toISOString() })).toBe(true);
    expect(termsAccepted({ termsVersion: "old", termsAcceptedAt: now.toISOString() })).toBe(false);
    expect(termsAccepted({ termsVersion: CAMPAIGN_TERMS_VERSION, termsAcceptedAt: null })).toBe(false);
  });

  it("falls back to defaults when no row exists", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_CAMPAIGN_SETTINGS);
  });
});

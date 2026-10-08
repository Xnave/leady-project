import { describe, expect, it } from "vitest";
import {
  gatheredInterest,
  interestFromTranscript,
  looksLikeNeedDeixis,
  looksLikeNothingToAdd,
  resolveNeedFromReply,
} from "./need-context";
import { askBookingField } from "./booking";
import { normalizeSlot } from "./slot";

describe("need-context", () => {
  it("reads CRM interest", () => {
    expect(gatheredInterest({})).toBe("");
    expect(gatheredInterest({ interest: "  hours gap  " })).toBe("hours gap");
  });

  it("mines first substantial lead message from transcript", () => {
    const opener =
      "היי Zapidly, סיימתי את מפת ההזדמנויות. עסק: קליניקה. המענה לא מכסה את כל שעות הפניות.";
    expect(
      interestFromTranscript([
        { role: "lead", text: opener },
        { role: "agent", text: "אשמח לעזור" },
        { role: "lead", text: "כן" },
        { role: "lead", text: "מחר ב7" },
      ]),
    ).toBe(opener);
    expect(interestFromTranscript([{ role: "lead", text: "כן" }])).toBe("");
  });

  it("detects deixis and soft nothing-to-add", () => {
    expect(looksLikeNeedDeixis("מה שכתבתי למעלה")).toBe(true);
    expect(looksLikeNeedDeixis("as above")).toBe(true);
    expect(looksLikeNeedDeixis("המענה לא מכסה את כל שעות הפניות")).toBe(false);
    expect(looksLikeNothingToAdd("לא")).toBe(true);
    expect(looksLikeNothingToAdd("אין לי מה להוסיף")).toBe(true);
    expect(looksLikeNothingToAdd("nothing else")).toBe(true);
    expect(looksLikeNothingToAdd("גם חשוב שיהיה בעברית")).toBe(false);
  });

  it("resolves need from reply against gathered interest", () => {
    const gathered = "קליניקה — מענה לא מכסה שעות פניות";
    expect(resolveNeedFromReply("מה שכתבתי למעלה", gathered)).toEqual({ need: gathered });
    expect(resolveNeedFromReply("לא", gathered)).toEqual({ need: gathered });
    expect(resolveNeedFromReply("גם בעברית", gathered)).toEqual({
      need: `${gathered}\nגם בעברית`,
    });
    expect(resolveNeedFromReply("מה שכתבתי למעלה", "")).toEqual({ reject: "deixis" });
    expect(resolveNeedFromReply("לא", "")).toEqual({ reject: "nothing_without_gathered" });
  });

  it("presents gathered interest when asking need", () => {
    const he = askBookingField("he", "need", {
      gatheredNeed: "המענה לא מכסה את כל שעות הפניות",
    });
    expect(he).toMatch(/ככה הבנתי עד עכשיו|מה שכבר הבנתי/);
    expect(he).toMatch(/המענה לא מכסה/);
    expect(he).toMatch(/יש משהו נוסף/);
    expect(askBookingField("he", "need")).toMatch(/אשמח להכין את הפגישה/);
  });
});

describe("normalizeSlot display for booking confirm", () => {
  it("turns relative Hebrew time into calendar date + clock", () => {
    const out = normalizeSlot("מחר ב-17:00", {
      now: new Date("2026-10-07T12:00:00"),
      lang: "he",
    });
    expect(out.timeLabel).toBe("17:00");
    expect(out.dateIso).toBe("2026-10-08");
    expect(out.display).toMatch(/17:00/);
    expect(out.display).not.toMatch(/^מחר/);
  });
});

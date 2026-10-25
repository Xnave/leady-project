import { describe, expect, it } from "vitest";
import {
  gatheredInterest,
  interestCopiesLeadMessage,
  looksLikeNeedDeixis,
  looksLikeNothingToAdd,
  resolveNeedFromReply,
  storedUnderstanding,
} from "./need-context";
import { askBookingField } from "./booking";
import {
  clockGroundedInLeadText,
  formatSlotForDisplay,
  formatSlotPhrase,
  messageStatesClock,
  normalizeSlot,
} from "./slot";

describe("need-context", () => {
  it("reads CRM interest", () => {
    expect(gatheredInterest({})).toBe("");
    expect(gatheredInterest({ interest: "  hours gap  " })).toBe("hours gap");
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
    const gathered = "קליניקה - מענה לא מכסה שעות פניות";
    expect(resolveNeedFromReply("מה שכתבתי למעלה", gathered)).toEqual({ need: gathered });
    expect(resolveNeedFromReply("לא", gathered)).toEqual({ need: gathered });
    expect(resolveNeedFromReply("גם בעברית", gathered)).toEqual({
      need: `${gathered}\nגם בעברית`,
    });
    expect(resolveNeedFromReply("מה שכתבתי למעלה", "")).toEqual({ reject: "deixis" });
    expect(resolveNeedFromReply("לא", "")).toEqual({ reject: "nothing_without_gathered" });
    expect(resolveNeedFromReply("כן", gathered)).toEqual({ need: gathered });
    expect(resolveNeedFromReply("yes", gathered)).toEqual({ need: gathered });
    expect(resolveNeedFromReply("כן", "")).toEqual({ reject: "nothing_without_gathered" });
  });

  it("ignores an exact paste and keeps a saved understanding", () => {
    const opener = "היי Zapidly, אשמח לקבל דמו ולראות איך הסוכן יכול להתאים לעסק שלי";
    const messages = [{ role: "lead" as const, text: opener }];
    const understood = "רוצה דמו כדי לראות איך הסוכן מתאים לעסק";
    expect(interestCopiesLeadMessage(opener, messages)).toBe(true);
    expect(interestCopiesLeadMessage("אשמח לקבל דמו ולראות איך הסוכן יכול להתאים לעסק שלי", messages)).toBe(
      false,
    );
    expect(interestCopiesLeadMessage(understood, messages)).toBe(false);
    expect(storedUnderstanding({ interest: opener }, messages)).toBe("");
    expect(storedUnderstanding({ interest: understood }, messages)).toBe(understood);
  });

  it("accepts a clock the customer named earlier in the thread", () => {
    expect(messageStatesClock("מחר")).toBe(false);
    expect(messageStatesClock("מחר ב-17:00")).toBe(true);
    expect(clockGroundedInLeadText("23 באוקטובר בשעה 10:00", ["מחר"])).toBe(false);
    expect(clockGroundedInLeadText("23 באוקטובר בשעה 17:00", ["מחר ב-17:00"])).toBe(true);
    expect(clockGroundedInLeadText("23 באוקטובר בשעה 17:00", ["ב-17:00", "מחר"])).toBe(true);
  });

  it("presents gathered interest when asking need", () => {
    const he = askBookingField("he", "need", {
      gatheredNeed: "המענה לא מכסה את כל שעות הפניות",
    });
    expect(he).toMatch(/פרטי הפגישה/);
    expect(he).toMatch(/המענה לא מכסה/);
    expect(he).toMatch(/לאשר או שתרצה להוסיף/);
    expect(askBookingField("he", "need")).toMatch(/מה חשוב לך שנדע מראש/);
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

  it("formats bare hour like מחר ב12 as calendar date + 12:00", () => {
    const out = formatSlotForDisplay("מחר ב12", {
      now: new Date("2026-10-08T12:00:00"),
      lang: "he",
    });
    expect(out).toBe("9 באוקטובר בשעה 12:00");
    expect(out).not.toMatch(/מחר|2026/);
  });

  it("confirm phrase includes weekday", () => {
    const out = formatSlotPhrase("מחר ב12", {
      now: new Date("2026-10-08T12:00:00"),
      lang: "he",
    });
    expect(out).toBe("יום שישי בשעה 12:00 בתאריך 9 באוקטובר");
  });
});

import { describe, expect, it } from "vitest";
import {
  gatheredInterest,
  looksLikeNeedDeixis,
  looksLikeNothingToAdd,
  resolveNeedFromReply,
} from "./need-context";
import { askBookingField } from "./booking";

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
    expect(he).toMatch(/מה שכבר הבנתי מהשיחה/);
    expect(he).toMatch(/המענה לא מכסה/);
    expect(he).toMatch(/יש משהו נוסף/);
    expect(askBookingField("he", "need")).toMatch(/ספר לי בקצרה/);
  });
});

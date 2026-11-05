import { describe, expect, it } from "vitest";
import { chat as en } from "@/lib/copy/en";
import { chat as he } from "@/lib/copy/he";
import { uiCopy } from "@/lib/ui";
import { MORTGAGE_RULES } from "./mortgage-rules";
import { requiredSlots } from "./rules";
import { commitSlot, freshDossier, judgeFile, priorCalendarMonths, recordMonths, runChecks } from "./validate";

const NOW = new Date("2026-11-02T00:00:00.000Z");
const profile = {
  employment: "employed",
  hasLoans: true,
  nationalId: "123456782",
  fullName: "Dana Levi",
};

function dossier() {
  return freshDossier({
    smartClientId: "c1",
    profile,
    slots: requiredSlots(profile, MORTGAGE_RULES),
  });
}

describe("document checks", () => {
  it("accepts a national id that matches the profile", () => {
    const failure = runChecks(
      MORTGAGE_RULES.documents.id_card.checks,
      { nationalId: "123456782", fullName: "Dana Levi" },
      profile,
      NOW,
    );
    expect(failure).toBeNull();
  });

  it("rejects a national id that belongs to someone else", () => {
    const failure = runChecks(
      MORTGAGE_RULES.documents.id_card.checks,
      { nationalId: "999999999", fullName: "Dana Levi" },
      profile,
      NOW,
    );
    expect(failure?.op).toBe("matches_profile");
  });

  it("rejects a statement outside the three prior calendar months", () => {
    expect(priorCalendarMonths(NOW)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const old = runChecks(
      MORTGAGE_RULES.documents.bank_statement.checks,
      { months: "2026-01" },
      profile,
      NOW,
    );
    expect(old?.op).toBe("prior_calendar_months");
    const current = runChecks(
      MORTGAGE_RULES.documents.bank_statement.checks,
      { months: "2026-11" },
      profile,
      NOW,
    );
    expect(current?.op).toBe("prior_calendar_months");
    const partial = runChecks(
      MORTGAGE_RULES.documents.bank_statement.checks,
      { months: "2026-08, 2026-09" },
      profile,
      NOW,
    );
    expect(partial).toBeNull();
  });

  it("keeps a statement open until one file or several cover the three months", () => {
    const months = ["2026-08", "2026-09", "2026-10"];
    let state = freshDossier({
      smartClientId: "c1",
      profile,
      slots: [{
        id: "bank_statement#a#0",
        docType: "bank_statement",
        stage: "banking",
        index: 0,
        months,
      }],
    });
    const judged = judgeFile(state, MORTGAGE_RULES, {
      docType: "bank_statement",
      fields: { months: "2026-08,2026-09" },
    }, NOW);
    expect(judged.kind).toBe("accept");
    if (judged.kind !== "accept") return;
    expect(judged.coveredMonths).toEqual(["2026-08", "2026-09"]);
    state = recordMonths(state, judged.slotId, judged.coveredMonths ?? [], "remote", "a.pdf");
    expect(state.slots[0]?.status).toBe("missing");
    state = recordMonths(state, judged.slotId, ["2026-10"], "remote", "b.pdf");
    expect(state.slots[0]?.status).toBe("uploaded");
    expect(state.status).toBe("complete");
  });

  it("rejects a file that is not one of the open types", () => {
    const judged = judgeFile(dossier(), MORTGAGE_RULES, { docType: "passport", fields: {} }, NOW);
    expect(judged.kind).toBe("reject");
    if (judged.kind === "reject") expect(judged.reason).toBe("wrong_type");
  });

  it("treats an empty type from a completed read as the wrong document", () => {
    const judged = judgeFile(dossier(), MORTGAGE_RULES, { docType: "", fields: {} }, NOW);
    expect(judged.kind).toBe("reject");
    if (judged.kind !== "reject") return;
    expect(judged.reason).toBe("wrong_type");
    expect(judged.state.slots.find((slot) => slot.id === judged.slotId)?.lastReason).toBe("wrong_type");
  });

  it("keeps a skipped or failed read off the wrong-document reason", () => {
    const skipped = judgeFile(dossier(), MORTGAGE_RULES, { docType: "", fields: {}, unread: "no_model" }, NOW);
    const failed = judgeFile(dossier(), MORTGAGE_RULES, { docType: "", fields: {}, unread: "extract_failed" }, NOW);
    expect(skipped.kind === "reject" && skipped.reason).toBe("no_model");
    expect(failed.kind === "reject" && failed.reason).toBe("extract_failed");
    expect(en.documents.reasons.no_model).toBe(en.documents.reasons.unreadable);
    expect(en.documents.reasons.extract_failed).toBe(en.documents.reasons.unreadable);
    expect(he.documents.reasons.no_model).toBe(he.documents.reasons.unreadable);
    expect(he.documents.reasons.extract_failed).toBe(he.documents.reasons.unreadable);
    expect(uiCopy("en").documentsUi.reasons.no_model).toBe("No model configured");
    expect(uiCopy("he").documentsUi.reasons.extract_failed).toBe("בדיקת הקובץ נכשלה");
  });

  it("escalates after three failures on the same slot and commits an accepted upload", () => {
    let state = dossier();
    let escalated = false;
    for (let i = 0; i < 3; i += 1) {
      const judged = judgeFile(state, MORTGAGE_RULES, { docType: "passport", fields: {} }, NOW);
      expect(judged.kind).toBe("reject");
      if (judged.kind === "reject") {
        state = judged.state;
        escalated = judged.escalated;
      }
    }
    expect(escalated).toBe(true);
    expect(state.status).toBe("blocked");

    const ok = freshDossier({
      smartClientId: "c1",
      profile,
      slots: requiredSlots(profile, MORTGAGE_RULES),
    });
    const accepted = judgeFile(
      ok,
      MORTGAGE_RULES,
      { docType: "id_card", fields: { nationalId: "123456782", fullName: "Dana Levi" } },
      NOW,
    );
    expect(accepted.kind).toBe("accept");
    if (accepted.kind !== "accept") return;
    const next = commitSlot(ok, accepted.slotId, "remote-1", "id.pdf");
    expect(next.slots.find((slot) => slot.id === accepted.slotId)?.status).toBe("uploaded");
    expect(next.status).toBe("gathering");
  });
});

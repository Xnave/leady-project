import { describe, expect, it } from "vitest";
import { copyFor } from "@/lib/copy";
import { chat as he } from "@/lib/copy/he";
import { acceptsIdBack, blankFormAlreadyUploaded, blankFormDue, checklistFile, customerRejection, documentAskText, documentFileAsk, documentsReplyLang, escalateAnswer, groupChecklistRows, idBackOutcome, idBatchNeedsAppendix, pendingFiles, payslipFieldLabel, readIdBack, refreshDossier, rejectionDetail, releaseHeldSlot, reopenNamedSlot, selectIngestMessages, type ChecklistPiece } from "./dossier";
import { applyCustomerAnswers, blankBorrower, borrowerFileWho, factsFromClient, nextQuestion } from "./facts";
import { checklistSlots, MORTGAGE_RULES } from "./mortgage-rules";
import { commitSlot, freshDossier } from "./validate";

function message(id: string, iso: string, filename?: string) {
  return {
    id,
    createdAt: new Date(iso),
    text: "",
    metadata: filename
      ? { attachments: [{ filename, mime: filename.endsWith(".pdf") ? "application/pdf" : "image/heic" }] }
      : {},
  };
}

describe("selectIngestMessages", () => {
  it("keeps the triggering message and older attachments when a newer text arrived", () => {
    const older = message("older", "2026-11-02T10:00:00Z", "id.pdf");
    const trigger = message("trigger", "2026-11-02T10:01:00Z", "slip.pdf");
    const newer = message("newer", "2026-11-02T10:02:00Z");
    const selected = selectIngestMessages([newer, trigger, older], trigger);
    expect(selected.map((row) => row.id)).toEqual(["older", "trigger"]);
    expect(pendingFiles(selected, []).map((file) => file.attachment.filename)).toEqual(["id.pdf", "slip.pdf"]);
  });

  it("skips an attachment that is already rejected or uploaded", () => {
    const trigger = message("trigger", "2026-11-02T10:01:00Z", "slip.pdf");
    const files = pendingFiles([trigger], [{ messageId: "trigger", filename: "slip.pdf" }]);
    expect(files).toEqual([]);
  });

  it("drops the oldest messages past the window and still keeps the trigger", () => {
    const trigger = message("trigger", "2026-11-02T12:00:00Z");
    const older = Array.from({ length: 21 }, (_, index) =>
      message(`old-${index}`, new Date(Date.parse("2026-11-02T10:00:00Z") + index * 1000).toISOString()),
    );
    const selected = selectIngestMessages([trigger, ...older.slice().reverse()], trigger);
    expect(selected).toHaveLength(20);
    expect(selected.at(-1)?.id).toBe("trigger");
    expect(selected.some((row) => row.id === "old-0")).toBe(false);
  });
});

describe("escalateAnswer", () => {
  it("reads a clear yes or no to the consultant offer", () => {
    expect(escalateAnswer("כן")).toBe("yes");
    expect(escalateAnswer("תעביר ליועץ")).toBe("yes");
    expect(escalateAnswer("לא")).toBe("no");
    expect(escalateAnswer("אנסה שוב")).toBe("no");
    expect(escalateAnswer("מה שלומך")).toBeNull();
  });
});

describe("rejectionDetail", () => {
  it("tells the customer which statement months were found and which are needed", () => {
    const now = new Date("2026-11-09T10:00:00+02:00");
    expect(
      rejectionDetail({
        reason: "prior_calendar_months",
        fields: { months: "2026-04, 2026-05, 2026-06, 2026-07" },
        lang: "he",
        expectedMonths: ["2026-08", "2026-09", "2026-10"],
        now,
      }),
    ).toBe("זיהיתי בקובץ את החודשים אפריל, מאי, יוני ויולי; נדרשים אוגוסט, ספטמבר ואוקטובר.");
    expect(
      rejectionDetail({
        reason: "prior_calendar_months",
        fields: { months: "2025-04" },
        lang: "en",
        expectedMonths: ["2026-08", "2026-09", "2026-10"],
        now,
      }),
    ).toBe("I found April 2025 in the statement; needed: August, September and October.");
  });

  it("keeps Hebrew when the only customer text is a file name", () => {
    const ctx = {
      tenant: { chatLanguage: "multi" },
      messages: [{ role: "lead", text: "bank_statement__leumi_2026-08_2026-10.pdf" }],
    } as Parameters<typeof documentsReplyLang>[0];
    expect(documentsReplyLang(ctx)).toBe("he");
    const photo = {
      tenant: { chatLanguage: "multi" },
      messages: [{ role: "lead", text: "IMG_6989 2.jpg" }],
    } as Parameters<typeof documentsReplyLang>[0];
    expect(documentsReplyLang(photo)).toBe("he");
    const heic = {
      tenant: { chatLanguage: "multi" },
      messages: [
        { role: "lead", text: "שלום" },
        { role: "lead", text: "IMG_2359.HEIC" },
        { role: "lead", text: "IMG_2359.jpg" },
      ],
    } as Parameters<typeof documentsReplyLang>[0];
    expect(documentsReplyLang(heic)).toBe("he");
    const english = {
      tenant: { chatLanguage: "multi" },
      messages: [{ role: "lead", text: "Please reply in English" }],
    } as Parameters<typeof documentsReplyLang>[0];
    expect(documentsReplyLang(english)).toBe("en");
  });

  it("names the borrower when the file has two people", () => {
    expect(borrowerFileWho({ borrowers: [blankBorrower("1")] }, "1", "he")).toBe("");
    const named = {
      borrowers: [
        { ...blankBorrower("1"), fullName: "דנה כהן", employment: "salaried" as const },
        { ...blankBorrower("2"), employment: "self_employed" as const },
      ],
    };
    expect(borrowerFileWho(named, "1", "he")).toBe("דנה כהן");
    expect(borrowerFileWho(named, "2", "he")).toBe("הלווה העצמאי");
    const sameJob = {
      borrowers: [
        { ...blankBorrower("1"), employment: "salaried" as const },
        { ...blankBorrower("2"), employment: "salaried" as const },
      ],
    };
    expect(borrowerFileWho(sameJob, "2", "he")).toBe("הלווה השני");

    const split = applyCustomerAnswers(
      applyCustomerAnswers(applyCustomerAnswers(factsFromClient({}), "כן").profile, "שכיר").profile,
      "עצמאי",
    ).profile;
    const profile = { ...split, firstHome: "true" as const, loans: "none" as const };
    let state = freshDossier({
      smartClientId: "c",
      profile,
      slots: checklistSlots(profile, MORTGAGE_RULES),
    });
    for (const slot of [...state.slots]) {
      const firstIdentity = slot.borrower === "1" && (slot.docType === "id_card" || slot.docType === "id_appendix");
      if (firstIdentity) state = commitSlot(state, slot.id, "remote", "id.jpg");
    }
    const ask = documentFileAsk(state, MORTGAGE_RULES, "he", copyFor("he").chat);
    expect(ask).toBe("שלח/י לי בבקשה צילום ברור של תעודת הזהות עם הספח של הלווה העצמאי.");
  });

  it("asks only for the payslip month that is not already saved", () => {
    let profile = factsFromClient({});
    profile = applyCustomerAnswers(profile, "לא").profile;
    profile = applyCustomerAnswers(profile, "שכיר").profile;
    profile = applyCustomerAnswers(profile, "כן").profile;
    profile = { ...profile, loans: "none" };
    let state = freshDossier({
      smartClientId: "c",
      profile,
      slots: checklistSlots(profile, MORTGAGE_RULES),
    });
    const now = new Date("2026-11-09T12:00:00.000Z");
    const slips = state.slots.filter((slot) => slot.docType === "payslip");
    expect(slips).toHaveLength(3);
    state = {
      ...state,
      slots: state.slots.map((slot) => slot.docType === "payslip" ? slot : { ...slot, status: "uploaded" as const }),
    };
    const saved = [
      { id: slips[0]?.id, month: "2026-08" },
      { id: slips[1]?.id, month: "2026-09" },
    ];
    for (const item of saved) {
      if (!item.id) continue;
      state = commitSlot(state, item.id, item.month, "slip.pdf");
      state = {
        ...state,
        slots: state.slots.map((slot) => slot.id === item.id ? { ...slot, coveredMonths: [item.month] } : slot),
      };
    }
    expect(documentFileAsk(state, MORTGAGE_RULES, "he", copyFor("he").chat, now)).toBe(
      "התלושים של אוגוסט וספטמבר כבר אצלנו. נצטרך רק את תלוש אוקטובר המלא, כולל כל העמודים.",
    );
  });

  it("drops the open photo and keeps an older saved letter", () => {
    const split = applyCustomerAnswers(
      applyCustomerAnswers(applyCustomerAnswers(factsFromClient({}), "כן").profile, "שכיר").profile,
      "עצמאי",
    ).profile;
    const profile = {
      ...split,
      firstHome: "true" as const,
      loans: "none" as const,
      imageBatchSlot: "id_card#2#0",
      idBackPending: "2",
    };
    let state = freshDossier({
      smartClientId: "c",
      profile,
      slots: checklistSlots(profile, MORTGAGE_RULES),
    });
    const letter = state.slots.find((slot) => slot.docType === "accountant_letter");
    const salaried = state.slots.find((slot) => slot.id === "id_card#1#0");
    expect(letter && salaried).toBeTruthy();
    if (!letter || !salaried) return;
    state = commitSlot(state, letter.id, "letter", "letter.pdf");
    state = commitSlot(state, salaried.id, "id", "id.jpg");
    state = { ...state, profile: { ...state.profile, imageBatchSlot: "id_card#2#0", idBackPending: "2" } };
    const released = releaseHeldSlot(state, MORTGAGE_RULES, "id_card#2#0");
    expect(released.profile.imageBatchSlot).toBe("");
    expect(released.profile.idBackPending).toBe("");
    expect(released.slots.find((slot) => slot.id === letter.id)?.status).toBe("uploaded");
    expect(documentFileAsk(released, MORTGAGE_RULES, "he", copyFor("he").chat)).toContain("הלווה העצמאי");
    const undone = reopenNamedSlot(state, "latest", salaried.id);
    expect(undone?.slot.id).toBe(salaried.id);
    expect(undone?.state.slots.find((slot) => slot.id === letter.id)?.status).toBe("uploaded");
  });

  it("asks for a closer photo of the card when the ID number was not read", () => {
    expect(he.documents.askIdCard).toContain("עם הספח");
    expect(he.documents.askIdBack).toBe("שלח/י לי בבקשה גם צילום של גב תעודת הזהות.");
    expect(he.documents.askPayslips).toContain("3 החודשים האחרונים");
    expect(he.documents.reasons.id_number).toContain("מספר תעודת הזהות");
  });

  it("does not expose an internal document type when the file is unrelated", () => {
    expect(rejectionDetail({ reason: "wrong_type", fields: {}, lang: "en" })).toBe(
      "The file wasn't identified as one of the documents currently needed.",
    );
  });
});

describe("checklistFile", () => {
  it("finds a payslip by the shared remote id when the stored name is the original file", () => {
    const file = {
      id: "doc-1",
      filename: "payslips_2026-08_2026-10.pdf",
      remoteId: "local:לווה_תלוש_שכר_2026-11-09_01.pdf",
    };
    expect(checklistFile({
      filename: "לווה_תלוש_שכר_2026-11-09_01.pdf",
      remoteId: file.remoteId,
    }, [file])?.id).toBe("doc-1");
  });
});

function piece(over: Partial<ChecklistPiece> & Pick<ChecklistPiece, "id" | "docType">): ChecklistPiece {
  return {
    borrower: "1",
    who: "",
    label: over.docType,
    stage: "identity",
    status: "uploaded",
    lastReason: "",
    filename: "",
    remoteId: "",
    href: "",
    mime: "application/pdf",
    coveredMonths: [],
    sourceFilename: "",
    ...over,
  };
}

describe("groupChecklistRows", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("shows the ID card, the other side, and the appendix as one field", () => {
    const rows = groupChecklistRows([
      piece({ id: "id_card#1#0", docType: "id_card", label: "תעודת זהות", href: "/id.pdf" }),
      piece({ id: "id_card_back#1#0", docType: "id_card_back", label: "הצד השני", href: "/back.pdf" }),
      piece({ id: "id_appendix#1#0", docType: "id_appendix", label: "ספח", href: "/id.pdf" }),
    ], "he", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("תעודת זהות");
    expect(rows[0]?.files.map((file) => file.href)).toEqual(["/id.pdf", "/back.pdf"]);
  });

  it("names one payslip field with the count and the month span", () => {
    const rows = groupChecklistRows([0, 1, 2].map((index) => piece({
      id: `payslip#1#${index}`,
      docType: "payslip",
      stage: "income",
      href: "/payslips.pdf",
      sourceFilename: "payslips_2026-08_2026-10.pdf",
    })), "he", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("3 תלושי שכר אוגוסט-אוקטובר");
    expect(rows[0]?.files).toHaveLength(1);
    expect(payslipFieldLabel(3, ["2026-06", "2026-08"], "he", now)).toBe("3 תלושי שכר יוני-אוגוסט");
  });

  it("names the borrower when two people have the same document", () => {
    const rows = groupChecklistRows([
      piece({ id: "id_card#1#0", docType: "id_card", label: "תעודת זהות", who: "הלווה השכיר", href: "/a.pdf" }),
      piece({ id: "id_card#2#0", docType: "id_card", borrower: "2", label: "תעודת זהות", who: "הלווה העצמאי", href: "/b.pdf" }),
    ], "he", now);
    expect(rows.map((row) => row.label)).toEqual([
      "תעודת זהות של הלווה השכיר",
      "תעודת זהות של הלווה העצמאי",
    ]);
    expect(rows.map((row) => row.slotIds)).toEqual([["id_card#1#0"], ["id_card#2#0"]]);
  });
});

describe("customerRejection", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("names the payslip month when it is outside the last three months", () => {
    const text = customerRejection({
      reason: "field_present",
      field: "fullName",
      docType: "payslip",
      fields: { periodEnd: "2023-01-15" },
      lang: "he",
      now,
    });
    expect(text).toContain("ינואר 2023");
    expect(text).toContain("אוגוסט");
    expect(text).toContain("אוקטובר");
    expect(text).not.toContain("הצד הקדמי");
  });

  it("says the name and the month were not read when both are empty", () => {
    const text = customerRejection({
      reason: "field_present",
      field: "fullName",
      docType: "payslip",
      fields: {},
      lang: "he",
      now,
    });
    expect(text).toContain("שם העובד");
    expect(text).toContain("חודש השכר");
    expect(text).toContain("אוגוסט");
  });

  it("names the ID number that does not match the file", () => {
    const text = customerRejection({
      reason: "matches_profile",
      field: "nationalId",
      docType: "id_card",
      fields: { nationalId: "1 2345678 9", fullName: "ישראל ישראלי" },
      lang: "he",
    });
    expect(text).toContain("ישראל ישראלי");
    expect(text).toContain("123456789");
    expect(text).toContain("מספר תעודת הזהות");
    expect(text).not.toContain("הפרטים במסמך");
  });

  it("names an ID mismatch in English without a stored number", () => {
    const text = customerRejection({
      reason: "matches_profile",
      field: "nationalId",
      docType: "id_card",
      fields: { nationalId: "123456789" },
      lang: "en",
    });
    expect(text).toContain("123456789");
    expect(text).toContain("doesn't match the number on file");
  });

  it("asks for payslips when the file is not a payslip", () => {
    const text = customerRejection({
      reason: "unrecognized",
      docType: "payslip",
      fields: {},
      lang: "he",
      now,
    });
    expect(text).toContain("תלוש שכר");
    expect(text).not.toContain("הצד הקדמי");
  });

  it("keeps the ID card until the appendix can go in the same file", () => {
    const answered = applyCustomerAnswers(
      applyCustomerAnswers(factsFromClient({}), "לא").profile,
      "שכיר",
    ).profile;
    const profile = {
      ...answered,
      firstHome: "true" as const,
      loans: "none" as const,
      imageBatchSlot: "id_card#1#0",
    };
    const state = freshDossier({
      smartClientId: "c",
      profile,
      slots: checklistSlots(profile, MORTGAGE_RULES),
    });
    expect(idBatchNeedsAppendix(state)).toBe(true);
    const waiting = { ...state.profile, appendixPending: "1" };
    const question = nextQuestion(waiting);
    expect(question?.kind).toBe("id_appendix");
    if (question?.kind === "id_appendix") {
      expect(documentAskText(question, "he", copyFor("he").chat)).toBe(he.documents.askIdAppendix);
    }
    expect(idBatchNeedsAppendix({ ...state, profile: { ...state.profile, appendixSeen: "1" } })).toBe(false);
    const released = releaseHeldSlot(
      { ...state, profile: { ...state.profile, appendixPending: "1" } },
      MORTGAGE_RULES,
      "id_card#1#0",
    );
    expect(released.profile.appendixPending).toBe("");
  });
});

describe("refreshDossier", () => {
  it("closes the checklist when the extra-loan answer is already stored", () => {
    const open = {
      ...factsFromClient({
        id_1: "123456782",
        firstname_1: "Dana",
        lastname_1: "Levi",
        status_report_1: "1",
        banks_accounts: [{ uuid: "acct-1" }],
        liabilities: [{ balance: "1" }],
      }),
      firstHome: "true" as const,
      secondBorrower: "no" as const,
      loanMore: "pending" as const,
    };
    const slots = freshDossier({
      smartClientId: "c",
      profile: open,
      slots: checklistSlots(open, MORTGAGE_RULES),
    }).slots.map((slot) => ({ ...slot, status: "uploaded" as const, remoteId: "r", filename: "f.pdf" }));
    const next = refreshDossier({
      status: "gathering",
      smartClientId: "c",
      profile: { ...open, loanMore: "no" },
      slots,
      activeStage: "banking",
    }, MORTGAGE_RULES, "");
    expect(next.status).toBe("complete");
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("blankFormDue", () => {
  function mixedState(uploadBefore = "") {
    const profile = {
      ...factsFromClient({
        id_1: "111111111",
        firstname_1: "Dana",
        lastname_1: "Levi",
        status_report_1: "2",
        id_2: "222222222",
        firstname_2: "Noam",
        lastname_2: "Levi",
        status_report_2: "0",
        banks_accounts: [{ uuid: "a" }],
      }),
      firstHome: "true" as const,
      loans: "none" as const,
    };
    let state = freshDossier({
      smartClientId: "c",
      profile,
      slots: checklistSlots(profile, MORTGAGE_RULES),
    });
    if (!uploadBefore) return state;
    for (const slot of state.slots) {
      if (slot.docType === uploadBefore) break;
      state = commitSlot(state, slot.id, "remote", "file.pdf");
    }
    return state;
  }

  it("waits until the accountant letter is the document being asked", () => {
    expect(blankFormDue(mixedState(), MORTGAGE_RULES)).toBe("");
    expect(blankFormDue(mixedState("accountant_letter"), MORTGAGE_RULES)).toBe("accountant_letter");
    const offered = mixedState("accountant_letter");
    offered.profile.formsOffered = ["accountant_letter"];
    expect(blankFormDue(offered, MORTGAGE_RULES)).toBe("");
  });
});

describe("blankFormAlreadyUploaded", () => {
  const file = "אישור רואה חשבון עוסק מורשה.pdf";

  it("is true only after that form's slot is uploaded", () => {
    expect(blankFormAlreadyUploaded(MORTGAGE_RULES, [{ docType: "accountant_letter", status: "missing" }], file)).toBe(false);
    expect(blankFormAlreadyUploaded(MORTGAGE_RULES, [{ docType: "accountant_letter", status: "uploaded" }], file)).toBe(true);
    expect(blankFormAlreadyUploaded(MORTGAGE_RULES, [{ docType: "id_card", status: "uploaded" }], file)).toBe(false);
  });
});

describe("readIdBack", () => {
  const job = { bytes: Buffer.from("photo"), mime: "image/jpeg", filename: "back.jpg" };

  it("does not accept a photo the read says is not an ID", async () => {
    const licence = await readIdBack(async () => ({ docType: "", fields: {} }), job, MORTGAGE_RULES.documents.id_card_back.recognize);
    expect(licence.accept).toBe(false);
    expect(idBackOutcome(licence)).toBe("wrong");
    const front = await readIdBack(async () => ({ docType: "id_card", fields: {} }), job);
    expect(front.accept).toBe(false);
    expect(idBackOutcome(front)).toBe("wrong");
    expect(acceptsIdBack("id_card")).toBe(false);
    const failed = await readIdBack(async () => ({ docType: "", fields: {}, unread: "extract_failed" }), job);
    expect(idBackOutcome(failed)).toBe("unread");
    expect(he.documents.idBackTryAgain).toContain("שוב");
    expect(he.documents.idBackTryAgain).not.toContain("זה לא הצד השני");
    const card = await readIdBack(async () => ({ docType: "id_card_back", fields: {} }), job);
    expect(card.accept).toBe(true);
    expect(idBackOutcome(card)).toBe("accept");
  });
});

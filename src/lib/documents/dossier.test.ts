import { describe, expect, it } from "vitest";
import { chat as he } from "@/lib/copy/he";
import { blankFormAlreadyUploaded, checklistFile, customerRejection, documentsReplyLang, escalateAnswer, groupChecklistRows, pendingFiles, payslipFieldLabel, rejectionDetail, selectIngestMessages, type ChecklistPiece } from "./dossier";
import { MORTGAGE_RULES } from "./mortgage-rules";

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
    ).toBe("זיהיתי בקובץ את החודשים אפריל, מאי, יוני ו-יולי; נדרשים אוגוסט, ספטמבר ו-אוקטובר.");
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

  it("asks for a closer photo of the card when the ID number was not read", () => {
    expect(he.documents.askIdCard).toContain("עם הספח");
    expect(he.documents.askIdBack).toBe("אשמח גם לצד השני של תעודת הזהות.");
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
});

describe("blankFormAlreadyUploaded", () => {
  const file = "אישור רואה חשבון עוסק מורשה.pdf";

  it("is true only after that form's slot is uploaded", () => {
    expect(blankFormAlreadyUploaded(MORTGAGE_RULES, [{ docType: "accountant_letter", status: "missing" }], file)).toBe(false);
    expect(blankFormAlreadyUploaded(MORTGAGE_RULES, [{ docType: "accountant_letter", status: "uploaded" }], file)).toBe(true);
    expect(blankFormAlreadyUploaded(MORTGAGE_RULES, [{ docType: "id_card", status: "uploaded" }], file)).toBe(false);
  });
});

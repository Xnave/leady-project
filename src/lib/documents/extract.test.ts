import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { llmConfigured } from "@/lib/flow/model";
import { extractDocument, normalizeBiometric, normalizeMonthsField, normalizeNationalId, normalizeYesNo, periodsFromText, yearFromText } from "./extract";

vi.mock("@/lib/flow/model", () => ({
  llmConfigured: vi.fn(() => false),
  chatModel: () => ({ id: "test" }),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

const open = [{ docType: "id_card", label: "ID card", fields: ["nationalId", "fullName"] }];
const file = { bytes: Buffer.from("x"), mime: "application/pdf", filename: "id.pdf", open };

function lastLog(): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0]));
}

describe("extractDocument", () => {
  beforeEach(() => {
    vi.mocked(llmConfigured).mockReset();
    vi.mocked(generateObject).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("logs a skipped read when no model is configured", async () => {
    vi.mocked(llmConfigured).mockReturnValue(false);
    const result = await extractDocument(file);
    expect(result).toMatchObject({ docType: "", unread: "no_model" });
    expect(lastLog()).toMatchObject({
      msg: "documents.extract",
      outcome: "skipped",
      reason: "no_model",
      filename: "id.pdf",
      mime: "application/pdf",
      openTypes: ["id_card"],
    });
  });

  it("leaves the type empty when the model matches none of the open documents", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({
      object: { docType: "  ", fields: {} },
      finishReason: "stop",
      warnings: undefined,
    } as never);
    const result = await extractDocument(file);
    expect(result.docType).toBe("");
    expect(result.unread).toBeUndefined();
    expect(lastLog()).toMatchObject({
      msg: "documents.extract",
      outcome: "ok",
      docType: "(none)",
      finishReason: "stop",
    });
  });

  it("logs sparse extraction when the type is set but asked fields are empty", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({
      object: { docType: "id_card", fields: {} },
      finishReason: "stop",
      warnings: [{ type: "other", message: "unsupported file media type" }],
    } as never);
    const result = await extractDocument(file);
    expect(result).toMatchObject({
      docType: "id_card",
      fields: {},
      summary: {
        askedFields: ["nationalId", "fullName"],
        filledFields: [],
        emptyFields: ["nationalId", "fullName"],
        finishReason: "stop",
      },
    });
    expect(lastLog()).toMatchObject({
      msg: "documents.extract",
      outcome: "ok",
      docType: "id_card",
      inOpen: true,
      sparse: true,
      askedFields: ["nationalId", "fullName"],
      emptyFields: ["nationalId", "fullName"],
      filledFields: [],
      warnings: ["unsupported file media type"],
      detail: 'Matched "id_card" but left fields empty: nationalId, fullName.',
    });
  });

  it("explains when the model names a type that is not currently open", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({
      object: { docType: "payslip", months: [], fields: {}, evidence: "" },
      finishReason: "stop",
      warnings: undefined,
    } as never);
    const result = await extractDocument({
      ...file,
      open: [{ docType: "bank_statement", label: "Bank statement", fields: ["months"] }],
    });
    expect(result.docType).toBe("payslip");
    expect(result.summary?.askedFields).toEqual([]);
    expect(lastLog()).toMatchObject({
      msg: "documents.extract",
      outcome: "ok",
      docType: "payslip",
      inOpen: false,
      sparse: false,
      openTypes: ["bank_statement"],
      detail: 'Model saw "payslip", but open slots are only: bank_statement.',
    });
  });

  it("merges top-level statement months into fields for the checker", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        docType: "bank_statement",
        months: ["2026-04", "2026-07"],
        fields: {},
        evidence: "15.04.2026 - 15.07.2026",
      },
      finishReason: "stop",
      warnings: undefined,
    } as never);
    const result = await extractDocument({
      ...file,
      open: [{ docType: "bank_statement", label: "Bank statement", fields: ["months"] }],
    });
    expect(result.fields.months).toBe("2026-04, 2026-05, 2026-06, 2026-07");
    expect(result.summary?.filledFields).toContain("months");
    expect(lastLog()).toMatchObject({
      months: "2026-04, 2026-05, 2026-06, 2026-07",
      evidence: "15.04.2026 - 15.07.2026",
      sparse: false,
    });
  });

  it("joins a grouped ID number and keeps a last name on its own", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        docType: "id_card",
        nationalId: "2 0570771 4",
        firstName: "",
        lastName: "לוי",
        fields: {},
        evidence: "2 0570771 4",
      },
      finishReason: "stop",
      warnings: undefined,
    } as never);
    const result = await extractDocument({
      ...file,
      open: [{ ...open[0], fields: ["nationalId", "firstName", "lastName", "fullName"] }],
    });
    expect(result.fields.nationalId).toBe("205707714");
    expect(result.fields.fullName).toBe("לוי");
    expect(normalizeNationalId("2 0570771 4")).toBe("205707714");
    expect(normalizeBiometric("ביומטרי")).toBe("yes");
    expect(normalizeBiometric("לא ביומטרי")).toBe("no");
    expect(normalizeYesNo("yes")).toBe("yes");
    expect(normalizeYesNo("no")).toBe("no");
  });

  it("reads the card again when it was identified but the number is empty", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { docType: "id_card", nationalId: "", firstName: "", lastName: "", fields: {} },
        finishReason: "stop",
        warnings: undefined,
      } as never)
      .mockResolvedValueOnce({
        object: { docType: "id_card", nationalId: "205707714", lastName: "לוי", fields: {} },
        finishReason: "stop",
        warnings: undefined,
      } as never);
    const result = await extractDocument({
      ...file,
      open: [
        { docType: "id_card", label: "תעודת זהות / ID card", fields: ["nationalId", "firstName", "lastName"] },
        { docType: "bank_statement", label: "תדפיס עו״ש", fields: ["months"] },
      ],
      focus: "id_card",
    });
    expect(result.docType).toBe("id_card");
    expect(result.fields.nationalId).toBe("205707714");
    expect(result.fields.fullName).toBe("לוי");
    expect(generateObject).toHaveBeenCalledTimes(2);
    const second = vi.mocked(generateObject).mock.calls[1]?.[0] as {
      messages: { content: { text?: string }[] }[];
    };
    expect(second.messages[0].content[0].text).toContain("ספח");
    expect(second.messages[0].content[0].text).not.toContain("bank_statement");
  });

  it("reads the requested document again when the first pass matches nothing", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject)
      .mockResolvedValueOnce({
        object: { docType: "", fields: {} },
        finishReason: "stop",
        warnings: undefined,
      } as never)
      .mockResolvedValueOnce({
        object: { docType: "id_card", fields: { nationalId: "123456782", fullName: "Dana Levi" } },
        finishReason: "stop",
        warnings: undefined,
      } as never);
    const result = await extractDocument({
      ...file,
      open: [
        { ...open[0], label: "תעודת זהות / ID card", recognize: "Israeli identity card" },
        { docType: "payslip", label: "תלוש שכר / Payslip", fields: ["fullName"] },
      ],
      focus: "id_card",
    });
    expect(result.docType).toBe("id_card");
    expect(result.fields.nationalId).toBe("123456782");
    expect(generateObject).toHaveBeenCalledTimes(2);
    const second = vi.mocked(generateObject).mock.calls[1]?.[0] as {
      messages: { content: { text?: string }[] }[];
    };
    expect(second.messages[0].content[0].text).toContain("תעודת זהות / ID card");
    expect(second.messages[0].content[0].text).not.toContain("payslip");
  });

  it("logs the vision error when the call throws", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockRejectedValue(new Error("model 503"));
    const result = await extractDocument({ ...file, mime: "image/jpeg", filename: "scan.jpg" });
    expect(result).toMatchObject({ docType: "", unread: "extract_failed", error: "model 503" });
    expect(lastLog()).toMatchObject({
      msg: "documents.extract",
      outcome: "failed",
      filename: "scan.jpg",
      mime: "image/jpeg",
      error: "model 503",
    });
  });
});

describe("yearFromText", () => {
  it("prefers the labeled tax year over another date", () => {
    expect(yearFromText("נחתם ב-15.03.2026. שנת מס: 2025")).toBe("2025");
    expect(yearFromText("2025")).toBe("2025");
    expect(yearFromText("דנה לוי")).toBe("");
  });
});

describe("tax year extraction", () => {
  it("stores the year the reader returns for a tax document", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({
      object: { docType: "tax_assessment", fullName: "דנה לוי", year: "2025", evidence: "שנת מס: 2025", fields: {} },
      finishReason: "stop",
      warnings: undefined,
    } as never);
    const result = await extractDocument({
      ...file,
      filename: "אישור פתיחת תיק במס הכנסה 2025.pdf",
      open: [{ docType: "tax_assessment", label: "שומת מס / Tax assessment", fields: ["fullName", "year"] }],
    });
    expect(result.fields.year).toBe("2025");
    expect(result.fields.fullName).toBe("דנה לוי");
    const call = vi.mocked(generateObject).mock.calls.at(-1)?.[0] as {
      messages: { content: { text?: string }[] }[];
    };
    expect(call.messages[0].content[0].text).toContain("שנת מס 2025");
  });
});

describe("periodsFromText", () => {
  it("reads a Hebrew month and every ISO month in one quote", () => {
    expect(periodsFromText("ינואר 2023 תלוש: 82")).toEqual(["2023-01"]);
    expect(periodsFromText("Payslips included: 2026-08, 2026-09, 2026-10")).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });
});

describe("normalizeMonthsField", () => {
  it("expands endpoint-only ranges into every YYYY-MM", () => {
    expect(normalizeMonthsField(["2026-04", "2026-07"])).toBe("2026-04, 2026-05, 2026-06, 2026-07");
  });
});

import { describe, expect, it } from "vitest";
import { MORTGAGE_RULES } from "./mortgage-rules";
import {
  conditionShape,
  explainRulesIssue,
  loadRulesDocument,
  moveBy,
  nextNumericId,
  renameDocument,
  rulesIssueList,
  uniqueId,
} from "./rules-form";

const text = {
  nameHeRequired: "he",
  nameEnRequired: "en",
  idRequired: "id",
  idTaken: "taken {id}",
  fieldRequired: "field",
  checkUnknown: "check",
  docMissing: "doc",
  stageMissing: "stage",
  countInvalid: "count",
  condKeyRequired: "key",
  condValueRequired: "value",
  monthsInvalid: "months",
  stagesRequired: "stages",
  collectionRequired: "waves",
  blankFileRequired: "file",
};

describe("loadRulesDocument", () => {
  it("reads an object and a JSON string", () => {
    expect(loadRulesDocument(MORTGAGE_RULES).documents.id_card.labels.he).toContain("תעודת זהות");
    const raw = JSON.stringify(MORTGAGE_RULES);
    expect(loadRulesDocument(raw).stages.map((stage) => stage.id)).toEqual(["identity", "income", "banking"]);
  });

  it("falls back to the mortgage list when the JSON cannot be read", () => {
    expect(loadRulesDocument("{").documents.payslip.labels.en).toBe("Payslip");
    expect(loadRulesDocument({ stages: [] }).stages.length).toBeGreaterThan(0);
  });
});

describe("explainRulesIssue", () => {
  it("turns parser paths into the strings the form shows", () => {
    expect(explainRulesIssue('stages[0] duplicates "income"', text)).toBe("taken income");
    expect(explainRulesIssue("documents.payslip.labels.he is required", text)).toBe("he");
    expect(explainRulesIssue("stages must be a non-empty list", text)).toBe("stages");
    expect(explainRulesIssue("something else", text)).toBe("something else");
  });

  it("accepts the mortgage list", () => {
    expect(rulesIssueList(MORTGAGE_RULES)).toEqual([]);
  });
});

describe("ids and conditions", () => {
  it("picks an id that is not taken", () => {
    expect(uniqueId("doc", ["doc_1", "doc_2"])).toBe("doc_3");
    expect(nextNumericId(["1", "2"])).toBe("3");
  });

  it("moves an item one step", () => {
    expect(moveBy(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveBy(["a"], 0, -1)).toEqual(["a"]);
  });

  it("tells a flat condition from a nested one", () => {
    expect(conditionShape(undefined)).toBe("always");
    expect(conditionShape({ op: "truthy", key: "employment" })).toBe("flat");
    expect(conditionShape({ op: "all", of: [{ op: "truthy", key: "employment" }] })).toBe("flat");
    expect(
      conditionShape({
        op: "all",
        of: [{ op: "any", of: [{ op: "truthy", key: "employment" }] }],
      }),
    ).toBe("nested");
  });

  it("renames a document and the rows that ask for it", () => {
    const next = renameDocument(MORTGAGE_RULES, "id_card", "identity_card");
    expect(next?.documents.identity_card.labels.en).toBe("ID card");
    expect(next?.documents.id_card).toBeUndefined();
    expect(next?.requirements.some((req) => req.docType === "identity_card")).toBe(true);
    expect(renameDocument(MORTGAGE_RULES, "id_card", "id_appendix")).toBeNull();
  });
});

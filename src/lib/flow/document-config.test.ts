import { afterEach, describe, expect, it } from "vitest";
import { FlowConfigError } from "./types";
import { documentApiKey, isTestLead, parseDocumentConfig } from "./document-config";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";

const KEY = "ab".repeat(32);

describe("parseDocumentConfig", () => {
  afterEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("refuses a save with no base URL or rules that fail", () => {
    expect(() => parseDocumentConfig({})).toThrow(FlowConfigError);
    process.env.APP_ENCRYPTION_KEY = KEY;
    expect(() =>
      parseDocumentConfig({
        baseUrl: "https://smart.example",
        apiKey: "secret",
        rules: { stages: [], requirements: [], documents: {} },
      }),
    ).toThrow(FlowConfigError);
  });

  it("stores the key encrypted and keeps a blank resubmit", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: "fake://smart",
      apiKey: "secret",
      rules: MORTGAGE_RULES,
    });
    expect(saved.apiKeyEnc).not.toContain("secret");
    expect(documentApiKey(saved)).toBe("secret");
    const again = parseDocumentConfig(
      { baseUrl: "fake://smart", apiKey: "", rules: MORTGAGE_RULES },
      saved.apiKeyEnc,
    );
    expect(documentApiKey(again)).toBe("secret");
    expect(again.testOnly).toBe(false);
  });

  it("allows a missing key and treats listed phones as test leads", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: "fake://smart",
      rules: MORTGAGE_RULES,
      testPhones: "0501234567\n0501234567",
    });
    expect(saved.apiKeyEnc).toBe("");
    expect(saved.testOnly).toBe(true);
    expect(saved.testPhones).toEqual(["0501234567"]);
    expect(saved.maxRejectTries).toBe(5);
    expect(saved.rejectCooldownMinutes).toBe(5);
    expect(isTestLead(saved, "+972501234567")).toBe(true);
    const keyed = parseDocumentConfig({
      baseUrl: "fake://smart",
      apiKey: "secret",
      rules: MORTGAGE_RULES,
      testPhones: "0501234567",
    });
    expect(isTestLead(keyed, "0509999999")).toBe(false);
    expect(isTestLead(keyed, "0501234567")).toBe(true);
  });

  it("keeps a stored key and phone list when the save omits both", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const again = parseDocumentConfig(
      { baseUrl: "fake://smart", rules: MORTGAGE_RULES },
      "stored-key",
      ["0501234567"],
    );
    expect(again.apiKeyEnc).toBe("stored-key");
    expect(again.testPhones).toEqual(["0501234567"]);
    expect(again.testOnly).toBe(false);
  });

  it("keeps reject try and cool-off settings within range", () => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    const saved = parseDocumentConfig({
      baseUrl: "fake://smart",
      rules: MORTGAGE_RULES,
      maxRejectTries: "12",
      rejectCooldownMinutes: 0,
    });
    expect(saved.maxRejectTries).toBe(12);
    expect(saved.rejectCooldownMinutes).toBe(1);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { FlowConfigError } from "./types";
import { documentApiKey, parseDocumentConfig } from "./document-config";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";

const KEY = "ab".repeat(32);

describe("parseDocumentConfig", () => {
  afterEach(() => {
    delete process.env.APP_ENCRYPTION_KEY;
  });

  it("refuses an enabled instance with no base URL, no key, or rules that fail", () => {
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
  });
});

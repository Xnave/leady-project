import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { llmConfigured } from "@/lib/flow/model";
import { extractDocument } from "./extract";

vi.mock("@/lib/flow/model", () => ({
  llmConfigured: vi.fn(() => false),
  chatModel: () => ({ id: "test" }),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

const open = [{ docType: "id_card", label: "ID card", fields: ["nationalId"] }];
const file = { bytes: Buffer.from("x"), mime: "application/pdf", filename: "id.pdf", open };

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
    const logged = JSON.parse(String(vi.mocked(console.warn).mock.calls[0]?.[0]));
    expect(logged).toMatchObject({
      msg: "documents.extract_skipped",
      filename: "id.pdf",
      mime: "application/pdf",
      reason: "no_model",
    });
  });

  it("leaves the type empty when the model matches none of the open documents", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockResolvedValue({ object: { docType: "  ", fields: {} } } as never);
    const result = await extractDocument(file);
    expect(result.docType).toBe("");
    expect(result.unread).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("logs the vision error when the call throws", async () => {
    vi.mocked(llmConfigured).mockReturnValue(true);
    vi.mocked(generateObject).mockRejectedValue(new Error("model 503"));
    const result = await extractDocument({ ...file, mime: "image/jpeg", filename: "scan.jpg" });
    expect(result).toMatchObject({ docType: "", unread: "extract_failed", error: "model 503" });
    const logged = JSON.parse(String(vi.mocked(console.warn).mock.calls[0]?.[0]));
    expect(logged).toMatchObject({
      msg: "documents.extract_failed",
      filename: "scan.jpg",
      mime: "image/jpeg",
      error: "model 503",
    });
  });
});

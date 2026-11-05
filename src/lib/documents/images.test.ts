import { describe, expect, it } from "vitest";
import { imagesToPdf, photoDone } from "./images";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("image documents", () => {
  it("treats an explicit last-photo reply as done", () => {
    expect(photoDone("אין עוד")).toBe(true);
    expect(photoDone("that's all")).toBe(true);
    expect(photoDone("יש עוד תמונה")).toBe(false);
  });

  it("embeds photos into one PDF", async () => {
    const pdf = await imagesToPdf([
      { mime: "image/png", bytes: PNG },
      { mime: "image/png", bytes: PNG },
    ]);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
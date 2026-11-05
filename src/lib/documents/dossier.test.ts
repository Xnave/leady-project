import { describe, expect, it } from "vitest";
import { pendingFiles, selectIngestMessages } from "./dossier";

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

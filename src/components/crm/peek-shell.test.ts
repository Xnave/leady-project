import { describe, expect, it } from "vitest";
import type { LeadRowDTO } from "@/lib/crm/view";
import { shellFromRow } from "./peek-shell";

const row: LeadRowDTO = {
  id: "l1",
  name: "Dana",
  handle: "+972…",
  channel: "whatsapp",
  stage: "talking",
  stageSource: "auto",
  followUpReason: null,
  followUpAt: null,
  due: false,
  snoozedUntil: null,
  nextStepText: null,
  nextStepAt: null,
  stand: "Wants a visit",
  lastAt: "2026-10-05T12:00:00.000Z",
  lastBy: "them",
  windowHoursLeft: 12,
  windowClosed: false,
  unread: true,
  demo: false,
  intent: "visit",
};

describe("shellFromRow", () => {
  it("keeps list chrome and leaves chat empty for instant peek", () => {
    const dto = shellFromRow(row);
    expect(dto.id).toBe("l1");
    expect(dto.name).toBe("Dana");
    expect(dto.stand).toBe("Wants a visit");
    expect(dto.messages).toEqual([]);
    expect(dto.notes).toEqual([]);
    expect(dto.openTask).toBeNull();
    expect(dto.timeline).toEqual([]);
  });
});

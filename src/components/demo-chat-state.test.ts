import { describe, expect, it } from "vitest";
import { threadKey, shouldResetThread } from "./demo-chat-state";

const msg = (id: string) => ({ id, role: "lead", text: id });

describe("demo chat thread sync", () => {
  it("keeps the optimistic first message when the server re-sends the same (empty) thread", () => {
    expect(shouldResetThread(threadKey(undefined, []), threadKey(undefined, []))).toBe(false);
  });

  it("resets when the server has new messages or another lead", () => {
    expect(shouldResetThread(threadKey("l1", [msg("a")]), threadKey("l1", [msg("a"), msg("b")]))).toBe(true);
    expect(shouldResetThread(threadKey("l1", []), threadKey("l2", []))).toBe(true);
  });
});

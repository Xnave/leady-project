import { beforeEach, describe, expect, it, vi } from "vitest";

// A lead that isn't found ends the refresh after one read, so the read count is the refresh count.
const findFirst = vi.fn(async () => null);
vi.mock("@/lib/db", () => ({ prisma: { lead: { findFirst: (...a: unknown[]) => findFirst(...(a as [])) } } }));

const { batchLeadRefreshes, safeRefreshLeadState } = await import("./refresh");

describe("batchLeadRefreshes", () => {
  beforeEach(() => findFirst.mockClear());

  it("refreshes each lead once, after the work, however often it was asked", async () => {
    await batchLeadRefreshes(async () => {
      await safeRefreshLeadState("t1", "a");
      await safeRefreshLeadState("t1", "a");
      await safeRefreshLeadState("t1", "b");
      expect(findFirst).not.toHaveBeenCalled();
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("joins an outer batch instead of flushing early", async () => {
    await batchLeadRefreshes(async () => {
      await batchLeadRefreshes(async () => safeRefreshLeadState("t1", "a"));
      expect(findFirst).not.toHaveBeenCalled();
      await safeRefreshLeadState("t1", "a");
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("still refreshes when the work throws", async () => {
    await expect(
      batchLeadRefreshes(async () => {
        await safeRefreshLeadState("t1", "a");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("refreshes right away outside a batch", async () => {
    await safeRefreshLeadState("t1", "a");
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

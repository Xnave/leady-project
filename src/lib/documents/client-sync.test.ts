import { describe, expect, it, vi } from "vitest";
import { SYNC_PAGE, createdOnOrAfter, matchesStoredPhone, syncTenantClients } from "./client-sync";
import type { SmartClient, SmartClientHit } from "./smart-npv";

function hit(id: string, createdOn: string, phone1 = "0501111111", phone2 = "0522222222"): SmartClientHit {
  return { clientId: id, profile: { fullName: id }, createdOn, phone1, phone2 };
}

describe("syncTenantClients", () => {
  it("writes the cursor and stores nothing on the first run", async () => {
    const listClients = vi.fn();
    const saveCursor = vi.fn(async () => undefined);
    const saveClient = vi.fn(async () => undefined);
    const outcome = await syncTenantClients({
      now: new Date("2026-11-10T10:00:00Z"),
      cursorDate: null,
      client: { listClients, findClient: vi.fn(), upload: vi.fn() } as unknown as SmartClient,
      alreadyStored: async () => false,
      saveCursor,
      saveClient,
    });
    expect(outcome).toEqual({ firstRun: true, imported: 0, skipped: 0, failed: 0 });
    expect(saveCursor).toHaveBeenCalledWith("2026-11-10");
    expect(listClients).not.toHaveBeenCalled();
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("stores clients created on the cursor day or later, including a second page, and retries a failed GET", async () => {
    const first = Array.from({ length: SYNC_PAGE }, (_, index) =>
      hit(index === 0 ? "new-a" : index === 1 ? "fail-b" : `old-${index}`, index < 2 ? "2026-11-12" : "2026-11-09"),
    );
    const second = [hit("new-c", "2026-11-13", "0503333333", ""), hit("same-day", "2026-11-10")];
    const listClients = vi.fn(async (query: { offset?: number; rangeType?: number; from?: string; until?: string }) => {
      expect(query.rangeType).toBe(1);
      expect(query.from).toBe("10/11/2026");
      expect(query.until).toBe("15/11/2026");
      return query.offset === 0 ? first : second;
    });
    const findClient = vi.fn(async (query: { clientId?: string }) => {
      if (query.clientId === "fail-b") throw new Error("timeout");
      if (query.clientId === "new-a") return hit("new-a", "2026-11-12");
      if (query.clientId === "new-c") return hit("new-c", "2026-11-13", "0503333333", "0524444444");
      if (query.clientId === "same-day") return hit("same-day", "2026-11-10");
      throw new Error(`unexpected ${query.clientId}`);
    });
    const saved: string[] = [];
    const outcome = await syncTenantClients({
      now: new Date("2026-11-15T10:00:00Z"),
      cursorDate: "2026-11-10",
      client: { listClients, findClient, upload: vi.fn() } as unknown as SmartClient,
      alreadyStored: async (id) => id === "new-a",
      saveCursor: async () => undefined,
      saveClient: async (row) => {
        saved.push(row.smartClientId);
      },
    });
    expect(saved).toEqual(["new-c", "same-day"]);
    expect(outcome.imported).toBe(2);
    expect(outcome.failed).toBe(1);
    expect(findClient).toHaveBeenCalledWith({ clientId: "fail-b" });
    expect(findClient).toHaveBeenCalledWith({ clientId: "same-day" });
    expect(findClient.mock.calls.every((call) => "clientId" in (call[0] as object))).toBe(true);
    expect(createdOnOrAfter("2026-11-09", "2026-11-10")).toBe(false);
    expect(createdOnOrAfter("2026-11-10", "2026-11-10")).toBe(true);
    expect(createdOnOrAfter("2026-11-11", "2026-11-10")).toBe(true);
  });
});

describe("matchesStoredPhone", () => {
  it("matches either borrower phone", () => {
    const row = { phone1: "0501111111", phone2: "0522222222" };
    expect(matchesStoredPhone(row, "+972501111111")).toBe(true);
    expect(matchesStoredPhone(row, "0522222222")).toBe(true);
    expect(matchesStoredPhone(row, "+972509999999")).toBe(false);
  });
});

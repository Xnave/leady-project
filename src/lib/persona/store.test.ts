import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONA } from "./presets";
import { savePersona } from "./store";
import { PersonaConfigError } from "./validate";

function fakeDb(latestVersion: number | null) {
  const calls: { revision?: unknown; update?: unknown } = {};
  const db = {
    agent: {
      findFirst: vi.fn(async () => ({ id: "a1" }) as { id: string } | null),
      update: vi.fn((args: unknown) => {
        calls.update = args;
        return args;
      }),
    },
    agentConfigRevision: {
      findFirst: vi.fn(async () => (latestVersion == null ? null : { version: latestVersion })),
      create: vi.fn((args: unknown) => {
        calls.revision = args;
        return args;
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  return { db, calls };
}

describe("savePersona", () => {
  it("writes revision n+1 and persona only — never flowVersion", async () => {
    const { db, calls } = fakeDb(2);
    await savePersona(db as never, {
      tenantId: "t1",
      agentId: "a1",
      raw: { ...DEFAULT_PERSONA, agentName: "Noa" },
    });
    expect(db.agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", tenantId: "t1" } }),
    );
    expect(calls.revision).toMatchObject({
      data: { tenantId: "t1", agentId: "a1", kind: "persona", version: 3 },
    });
    const data = (calls.update as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toEqual(["persona"]);
  });

  it("first revision is version 1", async () => {
    const { db, calls } = fakeDb(null);
    await savePersona(db as never, { tenantId: "t1", agentId: "a1", raw: DEFAULT_PERSONA });
    expect(calls.revision).toMatchObject({ data: { version: 1 } });
  });

  it("invalid persona throws before writing", async () => {
    const { db } = fakeDb(0);
    await expect(
      savePersona(db as never, { tenantId: "t1", agentId: "a1", raw: { tone: "evil" } }),
    ).rejects.toThrow(PersonaConfigError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("agent from another tenant → not found", async () => {
    const { db } = fakeDb(0);
    db.agent.findFirst.mockResolvedValueOnce(null);
    await expect(
      savePersona(db as never, { tenantId: "t2", agentId: "a1", raw: DEFAULT_PERSONA }),
    ).rejects.toThrow(/not found/);
  });
});

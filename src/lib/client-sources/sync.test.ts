import { describe, expect, it } from "vitest";
import { createFakeConnector, FAKE_CLIENTS } from "./fake";
import {
  runSync,
  safeErrorMessage,
  SessionCache,
  type ContactUpsert,
  type SyncStore,
} from "./sync";
import { ConnectorAuthError } from "./types";

/** In-memory store keyed like the real unique index. It has no way to make a Lead. */
function memoryStore(leads: Record<string, string> = {}) {
  const contacts = new Map<string, ContactUpsert>();
  const store: SyncStore = {
    async upsertContacts(rows) {
      let created = 0;
      for (const r of rows) {
        const prev = contacts.get(r.externalId);
        if (!prev) created += 1;
        contacts.set(r.externalId, { ...r, leadId: r.leadId ?? prev?.leadId ?? null });
      }
      return { created, updated: rows.length - created };
    },
    async leadIdsByPhone(phones) {
      return new Map(phones.filter((p) => leads[p]).map((p) => [p, leads[p]]));
    },
    async existingExternalIds(ids) {
      return new Set(ids.filter((id) => contacts.has(id)));
    },
  };
  return { store, contacts };
}

const now = new Date("2026-11-05T00:00:00Z");

function input(connector = createFakeConnector(), store: SyncStore, config: unknown = {}) {
  return {
    key: "src-1",
    connector,
    credentials: { token: "t0ken-secret" },
    config: connector.parseConfig(config),
    store,
    updatedSince: null,
    now,
    sessions: new SessionCache(),
  };
}

describe("runSync", () => {
  it("pages everything, normalizes phones and counts problems", async () => {
    const { store, contacts } = memoryStore();
    const result = await runSync(input(undefined, store));
    expect(result.complete).toBe(true);
    expect(result.counts).toMatchObject({ fetched: 5, synced: 5, created: 5, noPhone: 1, invalidPhone: 1, pages: 3 });
    expect(contacts.get("c1")?.phone).toBe("972501234567");
    expect(contacts.get("c2")?.phone).toBe("972527654321");
    expect(contacts.get("c3")?.phoneStatus).toBe("missing");
    expect(contacts.get("c4")?.phoneStatus).toBe("invalid");
    expect(contacts.get("c1")?.dealDate).toEqual({ date: new Date("2019-03-10T00:00:00Z"), source: "signed_at", confidence: "high" });
    expect(contacts.get("c2")?.dealDate.confidence).toBe("low");
  });

  it("a repeat sync updates in place and creates no duplicates", async () => {
    const { store, contacts } = memoryStore();
    await runSync(input(undefined, store));
    const again = await runSync(input(undefined, store));
    expect(contacts.size).toBe(FAKE_CLIENTS.length);
    expect(again.counts.created).toBe(0);
    expect(again.counts.updated).toBe(FAKE_CLIENTS.length);
  });

  it("links an existing lead by phone and keeps the link on a later sync", async () => {
    const linked = memoryStore({ "972501234567": "lead-1" });
    const first = await runSync(input(undefined, linked.store));
    expect(linked.contacts.get("c1")?.leadId).toBe("lead-1");
    expect(linked.contacts.get("c5")?.leadId).toBe("lead-1");
    expect(first.counts.linkedLeads).toBe(2);
  });

  it("skips clients matching a skip rule", async () => {
    const { store, contacts } = memoryStore();
    const result = await runSync(input(undefined, store, { skip: [{ field: "archived", in: ["1"] }] }));
    expect(result.counts.skipped).toBe(1);
    expect(contacts.has("c4")).toBe(false);
  });

  it("re-authenticates once when the session expires mid-sync", async () => {
    let auths = 0;
    const connector = createFakeConnector({ expireOnceAtCursor: "2", onAuthenticate: () => (auths += 1) });
    const { store, contacts } = memoryStore();
    const result = await runSync(input(connector, store));
    expect(result.complete).toBe(true);
    expect(auths).toBe(2);
    expect(contacts.size).toBe(5);
  });

  it("dry run counts and writes nothing", async () => {
    const { store, contacts } = memoryStore();
    const result = await runSync({ ...input(undefined, store), dryRun: true, maxPages: 1 });
    expect(contacts.size).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.counts.synced).toBe(2);
    expect(result.fieldKeys).toEqual(["opened_at", "signed_at"]);
  });

  it("surfaces bad credentials as an auth error", async () => {
    const { store } = memoryStore();
    await expect(runSync({ ...input(undefined, store), credentials: { token: "wrong" } })).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("uses the tenant's deal-date ladder", async () => {
    const { store, contacts } = memoryStore();
    await runSync(input(undefined, store, { dealDate: [{ field: "opened_at", offsetMonths: 0, confidence: "medium" }] }));
    expect(contacts.get("c1")?.dealDate.date).toBeNull();
    expect(contacts.get("c2")?.dealDate).toEqual({ date: new Date("2017-01-15T00:00:00Z"), source: "opened_at", confidence: "medium" });
  });
});

describe("keep rules", () => {
  it("stores only new clients inside the deal-date window", async () => {
    const { store, contacts } = memoryStore();
    const result = await runSync(input(undefined, store, { keep: { dealYearsAgo: { min: 7, max: 8 } } }));
    // c1 signed 03/2019, ~7.7 years before `now`; c2 ~9.6 years; the rest have no deal date.
    expect([...contacts.keys()]).toEqual(["c1"]);
    expect(result.counts.outOfScope).toBe(4);
    expect(result.counts.synced).toBe(1);
  });

  it("stores only new clients whose field is in the allowed list", async () => {
    const { store, contacts } = memoryStore();
    await runSync(input(undefined, store, { keep: { fields: [{ field: "archived", in: ["1"] }] } }));
    expect([...contacts.keys()]).toEqual(["c4"]);
  });

  it("ignores a field rule with an empty list", async () => {
    const { store, contacts } = memoryStore();
    await runSync(input(undefined, store, { keep: { fields: [{ field: "archived", in: [] }] } }));
    expect(contacts.size).toBe(5);
  });

  it("never drops a stored client that stops matching; it keeps updating", async () => {
    const { store, contacts } = memoryStore();
    await runSync(input(undefined, store));
    expect(contacts.size).toBe(5);
    const renamed = FAKE_CLIENTS.map((c) => (c.externalId === "c2" ? { ...c, name: "Avi Renamed" } : c));
    const result = await runSync(input(createFakeConnector({ clients: renamed }), store, { keep: { dealYearsAgo: { min: 7, max: 8 } } }));
    expect(contacts.size).toBe(5);
    expect(contacts.get("c2")?.name).toBe("Avi Renamed");
    expect(result.counts.outOfScope).toBe(0);
    expect(result.counts.updated).toBe(5);
  });

  it("leaves a stored contact untouched when freezeAfterFirstSync is on", async () => {
    const { store, contacts } = memoryStore();
    await runSync(input(undefined, store, { freezeAfterFirstSync: true }));
    expect(contacts.get("c2")?.name).toBe("Avi Cohen");
    const renamed = FAKE_CLIENTS.map((c) => (c.externalId === "c2" ? { ...c, name: "Avi Renamed" } : c));
    const result = await runSync(input(createFakeConnector({ clients: renamed }), store, { freezeAfterFirstSync: true }));
    expect(contacts.get("c2")?.name).toBe("Avi Cohen");
    expect(result.counts.created).toBe(0);
    expect(result.counts.skipped).toBe(5);
  });
});

describe("safeErrorMessage", () => {
  it("masks credential values and api_key query params", () => {
    const msg = safeErrorMessage(new Error("GET https://x/clients/list?api_key=abcd1234&limit=1 failed for abcd1234"), ["abcd1234"]);
    expect(msg).not.toContain("abcd1234");
    expect(safeErrorMessage(new ConnectorAuthError("bad"), [])).toBe("auth: bad");
  });
});

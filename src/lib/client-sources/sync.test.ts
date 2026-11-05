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

describe("safeErrorMessage", () => {
  it("masks credential values and api_key query params", () => {
    const msg = safeErrorMessage(new Error("GET https://x/clients/list?api_key=abcd1234&limit=1 failed for abcd1234"), ["abcd1234"]);
    expect(msg).not.toContain("abcd1234");
    expect(safeErrorMessage(new ConnectorAuthError("bad"), [])).toBe("auth: bad");
  });
});

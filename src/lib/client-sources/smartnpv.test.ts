import { describe, expect, it } from "vitest";
import { createSmartNpvConnector, mapSmartNpvRow, SMARTNPV_DEFAULT_DEAL_DATE } from "./smartnpv";
import { ConnectorAuthError } from "./types";

const ROW = {
  uuid: "u-1",
  firstname_1: "דנה",
  lastname_1: "לוי",
  phone_1: "050-1234567",
  id_1: "123456782",
  birth_date_1: "01/01/1980",
  salary_1: "25000",
  transaction_bank: "12",
  status_id: "7",
  archive: "0",
  archive_time: "0000-00-00 00:00:00",
  last_date_execution: "",
  client_contract_date: "10/02/2018",
  created: "01/01/2018 10:00",
  modified: "03/04/2024 09:00",
};

function fakeFetch(pages: Record<string, unknown>[][], total?: number) {
  const calls: URL[] = [];
  const impl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const page = pages[offset / limit] ?? [];
    return new Response(JSON.stringify({ response: true, responseClientsCount: total, responseClients: page }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("mapSmartNpvRow", () => {
  it("keeps catalog fields only, never id numbers, birthdays or income", () => {
    const rec = mapSmartNpvRow(ROW)!;
    expect(rec.externalId).toBe("u-1");
    expect(rec.name).toBe("דנה לוי");
    expect(rec.phone).toBe("050-1234567");
    expect(rec.fields).not.toHaveProperty("id_1");
    expect(rec.fields).not.toHaveProperty("birth_date_1");
    expect(rec.fields).not.toHaveProperty("salary_1");
    expect(rec.fields).not.toHaveProperty("last_date_execution");
    expect(rec.fields.transaction_bank).toBe("12");
    expect(rec.updatedAt?.toISOString()).toBe("2024-04-03T00:00:00.000Z");
  });

  it("drops rows with no uuid", () => {
    expect(mapSmartNpvRow({ firstname_1: "x" })).toBeNull();
  });
});

describe("smartnpv connector", () => {
  const noSleep = async () => {};

  it("pages clients/list by offset and stops on a short page", async () => {
    const { impl, calls } = fakeFetch([
      Array.from({ length: 10 }, (_, i) => ({ ...ROW, uuid: `a${i}` })),
      [{ ...ROW, uuid: "b0" }],
    ]);
    const c = createSmartNpvConnector({ fetchImpl: impl, sleep: noSleep });
    const config = c.parseConfig({ pageSize: 10 });
    const session = await c.authenticate({ apiKey: "secret-key-123" }, config);
    const first = await c.fetchClients(session, config, { cursor: null, updatedSince: null });
    expect(first.clients).toHaveLength(10);
    expect(first.nextCursor).toBe("10");
    const second = await c.fetchClients(session, config, { cursor: first.nextCursor, updatedSince: null });
    expect(second.clients).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(calls[0].pathname).toBe("/api/v2/clients/list");
    expect(calls[0].searchParams.get("range_type")).toBe("1");
    expect(calls[0].searchParams.get("from")).toBe("01/01/2000");
  });

  it("asks for modified clients from the day before an incremental sync", async () => {
    const { impl, calls } = fakeFetch([[]]);
    const c = createSmartNpvConnector({ fetchImpl: impl, sleep: noSleep });
    const config = c.parseConfig({});
    const session = await c.authenticate({ apiKey: "secret-key-123" }, config);
    await c.fetchClients(session, config, { cursor: null, updatedSince: new Date("2026-11-04T08:00:00Z") });
    expect(calls[0].searchParams.get("range_type")).toBe("2");
    expect(calls[0].searchParams.get("from")).toBe("03/11/2026");
  });

  it("stops when the reported count is reached even on a full page", async () => {
    const { impl } = fakeFetch([Array.from({ length: 10 }, (_, i) => ({ ...ROW, uuid: `a${i}` }))], 10);
    const c = createSmartNpvConnector({ fetchImpl: impl, sleep: noSleep });
    const config = c.parseConfig({ pageSize: 10 });
    const page = await c.fetchClients(await c.authenticate({ apiKey: "secret-key-123" }, config), config, { cursor: null, updatedSince: null });
    expect(page.nextCursor).toBeNull();
  });

  it("reports a rejected key as an auth error", async () => {
    const impl = (async () => new Response(JSON.stringify({ response: false, responseMessage: "Invalid api key" }))) as typeof fetch;
    const c = createSmartNpvConnector({ fetchImpl: impl, sleep: noSleep });
    const config = c.parseConfig({});
    const session = await c.authenticate({ apiKey: "secret-key-123" }, config);
    await expect(c.fetchClients(session, config, { cursor: null, updatedSince: null })).rejects.toBeInstanceOf(ConnectorAuthError);
    await expect(c.authenticate({ apiKey: "" }, config)).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("derives deal_date from the default ladder", () => {
    const c = createSmartNpvConnector();
    const config = c.parseConfig({});
    expect(config.dealDate).toEqual(SMARTNPV_DEFAULT_DEAL_DATE);
    const out = c.derive(mapSmartNpvRow(ROW)!, config, new Date());
    // last_date_execution empty, archive_time gated off by default → contract date + 3 months
    expect(out.dealDate).toEqual({ date: new Date("2018-05-10T00:00:00Z"), source: "client_contract_date", confidence: "medium" });
    expect(out.fields.deal_year).toBe(2018);
  });

  it("follows the tenant's own ladder and completed statuses", () => {
    const c = createSmartNpvConnector();
    const config = c.parseConfig({
      dealDate: [
        { field: "archive_time", confidence: "medium_high", whenField: "status_id", whenIn: ["7"] },
        { field: "created", offsetMonths: 6, confidence: "low" },
      ],
    });
    const archived = mapSmartNpvRow({ ...ROW, archive_time: "20/08/2019 12:00" })!;
    expect(c.derive(archived, config, new Date()).dealDate).toEqual({
      date: new Date("2019-08-20T00:00:00Z"),
      source: "archive_time",
      confidence: "medium_high",
    });
    const open = mapSmartNpvRow({ ...ROW, status_id: "2", archive_time: "20/08/2019" })!;
    expect(c.derive(open, config, new Date()).dealDate).toEqual({
      date: new Date("2018-07-01T00:00:00Z"),
      source: "created",
      confidence: "low",
    });
  });

  it("rejects a bad tenant config", () => {
    const c = createSmartNpvConnector();
    expect(() => c.parseConfig({ dealDate: [{ field: "x", confidence: "sure" }] })).toThrow();
    expect(() => c.parseConfig({ dealDate: [] })).toThrow();
  });
});

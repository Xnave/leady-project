import { describe, expect, it, vi } from "vitest";
import { createHttpSmartClient, mapSmartProfile, slotNeedsUpload, toSmartPhone } from "./smart-npv";

const CLIENT = {
  uuid: "12345678-1234-1234-1234-1234567891099",
  firstname_1: "Dana",
  lastname_1: "Levi",
  id_1: "123456782",
  phone_1: "0500000000",
  firstname_2: "Noam",
  lastname_2: "Levi",
  id_2: "209876543",
  phone_2: "0521111111",
  liabilities: [{ balance: "300000" }],
  current_mortgage: "0",
};

describe("mapSmartProfile", () => {
  it("reads borrower 1 from a clients/get record", () => {
    expect(mapSmartProfile(CLIENT)).toMatchObject({
      nationalId: "123456782",
      fullName: "Dana Levi",
      phone: "0500000000",
      hasLoans: true,
      employment: "",
    });
  });

  it("uses borrower 2 when the looked-up id is theirs", () => {
    expect(mapSmartProfile(CLIENT, "209876543")).toMatchObject({
      nationalId: "209876543",
      fullName: "Noam Levi",
      phone: "0521111111",
    });
  });

  it("decodes status_report and keeps empty liabilities unknown", () => {
    const profile = mapSmartProfile({
      ...CLIENT,
      status_report_1: "2",
      status_report_2: "0",
      liabilities: [],
      current_mortgage: "0",
    });
    expect(profile).toMatchObject({
      employment: "salaried",
      employmentLabel: "מגזר ציבורי",
      loans: "unknown",
      hasLoans: false,
    });
    expect(profile.borrowers).toEqual([
      expect.objectContaining({ slot: "1", employment: "salaried" }),
      expect.objectContaining({ slot: "2", employment: "self_employed", statusReport: "0" }),
    ]);
  });

  it("does not read an empty status report as self-employed", () => {
    expect(mapSmartProfile({ ...CLIENT, status_report_1: "", liabilities: [] }).employment).toBe("");
    expect(mapSmartProfile({ ...CLIENT, status_report_1: "0" }).employment).toBe("self_employed");
    expect(mapSmartProfile({ ...CLIENT, id_2: CLIENT.id_1 }).borrowers).toHaveLength(1);
  });

  it("still reads the older field names", () => {
    expect(
      mapSmartProfile({
        tz: "123456782",
        employmentType: "self_employed",
        loans: [{ id: "1" }],
        name: "Dana Levi",
      }),
    ).toMatchObject({
      nationalId: "123456782",
      employment: "self_employed",
      hasLoans: true,
      fullName: "Dana Levi",
    });
  });
});

describe("upload rules", () => {
  it("refuses a second upload once a slot has a remote id", () => {
    expect(slotNeedsUpload({ status: "missing", remoteId: "" })).toBe(true);
    expect(slotNeedsUpload({ status: "uploaded", remoteId: "id.pdf" })).toBe(false);
    expect(slotNeedsUpload({ status: "missing", remoteId: "id.pdf" })).toBe(false);
    expect(toSmartPhone("+972 50-000-0000")).toBe("0500000000");
  });
});

describe("createHttpSmartClient", () => {
  it("gets a client, lists clients, and uploads file_name plus the file", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/clients/get")) {
        expect(href).toContain("type=phone");
        expect(href).toContain("phone=0500000000");
        expect(href).toContain("api_key=secret");
        expect(init?.body).toBeUndefined();
        return new Response(JSON.stringify({ response: true, responseCode: 0, responseClientFields: CLIENT }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.includes("/clients/list")) {
        expect(href).toContain("limit=1");
        expect(href).toContain("range_type=2");
        return new Response(JSON.stringify({ response: true, responseCode: 0, responseClients: [CLIENT] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(href).toContain("/api/v2/clients/upload_document");
      expect(init?.method).toBe("POST");
      const form = init?.body as FormData;
      expect(form.get("file_name")).toBe("id.pdf");
      expect(form.get("uuid")).toBe(CLIENT.uuid);
      expect(form.get("docType")).toBeNull();
      expect(form.get("file")).toBeTruthy();
      expect(JSON.stringify(init?.headers ?? {})).not.toContain("docType");
      return new Response(JSON.stringify({ response: true, responseCode: 0, message: "File saved successfully" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createHttpSmartClient({
      baseUrl: "https://www.snpv.co.il",
      apiKey: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const found = await client.findClient({ phone: "+972500000000" });
    expect(found?.clientId).toBe(CLIENT.uuid);
    expect(found?.profile.fullName).toBe("Dana Levi");
    const listed = await client.listClients({ limit: 1, rangeType: 2 });
    expect(listed).toHaveLength(1);
    const uploaded = await client.upload({
      clientId: CLIENT.uuid,
      docType: "id_card",
      filename: "id.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("pdf"),
    });
    expect(uploaded.remoteId).toBe("id.pdf");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not call the API for a file type SmartNPV cannot delete", async () => {
    const fetchImpl = vi.fn();
    const client = createHttpSmartClient({
      baseUrl: "https://www.snpv.co.il/api/v2",
      apiKey: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.upload({
        clientId: CLIENT.uuid,
        docType: "id_card",
        filename: "scan.heic",
        mime: "image/heic",
        bytes: Buffer.from("heic"),
      }),
    ).rejects.toThrow("unsupported_type");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when clients/get says the client is missing", async () => {
    let href = "";
    const fetchImpl = vi.fn(async (url: string) => {
      href = url;
      return new Response(JSON.stringify({ response: false, responseCode: 1 }), { status: 200 });
    });
    const client = createHttpSmartClient({
      baseUrl: "https://www.snpv.co.il",
      apiKey: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.findClient({ nationalId: "123456782" })).toBeNull();
    expect(href).toContain("type=id_number");
    expect(href).toContain("id_number=123456782");
  });
});

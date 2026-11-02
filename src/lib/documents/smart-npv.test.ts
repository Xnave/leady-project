import { describe, expect, it, vi } from "vitest";
import { createHttpSmartClient, mapSmartProfile } from "./smart-npv";

describe("mapSmartProfile", () => {
  it("reads the field names SmartNPV is likely to send", () => {
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

describe("createHttpSmartClient", () => {
  it("posts lookup and upload to the configured base URL", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/clients/lookup")) {
        return new Response(JSON.stringify({ clientId: "s1", profile: { tz: "123456782", name: "Dana" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ remoteId: "file-9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createHttpSmartClient({
      baseUrl: "https://smart.example",
      apiKey: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const found = await client.findClient({ phone: "+972500000000" });
    expect(found?.clientId).toBe("s1");
    expect(found?.profile.nationalId).toBe("123456782");
    const uploaded = await client.upload({
      clientId: "s1",
      docType: "id_card",
      filename: "id.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("pdf"),
    });
    expect(uploaded.remoteId).toBe("file-9");
  });
});

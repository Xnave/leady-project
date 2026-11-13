/**
 * Create one Smart NPV client for the sync check. Does not touch the local database.
 *
 * Sync now imports a client when Smart NPV's created date is the cursor day
 * or later (Asia/Jerusalem). A client created today is included on the next
 * Sync now today. This script only creates the client.
 *
 * Usage:
 *   SMARTNPV_API_KEY=... npx tsx scripts/smartnpv-create-test-client.ts
 *
 * The key is the tenant's Smart NPV API key. It is not printed.
 * SMARTNPV_BASE_URL defaults to https://www.snpv.co.il.
 */

const HOST = (process.env.SMARTNPV_BASE_URL || "https://www.snpv.co.il").replace(/\/$/, "");
const API_KEY = process.env.SMARTNPV_API_KEY?.trim() ?? "";

const client = {
  firstname_1: "בדיקה",
  lastname_1: "סנכרון",
  phone_1: "0526595639",
  email_1: "naveine96@gmail.com",
  id_1: "205707714",
  status_report_1: "1",
  income_1: "12000",
  note_details: "Zapidly sync check",
};

async function createTestClient() {
  if (!API_KEY) {
    console.error("Set SMARTNPV_API_KEY to the tenant Smart NPV key.");
    process.exit(1);
  }
  if (HOST !== "https://www.snpv.co.il") {
    console.error("Refusing to send the key to a host other than https://www.snpv.co.il");
    process.exit(1);
  }

  const res = await fetch(`${HOST}/api/v2/clients/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: API_KEY, params: client }),
  });
  const body = (await res.json().catch(() => null)) as {
    response?: boolean;
    responseID?: string;
    responseMessage?: string;
    responseCode?: number;
  } | null;

  if (!res.ok || !body?.response || !body.responseID) {
    console.error(
      JSON.stringify({
        status: res.status,
        response: body?.response ?? false,
        responseCode: body?.responseCode ?? null,
        responseMessage: body?.responseMessage ?? "create failed",
      }),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      uuid: body.responseID,
      responseMessage: body.responseMessage ?? "",
    }),
  );
}

createTestClient().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "create failed");
  process.exit(1);
});

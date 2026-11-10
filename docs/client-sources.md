# Client sources

Client campaigns PR 2 (ClickUp `z8rp3ff7x5`). A tenant's **own CRM** is synced into `Contact` rows so later PRs can pick campaign audiences from it. Contacts are not leads: a sync never creates a `Lead`, never changes lead counts or digest items, and never touches the pipeline.

## Pieces

| Piece | Where |
| --- | --- |
| Connector interface | `src/lib/client-sources/types.ts` |
| Registered connectors | `src/lib/client-sources/registry.ts` (Smart NPV; plus `fake` outside production) |
| Smart NPV connector | `src/lib/client-sources/smartnpv.ts` (field catalog, paging, deal date). HTTP goes through `fetchSmartClientList` in `src/lib/documents/smart-npv.ts`, the one module that talks to Smart NPV and only to `www.snpv.co.il`. |
| Generic sync (pure, store injected) | `src/lib/client-sources/sync.ts` |
| Prisma store, encryption, public view | `src/lib/client-sources/store.ts` |
| Inngest | `client-source-sync` (event `client-sources/sync.requested`, one step per page, one run per source) and `client-sources-daily` (04:00 Asia/Jerusalem, incremental) in `src/inngest/functions.ts` |
| Admin screen | `/admin/client-sources/[tenantId]` (link on each tenant row in `/admin`) |
| Clients tab | `/clients`, owner/admin, shown only when the tenant has a source |

## Adding a CRM

Write a connector (`kind`, `credentialsSchema`, `credentialFields`, `parseConfig`, `authenticate`, `fetchClients`, `fieldCatalog`, `derive`) and add it to `CONNECTORS` in `registry.ts`. Keep only the fields in `fieldCatalog`; never store id numbers, birthdays, income or amounts. Test it with a fake `fetch`, like `smartnpv.test.ts`.

## Credentials

Stored AES-256-GCM encrypted (`src/lib/crypto.ts`) on `ClientSource.credentialsEnc`. They are decrypted only inside `store.ts` to call the connector.

A connector can declare `sharedCredentials(tenantId)`: credentials the tenant already saved elsewhere. Smart NPV reads the key from the tenant's documents capability instance (Documents settings). When that key exists it wins, the source keeps `credentialsEnc = ""`, and the admin screen shows a note instead of the key field, so a tenant has one Smart NPV key in one place. Without a documents key, the admin enters it on the source. API responses carry `credentialKeys` (names) only. Error text is masked with `safeErrorMessage` before it is stored or returned.

## Smart NPV settings (per tenant, JSON on the admin screen)

```json
{
  "defaultCountryCode": "972",
  "skip": [{ "field": "archive", "in": ["1"] }],
  "pageSize": 100,
  "dealDate": [
    { "field": "last_date_execution", "offsetMonths": 0, "confidence": "high" },
    { "field": "archive_time", "offsetMonths": 0, "confidence": "medium_high", "whenField": "status_id", "whenIn": ["<completed status ids>"] },
    { "field": "client_contract_date", "offsetMonths": 3, "confidence": "medium" },
    { "field": "last_documentation", "offsetMonths": 0, "confidence": "medium" },
    { "field": "created", "offsetMonths": 3, "confidence": "low" }
  ]
}
```

`dealDate` is a ladder: the first rung with a usable date wins, and the contact keeps the source field and confidence. A rung with `whenField` and an empty `whenIn` never matches, so the `archive_time` rung is off until the tenant's "completed" status ids are known (PR 0 still-open item 2).

## Sync modes

- **full** (admin or Clients tab "sync now"): every client, created since 2000.
- **incremental** (daily cron): clients modified since the last successful sync, minus one day.
- **test** (admin): first page only, writes nothing, returns counts and field names.

Without Inngest (local dev), "sync now" falls back to syncing inside the request. In production it fails instead.

## Known gaps

- A client deleted in the CRM stays as a `Contact` (incremental sync sees changes, not deletions).

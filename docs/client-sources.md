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
| Inngest | `client-source-sync` (event `client-sources/sync.requested`, one step per page, one run per source) and `client-sources-hourly` (hourly incremental) in `src/inngest/functions.ts` |
| Admin screen | `/admin/client-sources/[tenantId]` (link on each tenant row in `/admin`) |
| Clients tab | `/clients`, owner/admin, shown only when the tenant has a source |

## Adding a CRM

Write a connector (`kind`, `credentialsSchema`, `credentialFields`, `parseConfig`, `authenticate`, `fetchClients`, `fieldCatalog`, `derive`) and add it to `CONNECTORS` in `registry.ts`. `Contact.mapped` is what readers use. `Contact.raw` is the CRM row when `storeRaw` is on. Mark phone keys with `phoneKey`. Test it with a fake `fetch`, like `smartnpv.test.ts`.

## Credentials

Stored AES-256-GCM encrypted (`src/lib/crypto.ts`) on `ClientSource.credentialsEnc`. They are decrypted only inside `store.ts` to call the connector. The Smart NPV key lives on that source. Document upload reads it from there. API responses carry `credentialKeys` (names) only. Error text is masked with `safeErrorMessage` before it is stored or returned.

## Smart NPV settings (per tenant, JSON on the admin screen)

```json
{
  "defaultCountryCode": "972",
  "skip": [{ "field": "archive", "in": ["1"] }],
  "keep": {
    "dealYearsAgo": { "min": 3, "max": 7 },
    "fields": [{ "field": "status_id", "in": ["<relevant status ids>"] }]
  },
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

`keep` limits the sync to clients relevant for campaigns. Every part that is set must match: the deal date is `min` to `max` years ago (a client with no deal date fails), and each field rule's value is in its list (an empty list is ignored). Both are off by default. A **new** client that fails is not stored and is counted as `outOfScope`. A client **already stored** is never removed when it stops matching. With `freezeAfterFirstSync` off it keeps updating. Smart NPV turns that flag on, so a stored contact stays as first synced. `storeRaw` defaults on. The status ids are tenant-specific; read them from the admin "test" result (`status_id`, `status_title`).

`ClientSource.syncSince` is set to now on the first connect. It means "sync contacts from this moment." Smart NPV uses the Asia/Jerusalem calendar day and asks the list from the start of that day. Moving `syncSince` earlier and running a full sync is how older contacts get stored.

`skip` works the same way for stored clients: a **new** client matching a skip rule is not stored (counted as skipped), and a client **already stored** keeps updating with `skipped = true`, so audiences leave it out while its history stays. It flips back when the rule stops matching.

A contact's `leadId` (the "also a lead" link, matched by phone) is kept while the phone is unchanged. When the phone changes, the link is set from the new phone, or cleared when no lead has it.

Sessions are cached per source while a process is warm, keyed on a hash of the credentials, so a newly saved key is used on the next test or sync. A rejected key (`ConnectorAuthError` during a fetch) drops the session and retries once, like an expired session.

`dealDate` is a ladder: the first rung with a usable date wins, and the contact keeps the source field and confidence. A rung with `whenField` and an empty `whenIn` never matches, so the `archive_time` rung is off until the tenant's "completed" status ids are known (PR 0 still-open item 2).

## Sync modes

- **full** (admin or Clients tab "sync now"): clients from `syncSince`. It does not move that timestamp. With no `syncSince`, Smart NPV falls back to 1 January 2000.
- **incremental** (hourly cron): clients modified since the last successful sync, minus one day, and not before `syncSince`.
- **test** (admin): first page only, writes nothing, returns counts and field names.

Without Inngest (local dev), "sync now" falls back to syncing inside the request. In production it fails instead.

## Known gaps

- A client deleted in the CRM stays as a `Contact` (incremental sync sees changes, not deletions).

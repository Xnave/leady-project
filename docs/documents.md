# Documents capability

A lead sends files on WhatsApp, Instagram, or `/demo`. The agent matches the sender to a Smart NPV client, opens a checklist from JSON rules, checks each file, and uploads an accepted file once. The checklist is data on the tenant's `documents` capability instance. The Smart NPV key, the connection test, and the client sync live on the tenant's Smart NPV client source. A sender matches a stored contact by the primary phone and the phone keys on `Contact.mapped`. A new document type that uses a check the engine already knows is a JSON edit. A new kind of check is a code change in one place.

File formats (PDF, PNG, JPG, JPEG) are not document types. They live only in `src/lib/documents/file-types.ts`.

## Dictionary

A slot is one item the client still owes. A `LeadDocument` is one file that arrived.

### The case

| Term | Meaning |
|---|---|
| Dossier | The case row for one lead. It holds the Smart NPV client id, the profile, the slots, and a status. |
| `needs_id` | No Smart NPV client matched yet. The agent asks for a national id, or says that id was not found. The checklist has no slots. The same id on a later message does not rewrite the row. |
| `gathering` | A checklist exists and at least one slot is still missing. |
| `complete` | Every slot is uploaded. |
| `blocked` | Legacy only. New dossiers stay on `gathering` after repeated rejects. |
| Profile | Facts copied off the Smart NPV client: employment, loans, national id, name, phone. Requirements and checks read only these keys. |
| `lookupId` | The national id the sender typed while the dossier is `needs_id`. Stored on the profile so a repeat of that id can skip a rewrite. |

### The checklist

| Term | Meaning |
|---|---|
| Rules | The JSON document: stages, document types, and requirements. Saved on the tenant's documents capability instance. `MORTGAGE_RULES` is the default when a tenant has not saved rules yet. |
| Stage | A named group of documents, such as identity, then income, then banking. The `stages` array is the ask order. |
| `activeStage` | The stage of the first slot that is still missing. The agent asks for that stage's missing documents together. |
| Document type (`docType`) | A kind of document the checklist knows, such as `id_card` or `bank_statement`. It has labels, fields, and checks. This is separate from the file format. |
| Requirement | One line that opens slots: which document type, which stage, how many files (`count`, default 1), and an optional `when`. The mortgage generator does this from borrower facts instead of two income rows. |
| `when` | A condition on the profile. Omitted means the requirement always opens. Ops are `eq`, `neq`, `gt`, `truthy`, and `all` / `any`. |
| Slot | One file the client owes. `count: 3` on bank statements opens `bank_statement#0`, `#1`, and `#2`. Status is `missing` or `uploaded`. |
| Slot id | `<docType>#<scope>#<index>` when the checklist is built from borrower facts. Scope is the borrower (`1` or `2`) or the bank-account id. A saved requirements list that has no borrower facts still uses `<docType>#<index>`. |
| Check | A rule on one extracted field. Checks run in order. The first failure rejects the file. The reason key is the op: `field_present`, `matches_profile`, `date_within_months`, `min_items`. |
| Field | A name the vision step copies off the file before checks run, such as `nationalId` or `periodEnd`. Dates are `YYYY-MM-DD`. |
| `lastReason` | Why the latest file for that slot was rejected. The sender hears the lead sentence. The CRM checklist shows the operator label. |
| `failCount` | How many times that slot has been rejected. After `maxRejectTries` (default 5), the agent starts a cool-off and asks whether to escalate to a consultant. |

### A received file

| Term | Meaning |
|---|---|
| `LeadDocument` | One received file. Status is `stored`, `rejected`, or `uploaded`. Several files can fail against the same slot. Each file is its own row. |
| `stored` | The checks accepted the file and the ciphertext is still here because the Smart NPV upload has not succeeded. The next message retries it. |
| `rejected` | The file will not be uploaded. The bytes are cleared. `validation.reason` says why. |
| `uploaded` | On a `LeadDocument`, Smart NPV accepted the file and the bytes are cleared. On a slot, that checklist item is done. `remoteId` is the id Smart NPV returned, or the file name when the API returns none. |
| `bytesEnc` | The encrypted file bytes. Cleared after a successful upload or a rejection. A `stored` row with no bytes is marked `rejected` so later turns stop retrying it. |

### The turn

| Term | Meaning |
|---|---|
| Ingest | The work of one turn that has a file or a checklist to advance: match the client, reject a bad file format, judge the file, upload. The effect id is `ingest_document`. |
| Judge | Compare the extracted fields to the open slots. The vision step names the type and pulls fields. `judgeFile` accepts or rejects. The slot stays missing until Smart NPV accepts the bytes. |
| Open slot | A slot that is still `missing`. The vision step is shown only those types. |
| `unsupported_type` | The mime or extension is outside PDF, PNG, JPG, and JPEG. The file is rejected before download and before the model runs. |

## Reject tries and cool-off

Repeated rejects on the same slot do **not** auto-hand the chat to a person. After `maxRejectTries` (default 5), the agent starts a cool-off of `rejectCooldownMinutes` (default 5), tells the customer to wait, and asks whether to escalate to a consultant. Yes opens a HITL task; no (or "I'll try again") keeps the cool-off. Both values are editable on onboard and in document settings.

## Where it lives

| Piece | File |
|---|---|
| Rules shape, conditions, `parseRules`, `requiredSlots` | `src/lib/documents/rules.ts` |
| Default mortgage checklist and per-borrower slots | `src/lib/documents/mortgage-rules.ts` |
| Employment codes, loans, accounts, customer answers | `src/lib/documents/facts.ts` |
| Saved config (URL, encrypted key, rules, reject tries / cool-off) | `src/lib/flow/document-config.ts` → `CapabilityInstance` |
| Check execution and slot judgement | `src/lib/documents/validate.ts` |
| Vision extract (names the type, pulls fields) | `src/lib/documents/extract.ts` |
| Turn: match, reject type, judge, upload | `src/lib/documents/dossier.ts` |
| Talk hook (no domain names in the interpreter) | `src/lib/flow/capabilities/documents.ts` |

Ops paste the rules JSON in the document settings on the agent. Blank rules on first save use `MORTGAGE_RULES`. `parseRules` rejects an unknown check, a requirement whose `docType` or `stage` is missing, and a stage with no id. The save fails closed.

## What a profile can decide

`mapSmartProfile` in `src/lib/documents/smart-npv.ts` is the only writer of profile keys. A `when` condition and a `matches_profile` check can read these keys:

| Key | Meaning |
|---|---|
| `employment` | First borrower's decoded employment: `salaried`, `self_employed`, or `both`. Empty when `status_report_1` is empty or is a code the two lists do not use. |
| `employmentCode` | The raw `status_report` code for that borrower. |
| `employmentLabel` | The Hebrew label for that code, from the logged-in Smart NPV guide (מעמד תעסוקתי). |
| `borrowers` | One entry per borrower. A second person counts when `id_2` differs from `id_1`, or when `id_2` is empty and `phone_2` is set. Each entry has its own code, employment, and, after the customer answers, `employmentSource: "customer"` and `employmentAnsweredAt`. |
| `loans` | `known`, `none`, or `unknown`. Nonempty `liabilities`, or `current_mortgage` above 0, is `known`. An empty `liabilities` array is `unknown`, so the agent asks. `none` is only a customer answer, or an explicit `hasLoans: false`. |
| `hasLoans` | True only when `loans` is `known`. |
| `accounts` | One `{ id }` per `banks_accounts` row that has an id. An empty list still opens one statement. The agent does not ask whether accounts exist. |
| `accountsKnown` | `known` when those rows exist. An empty list stays `unknown` and still opens one statement. |
| `firstHome` | `true`, `false`, or `unknown`. Smart NPV's `transaction_type` does not set this. Unknown still opens the income list; `false` removes income and banking and flags the advisor. |
| `advisorFlag` | Set for a customer answer of אחר, or `firstHome: false`. The dossier opens one advisor task. Employment `both`, including code `5`, does not set this. |
| `secondBorrower` | `no` after the customer says they are the only borrower. Absent while that question is still open and the file has one person. A second Smart NPV person skips the question. |
| `nationalId` | Borrower id (`id_1`, or `id_2` when the sender's id matches borrower 2). |
| `fullName` | That borrower's name. |
| `phone` | That borrower's phone. |

Employment codes, from the guide table copied in `haiku-code/cia-knowledge` `snpv_lookups.md`. An empty value is not code `0`. That empty-string quirk is documented for `transaction_type` (מחזור) only.

| Code | Meaning | Checklist |
|---|---|---|
| 1, 2 | שכיר/ה, מגזר ציבורי | Three payslips. |
| 3 | שכיר/ה בעל שליטה | Three payslips and the controlling-shareholder accountant form. |
| 0 | עצמאי/ת, only the string `"0"` | Tax assessment for `taxYear` and the accountant letter for `accountantYear`. Both are required. |
| 5 | שכיר ועצמאי | Employment stays `both`. Gathering currently uses the same list as code `0`. |
| 4, 6, 7, 8, 9, empty | לא מועסק/ת, מלגה, קצבה, פנסיונר/ית, אישור מוסד תורני, or blank | The agent asks: salaried, self-employed, controlling shareholder, or other. Other flags the advisor. |

Uploads to Smart NPV send `file_name` and `file` only, so they arrive with no category. A `document_type_id` on a file already stored there does not close a slot. The file sent there is a PDF named `<borrower>_<Hebrew label>_<yyyy-mm-dd>_<version>.pdf`. A customer PDF is uploaded on its own. Photos are held until the customer says there are no more, then embedded into one PDF. The held pages are retired only after that PDF is stored. A document type may declare `blankForm` (`file` under `docs/`, `once: "conversation"`). That PDF is sent once, on the turn that asks for that document. A WhatsApp turn sends the PDF file through Zernio. A turn with no channel puts a link in the reply. The next customer file fills that type when the reader cannot tell it is a different open document. A slot with a year accepts a file only when the file carries that year. A file with no year leaves those slots open. A file with one borrower asks whether there is a second before any document slot opens. After each accepted loan balance the customer is asked whether another is needed. No file slot opens until the borrower count, employment, first home, and loans are answered. A bank statement must cover the three calendar months before this month; one file may cover several of them, and the reply names the document and those months. `collectionStages` names the waves. Stage `1` is the list above. The advisor releases the next id from the checklist, which reopens the latest thread if it is closed and sends one agent message. Release is never automatic and is refused while the checklist review task is open: something outside the app has to happen first. A save with no API key, or a lead whose phone is in `testPhones`, keeps the file in the CRM and does not call Smart NPV. A real upload stores the download link from `get_uploaded_documents` when the file name matches.

A new profile key means extending `mapSmartProfile` and then using it from JSON. Do not read Smart NPV fields from the rules file.

## Add a document type

Add an entry under `documents`, then a `requirements` row that names it. Labels need both `he` and `en`. `fields` are the names the vision step must pull. `checks` run in order on those fields. The first failure rejects the file.

```json
{
  "id": "identity",
  "labels": { "he": "תעודת זהות וספח", "en": "ID and appendix" }
}
```

```json
"payslip": {
  "labels": { "he": "תלוש שכר", "en": "Payslip" },
  "fields": ["fullName", "periodEnd"],
  "checks": [
    { "op": "field_present", "field": "fullName" },
    { "op": "matches_profile", "field": "fullName", "profileKey": "fullName" },
    { "op": "date_within_months", "field": "periodEnd", "months": 3 }
  ]
}
```

```json
{ "docType": "payslip", "stage": "income", "count": 3 }
```

`count` defaults to 1. `each: "borrower"` opens the row once per person (`payslip#1#0`). `each: "account"` opens one statement per known account for a single borrower, and one household statement when two borrowers are on the file. `empty: "one"` still opens one when none are listed. `year` is `taxYear` or `accountantYear`. `months` is how many prior calendar months a statement must cover. `when` omitted means the requirement always opens. Stage order is the `stages` array. The agent asks for the next outstanding document only. A rejected payslip says which detail failed: the employee name, or the month that was read and the three months that are needed. One file that contains several recent payslip months closes one slot per month. A file name never changes the reply language. A ספח is accepted once it is recognized, including when it is already in the ID photo. When the photos do not include it, the agent asks for it before anything is sent, and the card and the ספח go to Smart NPV as one PDF. Whether an ID card is biometric is read from the card. When it is, the other side is requested and both sides are in that same PDF.

```json
{ "op": "eq", "key": "employment", "value": "employed" }
```

Condition ops: `eq`, `neq`, `gt` (number), `truthy`, and `all` / `any` with an `of` list. `checklistSlots` expands the saved `requirements`. On a borrower row, `when` reads that person's `employment`. The default rows open three payslips for salaried borrowers and for a controlling shareholder, plus the shareholder letter for code `3`. A borrower whose code is the string `0`, and a borrower whose employment is `both` (code `5` or a customer answer), needs both the tax assessment for `taxYear` and the accountant letter for `accountantYear`. Each of those slots names its year, and a file fills one only when the extracted year matches. Income and banking rows stay closed when `firstHome` is false or `advisorFlag` is set.

Update `MORTGAGE_RULES` when the default checklist should include the type for tenants that have not saved their own rules. A tenant that already saved rules keeps the saved JSON until ops save again.

## Checks the engine already runs

| Op | Rejects when |
|---|---|
| `field_present` | The named field is missing or blank. |
| `matches_profile` | The field differs from `profile[profileKey]`. Digits are compared when both sides have digits. Otherwise the comparison is trimmed, case-folded text. |
| `date_within_months` | The field is not `YYYY-MM-DD`, is older than `months`, or is in the future. |
| `min_items` | The field has fewer than `count` items. A number, a JSON array, or a comma, semicolon, or newline list all count. |

The vision step only extracts. It does not pass or fail the file. `judgeFile` does that.

## Add a check

Use this only when none of the four ops can express the rule.

1. Add the op to the `Check` union and to `CHECK_OPS` in `src/lib/documents/rules.ts`, and parse its fields in `parseCheck`.
2. Implement it in `runChecks` in `src/lib/documents/validate.ts`. Return `{ op, field }` on failure. Return null when the check passes.
3. Add the same reason key to the lead copy in `src/lib/copy/en.ts` and `src/lib/copy/he.ts` (`chat.documents.reasons`) and to the operator copy in `src/lib/ui/en.ts` and `src/lib/ui/he.ts` (`documentsUi.reasons`). The lead hears the copy sentence. The checklist shows the operator label.
4. Cover the pass and the failure in `src/lib/documents/validate.test.ts`. `src/lib/documents/rules.test.ts` already rejects an unknown op.

Leave `interpreter.ts` alone. Do not add a table, a port, or a second approval form. An accepted file still becomes one `LeadDocument` on the dossier and one Smart NPV upload.

## What people see when a file is rejected

| `lastReason` | Sender | Checklist |
|---|---|---|
| `wrong_type` | This is not one of the documents still needed. Also used when the model ran and named none of the open types. | Wrong document |
| `no_model` | "I couldn't read the file." | No model configured. Log `documents.extract` with `outcome: "skipped"`. |
| `extract_failed` | "I couldn't read the file." | The file check failed. Log `documents.extract` with `outcome: "failed"`. The error string is also on `LeadDocument.validation.error`. |
| a check op | The sentence for that op. | The operator label for that op. |
| `unsupported_type` | Send a PDF, PNG, JPG, or JPEG. | The file is rejected before download. |
| `too_large` | The file is too large. | Log `documents.download_failed`. |
| `missing_bytes` | Falls back to the unreadable sentence. | A stored row with nothing to upload was closed so later turns stop retrying it. |

Each extract writes one `documents.extract` line (`outcome`, `docType`, `askedFields`, `filledFields`, `emptyFields`, `finishReason`, `sparse` when the type is set but every asked field is blank, plus model `warnings`). The judge writes one `documents.judge` line (`kind`, `reason`, `slotId`). Rejected rows also store the extract summary under `LeadDocument.validation.extract`.

After `maxRejectTries` rejects on one slot (default 5), the agent starts a cool-off and asks whether to escalate — it does not auto-block. Dossier status otherwise is `needs_id` (no Smart NPV match), `gathering` (a slot is still missing), or `complete`.

## Tests

```bash
npx vitest run src/lib/documents/rules.test.ts src/lib/documents/validate.test.ts
npx vitest run src/lib/flow/architecture.test.ts
```

## Clients screen

`/clients` (`src/components/clients/`, data in `src/lib/documents/clients-view.ts`) lists every lead with a `Dossier`, plus every contact the auto-invite messaged (`ContactInvite` whose contact has a lead) that has no file yet. Other synced contacts are not shown; a matching contact only adds its CRM details (`Contact.mapped`) to the file view. Tabs: needs you (an open `document_checklist_complete`, `document_review`, `invite_no_start` or `invite_send_unknown` task), invited (no file yet: invited, reminded, replied, or stopped), collecting (`gathering` or `needs_id`), done (`complete`), all. The file shows the invite timeline (sent, reminder, replied). An invite task is closed with "handled" (`POST /api/leads/[id]/documents/invite-handled`), which sends nothing. The tab shows when the documents capability is on or a file exists. Leads whose id starts with `demo-`, and phones in `testPhones` when a key is set, are hidden behind a toggle. A keyless tenant shows a test-mode strip instead.

Advisor actions, all under `/api/leads/[id]/documents/`:

| Route | Effect |
|---|---|
| `approve` | Closes the open review task. Sends nothing. |
| `return` | Reopens the named slots with the advisor's note, sends the customer the list, closes an open review as declined. Works without a task. |
| `request` | Adds `requested: true` slots for catalog types on the current wave and sends one message naming them. Requested slots survive `mergeSlots`. Closes an open review, which opens again when the files arrive. |
| `next-stage` | Releases the next collection wave. Refused (409) while the review is open. |

Local demo data: `npm run db:seed:clients` (`scripts/seed-clients-demo.ts`) seeds the dev tenant with 7 clients, one per state, and no Smart NPV key, so nothing leaves the machine. Re-running resets them. It refuses any database that is not local. It needs one conversation in the tenant (send a message in `/demo` once).

The lead list marks a lead whose document file was matched in Smart NPV (a `Dossier` with a `smartClientId`) with a client chip. Campaign contacts do not get the chip.


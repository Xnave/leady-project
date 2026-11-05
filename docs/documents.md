# Documents capability

A lead sends files on WhatsApp, Instagram, or `/demo`. The agent matches the sender to a Smart NPV client, opens a checklist from JSON rules, checks each file, and uploads an accepted file once. The checklist is data on the tenant's `documents` capability instance. A new document type that uses a check the engine already knows is a JSON edit. A new kind of check is a code change in one place.

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
| `blocked` | One slot has failed three times. The conversation is handed to a person and the agent stops asking. |
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
| `failCount` | How many times that slot has been rejected. The third failure sets the dossier to `blocked`. |

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

## Where it lives

| Piece | File |
|---|---|
| Rules shape, conditions, `parseRules`, `requiredSlots` | `src/lib/documents/rules.ts` |
| Default mortgage checklist and per-borrower slots | `src/lib/documents/mortgage-rules.ts` |
| Employment codes, loans, accounts, customer answers | `src/lib/documents/facts.ts` |
| Saved config (URL, encrypted key, rules) | `src/lib/flow/document-config.ts` → `CapabilityInstance` |
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
| `accounts` | One `{ id }` per `banks_accounts` row that has an id. |
| `accountsKnown` | `known` when those rows exist or the customer says there are accounts. `none` when the customer says there are none. Otherwise `unknown`, and the agent asks. |
| `firstHome` | `true`, `false`, or `unknown`. Smart NPV's `transaction_type` does not set this. Unknown still opens the income list; `false` removes income and banking and flags the advisor. |
| `advisorFlag` | Set for employment `both` (code `5`) or `firstHome: false`. The dossier opens one advisor task. |
| `nationalId` | Borrower id (`id_1`, or `id_2` when the sender's id matches borrower 2). |
| `fullName` | That borrower's name. |
| `phone` | That borrower's phone. |

Employment codes, from the guide table copied in `haiku-code/cia-knowledge` `snpv_lookups.md`. An empty value is not code `0`. That empty-string quirk is documented for `transaction_type` (מחזור) only.

| Code | Meaning | Checklist |
|---|---|---|
| 1, 2, 3 | שכיר/ה, מגזר ציבורי, שכיר/ה בעל שליטה | Three payslips. Codes 2 and 3 stay on this list until the advisor says otherwise. |
| 0 | עצמאי/ת, only the string `"0"` | Current calendar year: the accountant letter only. Previous calendar year: שומת מס or a second accountant letter. Either prior-year file satisfies that pair; the other stays open. |
| 5 | שכיר ועצמאי | Advisor flag. No payslips and no accountant letter. |
| 4, 6, 7, 8, 9, empty | לא מועסק/ת, מלגה, קצבה, פנסיונר/ית, אישור מוסד תורני, or blank | The agent asks. |

Uploads to Smart NPV send `file_name` and `file` only, so they arrive with no category. A `document_type_id` on a file already stored there does not close a slot. The file sent there is a PDF named `<borrower>_<Hebrew label>_<yyyy-mm-dd>_<version>.pdf`. A customer PDF is uploaded on its own. Photos are held until the customer says there are no more, then embedded into one PDF. The held pages are retired only after that PDF is stored. A document type may declare `blankForm` (`file` under `docs/`, `once: "conversation"`). That PDF is sent once on the conversation, using the Zernio ids already on the turn. The next customer file fills that type when the reader cannot tell it is a different open document. A slot with a year accepts a file only when the file carries that year. A file with no year leaves those slots open. Code `3` is asked that deposit question before any payslip. After each accepted loan balance the customer is asked whether another is needed. No file slot opens until employment, salary deposit, first home, loans, and accounts are answered. A bank statement must cover the three calendar months before this month; one file may cover several of them, and the reply names the document and those months. `collectionStages` names the waves. Stage `1` is the list above. The advisor releases the next id from the checklist, which reopens the latest thread if it is closed and sends one agent message. A save with no API key, or a lead whose phone is in `testPhones`, keeps the file in the CRM and does not call Smart NPV. A real upload stores the download link from `get_uploaded_documents` when the file name matches.

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

`count` defaults to 1. On a saved requirements list, `count: 3` opens `payslip#0`, `#1`, and `#2`. The mortgage generator opens `payslip#1#0` for borrower 1 instead, so two people do not share a slot. `when` omitted means the requirement always opens. Stage order is the `stages` array, and that is the order the agent asks in.

```json
{ "op": "eq", "key": "employment", "value": "employed" }
```

Condition ops: `eq`, `neq`, `gt` (number), `truthy`, and `all` / `any` with an `of` list. The default mortgage list does not use them for income. `checklistSlots` opens three payslips for salaried borrowers (codes 1 and 2, and code 3 after the salary is deposited to their account). Code `3` with the salary deposited elsewhere also gets one controlling-shareholder letter, which is not checked. A borrower whose code is the string `0` gets the current-year accountant letter, plus a prior-year pair that is satisfied by either the tax assessment or a second letter. Each of those slots names its year, and a file fills one only when the extracted year matches.

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
| `no_model` | "I couldn't read the file." | No model configured. Log `documents.extract_skipped`. |
| `extract_failed` | "I couldn't read the file." | The file check failed. Log `documents.extract_failed`. The error string is also on `LeadDocument.validation.error`. |
| a check op | The sentence for that op. | The operator label for that op. |
| `unsupported_type` | Send a PDF, PNG, JPG, or JPEG. | The file is rejected before download. |
| `too_large` | The file is too large. | Log `documents.download_failed`. |
| `missing_bytes` | Falls back to the unreadable sentence. | A stored row with nothing to upload was closed so later turns stop retrying it. |

Three failures of the same slot set the dossier to `blocked` and hand the conversation to a person. Dossier status otherwise is `needs_id` (no Smart NPV match), `gathering` (a slot is still missing), or `complete`.

## Tests

```bash
npx vitest run src/lib/documents/rules.test.ts src/lib/documents/validate.test.ts
npx vitest run src/lib/flow/architecture.test.ts
```

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
| Requirement | One line that opens slots: which document type, which stage, how many files (`count`, default 1), and an optional `when`. Two requirements can name the same type with different `when` clauses. Employed income asks for one file. Self-employed income asks for two. |
| `when` | A condition on the profile. Omitted means the requirement always opens. Ops are `eq`, `neq`, `gt`, `truthy`, and `all` / `any`. |
| Slot | One file the client owes. `count: 3` on bank statements opens `bank_statement#0`, `#1`, and `#2`. Status is `missing` or `uploaded`. |
| Slot id | `<docType>#<index>`, starting at 0. |
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
| Default mortgage checklist | `src/lib/documents/mortgage-rules.ts` |
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
| `employment` | `employed` or `self_employed` when the client record has it. The published Smart NPV record has no employment enum, so this is often empty and neither income requirement opens. |
| `hasLoans` | True when the record has liabilities, a loans array, or `current_mortgage` greater than 0. |
| `nationalId` | Borrower id (`id_1`, or `id_2` when the sender's id matches borrower 2). |
| `fullName` | That borrower's name. |
| `phone` | That borrower's phone. |

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

`count` defaults to 1. `count: 3` opens `payslip#0`, `#1`, and `#2`. `when` omitted means the slot always opens. Stage order is the `stages` array, and that is the order the agent asks in.

```json
{ "op": "eq", "key": "employment", "value": "employed" }
```

Condition ops: `eq`, `neq`, `gt` (number), `truthy`, and `all` / `any` with an `of` list. An employed profile gets the employed requirement. A self-employed profile gets the self-employed one. Any other employment gets neither, when those are the only two income rows.

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

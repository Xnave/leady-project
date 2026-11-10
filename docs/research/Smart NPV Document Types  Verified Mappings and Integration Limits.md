# Smart NPV document-type mappings

Checked 2 November 2026. Scope: the official public Postman collection, the vendor’s public document library and its HTML, and a separately published integration-research repository. No authenticated customer API calls, uploads, or changes were performed.

## Evidence and trust levels

Three different uses of “document type” appear in the available material: uploaded-file classification, the AI scanner’s classification, and customer-area document/template configuration. The official collection exposes different field paths for these; it does not publish a conversion table connecting them.[^1]

“Verified” below means directly observed in a vendor-controlled page or its published collection—not demonstrated against a live customer account. A label returned by an API is metadata, not proof that a file contains that document.

## Live public-library mappings

The vendor’s [public document library](https://www.snpv.co.il/public/documents) contains a `select` element named `type`, with ID `docsType`. Its HTML option values provide the following direct ID-to-label mapping. The document cards also carry `data-type` attributes, allowing cross-checking against the displayed forms.[^2]

| Library type ID | Exact Hebrew label | Meaning | Evidence level |
|---|---|---|---|
| `5` | אישור הכנסות מרו"ח | Accountant’s income confirmation | Observed in vendor HTML. [^2] |
| `15` | כתב הסמכה | Authorization form | Observed in vendor HTML and authorization-form cards. [^2] |
| `28` | אישור עקרוני | Approval in principle | Observed in vendor HTML; library includes an application-for-approval form in this category. [^2] |
| `30` | תצהיר | Affidavit | Observed in vendor HTML. [^2] |
| `31` | הסכמה למסירת נתוני אשראי | Consent to disclosure of credit data | Observed in vendor HTML and matching cards. [^2] |
| `40` | מסמך כללי | General document | Observed in vendor HTML; includes heterogeneous forms. [^2] |
| `64` | זכאות | Eligibility | Observed in vendor HTML; sibling-affidavit cards use this category. [^2] |
| `67` | בקשה לבקשת הלוואה | Loan-application category; Hebrew label reproduced exactly | Observed in vendor HTML. [^2] |

These are trustworthy **public-library mappings**. They are not yet a verified global dictionary for `get_uploaded_documents.document_type_id`, and they do not establish accepted upload parameters. The library describes reusable forms, not necessarily completed evidence supplied by borrowers.[^1][^2]

For example, the library’s `28` category contains “איילון - בקשה לקבלת אישור עקרוני”—an application requesting approval, not necessarily the lender’s issued approval. Likewise, a blank income-confirmation template is not a completed accountant’s confirmation. Category mapping and requirement completion must therefore remain separate.[^2]

No payslip, bank-statement, or mortgage-balance-report numeric mapping was found in this public library. Its dropdown is not an exhaustive dictionary of all borrower-document types.[^2]

## Uploaded-document metadata

The official [Postman collection JSON](https://api.snpv.co.il/api/collections/17090513/UyrDEw47?segregateAuth=true&versionTag=latest), linked by the documentation page, includes `GET /api/v2/clients/get_uploaded_documents`. Its response example supplies `uuid`, `name`, `extension`, `document_type_id`, `document_type_title`, `uploaded_at`, `uploaded_by`, `download_url`, `ai_scan`, and `folders`.[^1]

The only non-null numeric file-category pairing in that example is **`document_type_id = 1` → `תעודת זהות`**. This is useful vendor-example evidence, but it is not a published, complete enum or a guarantee that the same ID space is global across accounts.[^1]

The same endpoint accepts a query parameter named `type`, described as an optional document-type filter. Its example request uses `type=3`, but the example response includes one null type and one type `1`. This inconsistency means the example does not establish what `3` means or demonstrate reliable filtering behavior. It does not prove the live filter is broken.[^1]

Recommendation: collect ID/title pairs from actual authorized responses in the advisor’s account. Store them as observed metadata scoped to that account and field path; do not derive an unseen label from a numeric ID alone.

## AI types are separate

The collection’s examples contain these scanner values:[^1]

| Field | Observed value | Observed label |
|---|---|---|
| `ai_scan.document_type` | `eligibility` | זכאות. [^1] |
| `ai_scan.document_type` | `unsupported_or_unknown` | מסמך כללי (לא נמצא סיווג מתאים). [^1] |

In one example, the uploaded-file category says `1 / תעודת זהות`, while the AI classification says `eligibility / זכאות`. Both examples have `status = done`, `confidence = null`, and empty extracted `fields`. Therefore the example demonstrates separate metadata fields and a possible conflict—not an accuracy guarantee or a complete AI taxonomy.[^1]

Recommendation: preserve both values. Treat null confidence as unknown, not zero or certainty. An AI/category disagreement should trigger review rather than silently changing either classification.

## A misleading lookup table

A public integration-research repository includes [`snpv_lookups.md`](https://github.com/haiku-code/cia-knowledge/blob/main/poc1/reference/snpv_lookups.md) and [`snpv_lookups.json`](https://github.com/haiku-code/cia-knowledge/blob/main/poc1/reference/snpv_lookups.json). The accompanying discovery plan describes extracting lookup tables from Smart NPV’s authenticated developer guide.[^3][^4]

Direct inspection of those reference files found `document_type: {"1": "כתב הסמכה"}` under the UI category “סוגי מסמכים להוספה לאזור האישי”. Their author marks that table account-specific. This is secondary-source evidence, not a live vendor response for the user’s account; the authenticated guide could not be inspected without login.

This yields three distinct observations:

| Context | Observed mapping | Interpretation |
|---|---|---|
| Uploaded-file response example | `1` → תעודת זהות | Official example of a file-category pair. [^1] |
| Public form library | `15` → כתב הסמכה | Direct live vendor-page mapping. [^2] |
| Customer-area lookup in third-party capture | `1` → כתב הסמכה | Account-specific template/configuration evidence, not independently verified in the user’s account |

The defensible conclusion is **not** that one universal dictionary is wrong. It is that these contexts must not be merged without vendor confirmation. Different namespaces, account-specific template IDs, and example inaccuracies remain possible explanations.

## Upload and two-call limits

The linked “Save document” operation is `POST /api/v2/clients/upload_document`, with multipart fields `api_key`, client `uuid`, `file_name`, and `file`. Its example returns success and a message, but no document UUID. No type-setting field, uploaded-file update endpoint, or type-enumeration endpoint appears in the inspected collection. This establishes a documentation gap, not that the backend rejects every undocumented field.[^1]

`clients/create` and `clients/update` contain `params.public_access.documents[]` entries with `document_type` and `banks`. Those entries do not identify an uploaded file. Another create-client example accepts `public_access.lists` as a UUID. These demonstrate customer-area configuration, but do not document a second call that assigns a category to an uploaded document.[^1]

A supported “upload → set file type” sequence is therefore still unverified. “Upload → list documents” is documented, but correlating the resulting document with the upload requires care because the upload example provides no ID.[^1]

Recommendation: use a unique, non-sensitive correlation token in `file_name`, list documents before and after uploading, and match new UUIDs plus the token. Treat this as a candidate integration technique requiring testing—not guaranteed idempotency. Never retry an uncertain upload blindly.

## Proposed mapping structure

Use separate mapping keys rather than a flat integer dictionary:

```text
(advisor_account, namespace, external_type_id)
    -> observed_label
    -> internal_document_type
    -> evidence_source
    -> observed_at
    -> verification_status
```

Recommended namespaces:

- `uploaded_document_category`
- `public_library_category`
- `public_access_template`
- `ai_document_type`

Suggested internal types—application design, not claimed Smart NPV enum values—include `identity_document`, `payslip`, `bank_statement`, `accountant_income_confirmation`, `authorization_form`, and `credit_data_consent`.

An observed label/category should suggest classification only. Completing a requirement additionally needs the correct borrower, account or issuer, period, readability, and whether the document is completed/signed where required. The published file example does not provide structured borrower or coverage-period fields.[^1]

## Verification before production

Recommended controlled acceptance test in an authorized test client:

1. List existing documents and preserve their UUIDs and raw ID/title pairs.
2. Upload a non-sensitive test file through the documented operation, with a unique filename token.
3. List again; establish how the created file is identified and whether a category is populated.
4. If classification is available in the advisor UI, change the category there and list again to compare the same document UUID.
5. Record the UI’s network request to identify whether it uses an internal session-authenticated operation; do not assume it is a supported API-key endpoint.
6. Repeat with representative ID, payslip, and bank-statement documents using suitable test fixtures and authorization.
7. Ask Smart NPV to confirm the mapping scope, enumeration endpoint/export, accepted upload parameter, and supported category-update operation.

Until these checks pass, public-library IDs are safe for identifying library categories; actual account-returned ID/title pairs are safe to preserve as that account’s metadata. Neither establishes that a document satisfies a borrower requirement, nor that its category can be written through the upload API.

---

## References

1. [Smartnpv API Documentation](https://api.snpv.co.il/) - https://www.snpv.co.il/api/v2/clients/get?api_key=RGGGGG6JKY6RTR8UJCQWTS4H6VFLENFLB9CCCCC&type=uuid/...

2. [מסמכים ליועץ המשכנתה](https://www.snpv.co.il/public/documents) - סינון, צפייה ושיתוף מסמכים בצורה מהירה ונוחה

3. [cia-knowledge/poc1/SmartNPV_Data_Discovery_Plan.md ... - GitHub](https://github.com/haiku-code/cia-knowledge/blob/main/poc1/SmartNPV_Data_Discovery_Plan.md) - `clients/upload_document`, `clients/add_simulation`, `status/add`,

4. [SmartNPV_API_and_Extraction_Plan.md - GitHub](https://github.com/haiku-code/cia-knowledge/blob/main/poc0/SmartNPV_API_and_Extraction_Plan.md) - GET /clients/get_client_documentations?api_key=<KEY>&uuid=<uuid>


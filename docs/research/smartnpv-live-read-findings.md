# Smart NPV live read findings

2 November 2026. Read-only calls with the account key: `GET /api/v2/clients/list`, `GET /api/v2/clients/get`, `GET /api/v2/clients/get_uploaded_documents`. No uploads and no updates.

Compared with [Smart NPV Document Types  Verified Mappings and Integration Limits.md](Smart%20NPV%20Document%20Types%20%20Verified%20Mappings%20and%20Integration%20Limits.md) and [smartnpv-document-mappings.json](smartnpv-document-mappings.json). Those notes were from the public Postman example and the public form library, with no authenticated calls.

## What was read

`clients/list` with `range_type=2` (modified), `from=01/01/2023`, `until=03/11/2026`, limit 30. The list row is the full client payload, not a short summary. The first page returned 30 clients. `responseClientsCount` was present.

`clients/get?type=uuid` was called for those 30. `get_uploaded_documents` was called with only `uuid` (no `from`, `until`, or `type` filter). It returned 99 files. No call failed.

This is the recently modified slice of one advisor account. It is not the whole book, and it did not contain borrower evidence files.

## Uploaded file categories on this account

| `document_type_id` | `document_type_title` | Files | Against the earlier research |
|---|---|---|---|
| 15 | כתב הסמכה | 51 | Same label as public-library id 15. |
| 33 | לאומי - סיכום הגשה לבנק | 13 | Not in the public-library dropdown. |
| 31 | הסכמה למסירת נתוני אשראי | 4 | Same label as public-library id 31. |
| 38 | הבינלאומי - סיכום בקשה | 3 | Not in the public-library dropdown. |
| 28 | אישור עקרוני | 2 | Same label as public-library id 28. |
| null | empty | 26 | Mostly named סיכום בקשה, plus a mix-comparison report and an optional mix. |

File names on the authorization forms are bank-specific (`לאומי - כתב הסמכה`, `פועלים - כתב הסמכה`, and the other banks). `uploaded_by` is `client`, `user`, or `system`. The bank-submission summaries are `system`. `extension` was empty on every named file inspected.

`ai_scan` was empty on all 99 files: no `document_type`, no title, no status, `confidence` null. The Postman conflict (category תעודת זהות, AI scan זכאות) did not appear here. There is still no evidence that the scanner is reliable, because it did not run.

Not seen in these 99 files: `document_type_id` 1, תעודת זהות, a payslip, a bank statement, a tax assessment, or an accountant letter. Public-library ids 5, 30, 40, 64, and 67 were also absent.

## Client facts that the checklist would need

Across the 30 clients:

| Fact | Observed | Safe to use? |
|---|---|---|
| `status_report_1` | `2` on 16, empty on 10, `1` on 2, `5` on 2 | No. Codes only. The published example's `"3"` was not in this slice. No label was returned. |
| `status_report_2` | empty on 17, `2` on 13 | No, same reason. |
| `transaction_type` | `5` on 9, empty on 7, `3` on 5, `16` on 3, `6` on 2, `28` on 2, `1` on 1 | No. `"1"` occurs, and it still has no vendor label. Do not treat it as first-home. |
| Borrower 2 | 15 clients have a different `id_2` from `id_1`. 13 have no second person. 2 have some second-person field without a distinct id. None repeat `id_1` onto `id_2`. | A distinct id is a second borrower. The other two are ambiguous. The example's duplicated id was not in this slice. |
| `banks_accounts` | On the first 12: 7 with none, 3 with one, 2 with two. | The array can seed statement slots. Zero accounts does not mean the client has no accounts. |
| `liabilities` | On the first 12: 5 nonempty, 7 empty. The field is always present. | Nonempty means loans exist. Empty does not mean there are no loans. |
| `current_mortgage` | On the first 12: numeric and above 0 on 2. | A positive amount means a current mortgage. Empty does not mean no loans. |

## What this confirms from the research

- Public-library ids 15, 28, and 31 use the same Hebrew labels on this account's uploaded files. For those three, the library namespace and the uploaded-file namespace match.
- Ids 33 and 38 are real uploaded categories and are outside that library list. The library dropdown is not the full uploaded-type dictionary.
- The third-party note that customer-area template id `1` means כתב הסמכה does not describe this account's uploaded files. Here, כתב הסמכה is id 15. Uploaded id 1 was not observed, so the Postman example `1` → תעודת זהות is still unverified, not disproved.
- `ai_scan` must stay a separate namespace. On this account it was simply empty.
- Upload still cannot set a type through a documented field. That was not retested, because no write calls were made.

## Ambiguities

- Employment cannot be read from `status_report_*`. The codes seen are 1, 2, and 5, plus empty. There is no title field.
- First-home cannot be read from `transaction_type`. Seven different values appeared, including one client with `"1"`.
- No borrower evidence file was in the 99 documents, so there is no live id for תעודת זהות, payslips, statements, tax assessments, or the accountant letter. Those checklist items cannot yet be closed from `get_uploaded_documents`.
- 26 files have a null type. Many are still named סיכום בקשה. A null type must not close a slot, and a system סיכום בקשה must not count as a borrower document.
- Two clients have a partial second borrower (a name or phone without a distinct id). Those should be asked, not silently dropped or silently kept.
- `extension` was empty on the files whose names were inspected. File type has to come from the file itself, not from this field.
- The scanner's disagreement behavior is still only known from the vendor example, not from this account.

# Smart NPV final mapping

2 November 2026. Use this when matching a client or an already-uploaded file. The evidence is in [smartnpv-live-read-findings.md](smartnpv-live-read-findings.md). Public-library labels that were not seen on this account stay in the library namespace from [smartnpv-document-mappings.json](smartnpv-document-mappings.json).

Do not merge namespaces. A number only means the label below inside the namespace where it was observed.

## Uploaded file categories, verified on this account

Source: `GET /clients/get_uploaded_documents`, 99 files across 30 recently modified clients. Match `document_type_id` and `document_type_title` together. If the title is missing, do not guess from the id.

| Id | Title | Closes a borrower slot? |
|---|---|---|
| 15 | כתב הסמכה | No. Bank authorization, not ID, income, or statements. |
| 28 | אישור עקרוני | No. |
| 31 | הסכמה למסירת נתוני אשראי | No. |
| 33 | לאומי - סיכום הגשה לבנק | No. System bank-submission summary. |
| 38 | הבינלאומי - סיכום בקשה | No. System summary. |

Null id and empty title: do not close a slot, even when the file name is סיכום בקשה.

`uploaded_by=system` does not close a borrower requirement.

## Public library categories, not seen on uploaded files

These labels come from the public form library only. They were not returned by `get_uploaded_documents` on this account, so they must not be used to close a slot until an uploaded file actually carries them.

| Id | Library title |
|---|---|
| 5 | אישור ניהול חשבון |
| 30 | הסכם |
| 40 | נסח טאבו |
| 64 | שמאות |
| 67 | תעודת זהות |

Library id 67 is תעודת זהות. Uploaded id 1 is also תעודת זהות in the vendor's Postman example, and that example was not present in this account. Until an uploaded file returns id 1 with title תעודת זהות, do not close `id_card` from either number.

Library ids 15, 28, and 31 match the uploaded titles above. That overlap is verified. It does not license copying the other library ids onto uploaded files.

## Scanner, not verified

`ai_scan.document_type` was empty on all 99 files. Do not read `ai_scan` as the file category. The vendor example, where category 1 was תעודת זהות and the scan said eligibility, remains the only evidence that the two can disagree.

## Borrower checklist, not yet mapped to a Smart NPV id

These are the files the advisor asks the lead for. None of them appeared in the 99 uploaded files, so there is no verified id to match.

| Our slot | Expected Hebrew document | Smart NPV id |
|---|---|---|
| `id_card` | תעודת זהות, including the other side of a biometric card | Unverified. Example says uploaded id 1. Library says id 67. Neither was seen. |
| `id_appendix` | ספח תעודת זהות | No id. |
| `payslip` | תלוש שכר | No id. |
| `bank_statement` | דפי בנק / עובר ושב, last 3 months | No id. Library id 5 is an account-management confirmation, which is a different document. |
| `loan_balance` | יתרת הלוואה | No id. |
| `tax_assessment` | שומת מס | No id. |
| `accountant_letter` | אישור רואה חשבון | No id. |

Until those ids are observed, a file already on the client can only close a slot when its title clearly says so. The ids in the table above never close one.

## Client facts

| Need | Read it from | Do not read it from |
|---|---|---|
| Which borrower | `id_1`. A second borrower only when `id_2` is present and different. A second phone or name without a distinct id is unknown: ask. | A copied `id_1` in `id_2`. None of the 30 clients did this, but the vendor example does. |
| Employment | Ask the lead, per borrower. | `status_report_1` / `status_report_2`. Observed codes were 1, 2, 5, and empty, with no label. Workplace and income do not decide salaried vs self-employed. |
| First home | Ask the lead. | `transaction_type`. Observed 1, 3, 5, 6, 16, 22, 28, and empty, with no label. |
| Bank accounts | One statement slot per `banks_accounts` row that has its own id. Zero rows means unknown, so ask whether there are accounts. | A fixed count of three files. |
| Loans | `liabilities` nonempty, or `current_mortgage` above 0, means loans are known. Otherwise unknown, so ask. | An empty `liabilities` array as "no loans". |

## Still unresolved

- What `status_report` 1, 2, and 5 mean.
- What each `transaction_type` means, including the single client with `"1"`.
- Whether uploaded id 1 is תעודת זהות on this account.
- The uploaded ids for payslips, statements, tax assessments, the ID appendix, loan balances, and the accountant letter.
- Whether `extension` is ever populated. It was empty on the named files inspected.

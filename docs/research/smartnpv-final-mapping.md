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

## Public library categories

The public-library labels live in [smartnpv-document-mappings.json](smartnpv-document-mappings.json). Do not copy them into a second table. Id `67` there is בקשה לבקשת הלוואה, a loan-application category, not an ID card.

None of these ids, and none of the uploaded ids above, close a borrower slot. Upload accepts `file_name` and `file` only, so a file we send has no category. A title such as תעודת זהות on a file already stored in Smart NPV does not close `id_card`.

## Scanner, not verified

`ai_scan.document_type` was empty on all 99 files. Do not read `ai_scan` as the file category. The vendor example, where category 1 was תעודת זהות and the scan said eligibility, remains the only evidence that the two can disagree.

## Borrower checklist

These are the files the advisor asks the lead for. None of them appeared in the 99 uploaded files. There is no Smart NPV id to match, and this checklist does not close a slot from an id or a title.

| Our slot | Expected Hebrew document |
|---|---|
| `id_card` | תעודת זהות, including the other side of a biometric card |
| `id_appendix` | ספח תעודת זהות |
| `payslip` | תלוש שכר |
| `bank_statement` | דפי בנק / עובר ושב, last 3 months, one per known account |
| `loan_balances` | יתרת הלוואה |
| `tax_assessment` | שומת מס |
| `accountant_letter` | אישור רואה חשבון |

## Client facts

| Need | Read it from | Do not read it from |
|---|---|---|
| Which borrower | `id_1`. A second borrower when `id_2` is different, or when `phone_2` is set and `id_2` is empty. | A copied `id_1` in `id_2`. |
| Employment | `status_report_1` / `status_report_2`, using [snpv_lookups.md](snpv_lookups.md) מעמד תעסוקתי. `0` is self-employed. `5` stays both and currently gathers the self-employed list. `1` and `2` are the salaried list. `3` is the controlling-shareholder list. `4` and `6`–`9`, and empty, ask the client. A customer answer of other still flags the advisor. | An empty value as code `0`. Workplace, income, and gender. |
| First home | Ask the lead. `false` flags the advisor and drops income and banking. | `transaction_type`. In the same lookup file, `1` is שיפוצים. |
| Bank accounts | One statement slot per `banks_accounts` row that has its own id. Zero rows still open one statement. The agent does not ask whether accounts exist. | A fixed count of three files. |
| Loans | `liabilities` nonempty, or `current_mortgage` above 0, means loans are known. Otherwise unknown, so ask. | An empty `liabilities` array as "no loans". |

## Still unresolved

- Code `0` on an existing client: update returns success and the next read is empty. A client created with `status_report_1` `"0"` reads back `"0"`. Empty on an update is still unknown, not self-employed. The code table is [snpv_lookups.md](snpv_lookups.md).
- Confirm `transaction_type` the same way. The lookup file says empty is מחזור, and `1` is שיפוצים. Neither is first-home.
- Whether uploaded id 1 is תעודת זהות on this account. It does not close a slot either way.
- The uploaded ids for payslips, statements, tax assessments, the ID appendix, loan balances, and the accountant letter.
- Whether `extension` is ever populated. It was empty on the named files inspected.

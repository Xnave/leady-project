---
name: document-scenarios
description: >-
  Runs and adds Zapidly document-collection scenarios against Smart NPV test
  clients. Use when the user mentions document scenarios, a document profile,
  profile numbers such as profile 4, flow a or flow b, prefixes like 5_a1,
  scenario-runs/documents, or adding a mortgage checklist profile. Do not use
  this for the Hebrew booking scenarios or for a new document type.
---

# Document scenarios

One Smart NPV client shape, then a Hebrew script through `runTurnNow`. The pass is question order, an agent reply on every turn, every expected file accepted, and the same number of new filenames on that client. There is no score.

This is not the booking suite in `scripts/agent-scenarios/`. A new document type or check belongs to the documents-capability skill.

Read `scripts/smartnpv-test-profiles.ts` and `scripts/document-scenarios/run.ts` before editing. If this page disagrees with those files, the source wins.

## Run

From the repo root. The runner calls `runTurnNow` in process. Inngest is not required. An LLM key is required for the fixture extracts.

```bash
npx tsx scripts/document-scenarios/run.ts --only <scenario-id>
npx tsx scripts/document-scenarios/run.ts --only <scenario-id> --resume
npx vitest run src/lib/documents/scenario-client.test.ts
```

`--only` is one scenario. Run the next profile only when asked. `--resume` keeps the conversation, skips the local purge, and does not rewrite the comparison JSON. It still fetches the client and stops unless the stored fields match.

`SMARTNPV_BASE_URL` must stay `https://www.snpv.co.il`. The key is `SMARTNPV_API_KEY` or the documents key already saved for the tenant. Do not print the key, a phone, a national id, a person's name, a download URL, or a signed blank-form URL.

## Where things live

- Profiles, flows, create, update, delete: `scripts/smartnpv-test-profiles.ts`
- Runner: `scripts/document-scenarios/run.ts`
- Routing tests: `src/lib/documents/scenario-client.test.ts`
- Results: `scenario-runs/documents/results.md` (gitignored). The runner rewrites only the row it just ran. Do not hand-edit Last run, Result, or What went wrong.
- Transcript and comparison files: `scenario-runs/documents/<stem>-<stamp>.md`, `<stem>.smart.json`, `<stem>.mapped.json`
- Flow client uuids between runs: `scenario-runs/documents/flow-clients.json`

The stem is `5_a1_employment-unknown` for a shared client and `3_self-employed` for a client that stays. `5` is `TestProfile.seq`, `a` is the flow, `1` is the order that client is updated.

## What the checklist reads

Employment code, from `docs/research/snpv_lookups.md` via `employmentFromStatusReport`:

| Code | Checklist |
| --- | --- |
| 0 | Self-employed. Tax assessment for the prior year and the accountant letter for this year. |
| 5 | Employment stays both. Gathering uses the self-employed list for now. |
| 1 and 2 | Salaried. Three payslips. Same list. |
| 3 | Three payslips and the controlling-shareholder letter. The salary-deposit question is not in the fact gate. |
| empty, 4, 6, 7, 8, 9 | Unknown. The agent asks. Empty is not code 0. |

Also: one borrower is asked whether there is a second. A couple gets one household statement. One borrower gets one statement per account, or one unnamed statement when the account list is empty. Liabilities with any row are known loans and skip the question. An empty list is unknown, so the agent asks. Answering no loans drops the loan-balance file. First home "no", or a customer answer of `other`, closes income and banking. Employment `both` gathers the self-employed list. A blank form is sent once, on the turn that asks for that document. WhatsApp receives the PDF. A demo turn with no channel receives a link.

## Clients

Two clients stay. Do not delete them.

- Borrower 1 code 0: `STATUS_ZERO_PROBE_UUID`. Used by `self-employed`. Updates omit code 0, because an update stores it as empty.
- Borrower 2 code 0: `MIXED_COUPLE_UUID`. Used by `mixed-couple`. The original client, `TEST_UUID`, is not used by a current profile.

Every other profile is a flow. The runner creates that client with `created` `1577836800` so today's sync leaves it out, updates it in order, and deletes it when the last profile passes. A failed last profile keeps the client so `--resume` can continue.

| Flow | Starts as | Order |
| --- | --- | --- |
| `a` | 1 account, no loans, employment empty | `5_a1` employment-unknown, `1_a2` salaried-one, `1_a3` salaried-one-adds-borrower, `4_a4` controlling-shareholder, `6_a5` salaried-loans |
| `b` | no accounts, no loans | `8_b1` salaried-no-accounts, `7_b2` salaried-two-accounts, `2_b3` salaried-couple-loans |
| `c` | 1 account, no loans, code 5 | `10_c1` code-5. Same files as `self-employed`. Deleted when that run passes. |

`1_a2` and `1_a3` write the same Smart file. The second borrower in `1_a3` exists only in the chat.

The first profile of a flow always deletes the saved client and creates again. A later profile updates the saved client when it still matches the previous profile. Otherwise the runner deletes it, creates again, and applies the earlier profiles in order. Account and loan rows cannot be removed. A profile that needs fewer rows than the client already has has to be earlier in the flow, or on a new flow.

`deleteClient` refuses `TEST_UUID`, `STATUS_ZERO_PROBE_UUID`, and `MIXED_COUPLE_UUID`.

## Add a profile

1. Add a `TestProfile`: `seq`, `questions`, `files`, and `params`. Borrower 1 stays the demo lead's identity. Borrower 2, when present, uses the fixture id and phone already on the couple profiles. Omit `income` and `transaction_type`. They do not choose the list.
2. Add a `DocumentScenario`: `answers` in the order `openQuestions` will ask, and `files` as accepted counts (`id_card`, `id_appendix`, `payslip`, `tax_assessment`, `accountant_letter`, `controlling_shareholder_letter`, `bank_statement`, `loan_balances`).
3. Put it on a flow only when each earlier profile can still update forward. Code 0 is create-only and stays on its standing client. A shape that cannot grow from the current flows gets a new flow letter, in run order.
4. `flowStep` builds the prefix from `seq` and the flow position. Extend the routing test in `src/lib/documents/scenario-client.test.ts` when the order changes.
5. Run `--only` that id. The runner adds the results row. Do not invent the Result cell.

A new code that maps to an employment value already covered, such as code 1 beside code 2, does not need a profile. A new profile is a different question list or a different file list.

## Pass and fail

The script fails when the fetched client mismatches before the chat, the next question is not the scripted one, a turn has no agent reply, a fact stays open, a file is rejected twice, or the Smart NPV filename increase does not match the accepted uploads. On `--resume`, only filenames that were not already on uploaded slots have to increase.

Known answers the runner sends without a script line: biometric "לא", another loan "אין הלוואות נוספות", no more photos "אין עוד". Identity photos for borrower 2 come from `BORROWER_2_FIXTURES`. Other borrower 2 files use the shared fixtures.

The local purge deletes that lead's conversations, messages, dossiers, and documents, and the stored `SmartNpvClient` rows for that phone. It leaves the Lead row. It does not delete a standing remote client.

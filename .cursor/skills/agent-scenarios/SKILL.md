---
name: agent-scenarios
description: >-
  Runs, adds, and updates Zapidly Hebrew agent scenarios, the results table,
  and scenario-lead purge. Use when the user mentions scenarios, scenario runs,
  results.md, smoke/full/link/extra suites, adding or changing a conversation
  script, or deleting scenario conversations from the database. When a flow
  step is added, removed, or reordered, treat a failing scenario as the script
  being out of date.
---

# Agent scenarios

Hebrew conversation scripts against a running Zapidly app. Hard checks only. No LLM judge. Persona-gender warnings are not failures. A skip is not a failure.

Read [scripts/agent-scenarios/results.md](scripts/agent-scenarios/results.md) and the scenario source before editing. The map below is the suite layout. If it disagrees with the source files, the source wins. Update this map when you add or move a scenario.

## Where things live

- Customer lines and checks: [scripts/agent-scenarios/scenarios/](scripts/agent-scenarios/scenarios/) (`booking.ts`, `reservations.ts`, `reservations-link.ts`). [index.ts](scripts/agent-scenarios/scenarios/index.ts) is the list that runs.
- Ideas that do not run: [scripts/agent-scenarios/catalog.md](scripts/agent-scenarios/catalog.md).
- Last result per scenario: [scripts/agent-scenarios/results.md](scripts/agent-scenarios/results.md). The runner rewrites this file.
- Transcripts: `scenario-runs/test-conversations-*.md` (gitignored). The table's Conversation cell links there.
- Checks, purge, and the decide API: `src/lib/scenarios/`.

## Run

This repo's dev server is on port **3001**. Port 3000 is a different app. Pass the base URL every time. Confirm with `lsof -nP -iTCP:3001 -sTCP:LISTEN` if the port may have changed.

```bash
npm run scenarios -- --base-url http://localhost:3001
npm run scenarios -- --base-url http://localhost:3001 --suite full
npm run scenarios -- --base-url http://localhost:3001 --suite link
npm run scenarios -- --base-url http://localhost:3001 --suite extra
npm run scenarios -- --base-url http://localhost:3001 --only <id>[,<id>]
npm run scenarios -- --base-url http://localhost:3001 --due
npm run scenarios -- --base-url http://localhost:3001 --sample 2
```

`--only` ignores suite, so an extra or link scenario runs without `--suite`. Default suite is smoke. `full` is smoke plus full. `link` and `extra` run only themselves.

A shell variable wins over `.env`. If `SCENARIO_RESERVATION_TENANT_ID` is already exported, hold scenarios hit that tenant. Unset it (`env -u SCENARIO_RESERVATION_TENANT_ID`) so `.env` is used. Hold stays use `SCENARIO_RESERVATION_TENANT_ID`. Link stays use `SCENARIO_RESERVATION_LINK_TENANT_ID` and need a dev-server restart after that variable is added. Do not print secrets.

## Map

| Scenario | Suite | What it checks |
| --- | --- | --- |
| `booking-happy-approve-reopen` | smoke | Visit, "כן", approve, thank-you. Name and phone stay. Sample: `tuesday-morning`. |
| `booking-bad-time` | smoke | Bad hour, then a real time that must be stored. Sample: `yesterday`. |
| `booking-closed-day` | smoke | Saturday, then "מחר ב-10". |
| `booking-decline` | smoke | "לא" instead of "כן". No request. |
| `booking-yes-too-early` | smoke | "כן" before any field. No request. |
| `booking-nonsense` | smoke | Gibberish. No request. |
| `booking-fresh-thread` | smoke | After approve, a new conversation keeps the name and drops the visit. |
| `booking-not-a-booking` | full | Hours and price. No request. |
| `booking-handoff` | full | Complaint that asks for a person. Handoff, no request. |
| `reservation-happy-approve-reopen` | smoke | Thursday–Sunday stay, approve, thank-you. Sample: `couple-and-child`. |
| `reservation-bad-range` | smoke | Check-out before check-in. No hold. |
| `reservation-fresh-thread` | smoke | New conversation after an approved stay. |
| `reservation-not-a-stay` | full | Price question. No hold. |
| `reservation-declined` | extra | Stay collected, then declined. Thank-you opens nothing new. |
| `reservation-change-dates` | extra | Customer corrects Thursday to Friday. Pending stay starts Friday. |
| `reservation-offer-accept` | extra | Staff offers 13–15 Nov. Customer agrees. Approved on those dates. |
| `reservation-offer-decline` | extra | Same offer. "לא תודה" leaves it pending and asks for other dates. |
| `reservation-offer-other-dates` | extra | Same offer. Customer asks for Monday–Wednesday. Pending stay moves. |
| `reservation-link-stay` | link | Villa sends a booking link. No request. Cadence 7 days. |
| `reservation-link-fresh-thread` | link | Same link, then a new conversation. Cadence 7 days. |

Smoke and full use the hold tenant. Link uses the link tenant (`pool: "link"`). A variant shares the scenario's `decide` and `followUp` and only changes the customer lines. Different follow-ups are separate scenarios, which is why the three staff-offer replies are not variants.

## Add a scenario

1. Put it in the matching file under `scenarios/`. Hebrew customer lines. Reuse a shared turn list when the opening is the same.
2. Choose the suite. A new path starts as `extra` unless it should run on every default smoke run. Link behavior stays in the link file with `pool: "link"`.
3. `expect` is the hard state check (request, approval task, weekday, session, reply substrings). `review` is the note for a person reading the transcript.
4. One line in [catalog.md](scripts/agent-scenarios/catalog.md).
5. An empty row in [results.md](scripts/agent-scenarios/results.md) so the map shows it before the first run. Columns: Scenario, Variant, Cadence, Last run, Result, What went wrong, Conversation.
6. Run `--only` that id on port 3001. The runner fills the row and the Conversation link.

## Change a scenario

Edit the turns, `expect`, or `review`, then run `--only` that id. Do not hand-edit Last run, Result, or What went wrong. The runner replaces the row and keeps every other row, including results it does not recognize (such as `passed informally`).

## Purge scenario conversations

One command. It deletes leads whose sender starts with `demo-scenario-`, on the booking, hold, and link tenants the server already allows. Real customer leads are not deleted. The results table and `scenario-runs/` files stay.

```bash
npm run scenarios -- --base-url http://localhost:3001 --purge
npm run scenarios -- --base-url http://localhost:3001 --purge-before 2026-11-01
npm run scenarios -- --base-url http://localhost:3001 --purge-lead <leadId>
```

`--purge-before` deletes leads created before local midnight of that day. Leads created on that day stay. Pass a `YYYY-MM-DD` date. Do not combine `--purge-lead` and `--purge-before`.

## When the flow changes

A scenario is a script of answers in a fixed order. If a collect step is removed, added, or reordered, those answers no longer match the questions, and the scenario is expected to fail.

That failure is the signal. Read the new transcript and see which customer line answered a question the agent no longer asks, or skipped one it now asks. Update the turns to the new order, then re-run only that scenario.

Do not loosen `expect` to hide the mismatch. Do not change the agent so it accepts an answer to a question it did not ask. Change `expect` only when the product contract itself changed, and say that in the review note.

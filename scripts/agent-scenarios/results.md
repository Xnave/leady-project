# Scenario results

Updated by `npm run scenarios`. A row stays until that scenario runs again.
Cadence is how many days a passing run can wait before `npm run scenarios -- --due` selects it.
Scenarios with an empty cadence run whenever their suite runs.
The link suite is not part of the default smoke run. Use `--suite link`.

| Scenario | Variant | Cadence | Last run | Result | What went wrong | Conversation |
| --- | --- | --- | --- | --- | --- | --- |
| booking-bad-time | hour-25 |  | 2026-10-29 16:56 | pass |  | [2026-10-29-1656](../../scenario-runs/test-conversations-2026-10-29-1656.md) |
| booking-bad-time | yesterday |  |  |  |  |  |
| booking-closed-day | saturday-then-tomorrow |  | 2026-10-29 17:02 | pass |  | [2026-10-29-1702](../../scenario-runs/test-conversations-2026-10-29-1702.md) |
| booking-decline | no |  | 2026-11-01 13:58 | pass |  | [2026-11-01-1358](../../scenario-runs/test-conversations-2026-11-01-1358.md) |
| booking-fresh-thread | tomorrow-10 |  | 2026-10-29 16:56 | pass |  | [2026-10-29-1656](../../scenario-runs/test-conversations-2026-10-29-1656.md) |
| booking-handoff | person |  |  |  |  |  |
| booking-happy-approve-reopen | tomorrow-10 |  | 2026-11-01 13:58 | pass |  | [2026-11-01-1358](../../scenario-runs/test-conversations-2026-11-01-1358.md) |
| booking-happy-approve-reopen | tuesday-morning |  |  |  |  |  |
| booking-nonsense | gibberish |  | 2026-10-29 16:56 | pass |  | [2026-10-29-1656](../../scenario-runs/test-conversations-2026-10-29-1656.md) |
| booking-not-a-booking | hours-and-price |  |  |  |  |  |
| booking-yes-too-early | yes |  | 2026-10-29 16:56 | pass |  | [2026-10-29-1656](../../scenario-runs/test-conversations-2026-10-29-1656.md) |
| reservation-bad-range | checkout-first |  | 2026-10-29 17:59 | pass |  | [2026-10-29-1759](../../scenario-runs/test-conversations-2026-10-29-1759.md) |
| reservation-change-dates | fri-sun |  | 2026-10-29 18:53 | pass |  | [2026-10-29-1854](../../scenario-runs/test-conversations-2026-10-29-1854.md) |
| reservation-declined | thu-sun |  | 2026-10-29 18:53 | pass |  | [2026-10-29-1854](../../scenario-runs/test-conversations-2026-10-29-1854.md) |
| reservation-fresh-thread | thu-sun |  | 2026-10-29 18:20 | pass |  | [2026-10-29-1820](../../scenario-runs/test-conversations-2026-10-29-1820.md) |
| reservation-happy-approve-reopen | couple-and-child |  |  |  |  |  |
| reservation-happy-approve-reopen | thu-sun |  | 2026-10-29 18:20 | pass |  | [2026-10-29-1820](../../scenario-runs/test-conversations-2026-10-29-1820.md) |
| reservation-link-fresh-thread | thu-sun | 7d |  | passed informally |  | [2026-10-29-1813](../../scenario-runs/test-conversations-2026-10-29-1813.md) |
| reservation-link-stay | thu-sun | 7d |  | passed informally |  | [2026-10-29-1813](../../scenario-runs/test-conversations-2026-10-29-1813.md) |
| reservation-not-a-stay | price |  | 2026-10-29 17:59 | pass |  | [2026-10-29-1759](../../scenario-runs/test-conversations-2026-10-29-1759.md) |
| reservation-offer-accept | thu-sun |  | 2026-10-29 19:08 | pass |  | [2026-10-29-1908-54](../../scenario-runs/test-conversations-2026-10-29-1908-54.md) |
| reservation-offer-decline | thu-sun |  | 2026-10-29 19:05 | pass |  | [2026-10-29-1907](../../scenario-runs/test-conversations-2026-10-29-1907.md) |
| reservation-offer-other-dates | thu-sun |  | 2026-10-29 19:05 | pass |  | [2026-10-29-1907](../../scenario-runs/test-conversations-2026-10-29-1907.md) |

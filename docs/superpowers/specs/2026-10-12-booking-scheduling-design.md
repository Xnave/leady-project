# Booking scheduling: propose a slot, approve or change

Status: draft for teammate review, 2026-10-12. Next step after approval: implementation plan.
ClickUp: [Simplify agent scheduling: propose a slot, approve or change](https://app.clickup.com/t/z8rp3f7xph)
Plain-language summary: [`2026-10-12-booking-scheduling-summary.md`](2026-10-12-booking-scheduling-summary.md)

## 1. Brief

**Goal.** When a customer wants a meeting, the agent proposes a concrete free slot right away and books it in at most two agent messages. Today it takes about six, and it can save a request with no time.

**Source of requirements, in priority order.**
1. The ClickUp task and its comment from 2026-10-12 (found while testing persona PR #20).
2. Product owner additions in the design session: an owner-chosen scheduling policy, and availability from external calendars, possibly several at once.

**Success.**
- Happy path: customer asks for a meeting → **message A** (proposed slot + ask for the name) → customer agrees and gives the name → **message B** (saved + short summary + "write me if anything should change"). Two agent messages.
- No request is ever saved without a concrete date and clock time.
- A part of the day ("אחר הצהריים") is never accepted as a time. It narrows the next proposal.
- An ambiguous reply ("לא") is never treated as approval.
- Customer wishes ("only mid-afternoon", "not tomorrow", "after work") are handled the same way every time, before or after a proposal.
- The agent never proposes a slot that is busy in any connected calendar or already requested in Leady.
- Adding a new calendar provider later (Google OAuth, Outlook Graph, Calendly) is one new file, with no change to the solver or the conversation flow.

**Out of scope.** Persona voice for booking copy (PR #20 is not on main; we leave a hook point). Multi-staff assignment (the data is shaped for it, v1 ships one resource). Writing meetings back into the owner's calendar. Auto-approval without a human. Google/Microsoft OAuth.

## 2. Decisions log

| Topic | Decision |
|---|---|
| Base branch | `main`, not stacked on the persona PR #20 |
| Persona voice for booking copy | Later. Copy is rewritten by hand to be shorter and warmer; one hook point where the persona rewrite plugs in after #20 merges |
| Overall approach | LLM understands, code decides, template speaks. The LLM turns customer wording into a typed constraint and classifies replies. A pure solver picks the slot. Replies come from templates filled by code |
| Confirm step | Removed. Save on acceptance, allow edits after |
| "Anything else?" step | Removed |
| Meeting details (`need`) | Auto summary at save time, seeded from the interest already gathered by `need-context.ts`. Not asked unless the owner opts in |
| Scheduling policy | Owner setting: soonest available / at least X hours or days ahead / ask the customer |
| Meeting length | Owner setting: 15, 30, 45, 60 or 90 minutes. Default 30 |
| No hours and no calendar | Fall back to "ask the customer", still require a concrete time |
| Busy slots | Pending and approved Leady requests block the slot |
| Out-of-hours wish | Owner setting. Default: decline politely and offer the closest in-hours slot. Option: pass it to the team as a flagged request |
| External calendars | Provider port + `requests` provider + ICS feed provider in this PR |
| Several calendars | Supported. A slot is free only if every calendar of the resource is free |
| Multiple staff | Config and solver modeled as `resources[]`; v1 UI and HITL use one resource |
| Where the owner configures it | Booking step of `OnboardWizard` (`/onboard`), stored on the booking `CapabilityInstance.config` |
| Calendar down | Propose from business hours; flag the request `availabilityUnverified` for the owner. Never block the chat |

## 3. What is wrong today (root causes on main)

| Symptom (from ClickUp) | Root cause |
|---|---|
| Six agent messages to book | Gap-by-gap `ask_field` (time → name → need) then `confirm_details` then affirm then `book_meeting`, in `src/lib/flow/capabilities/booking.ts` |
| Request saved with "בשעה ." | The hours gate in `save_fields` runs only when the tenant has business hours. With no hours, any text, including "אחר הצהריים", is saved as `time_preference` |
| "באיזו שעה הפגישה?" saved as meeting details | `save_fields` lets the model write anything into `need`; a confirm-step amendment path appends the last customer line onto `need` |
| A joke saved as the meeting purpose | Same path |
| "היום יום שלישי, 13 באוקטובר" when asked about tomorrow | The prompt only says what today is; the model does its own date arithmetic. `calendarClockLine()` also ignores the tenant timezone |
| "יתאים לך? ." | The reschedule template ends with `{{hours}}.`; an empty value leaves an orphan period |
| Bare "לא" taken as approval | The confirm step treats short replies loosely; there is no deterministic guard |
| Tone drops when booking starts | Fixed, long templates (`bookingConfirmIntro`, `bookingConfirmAsk`, request template) |

### 3.1 Recent booking fixes on main (2026-10-02 to 2026-10-08)

This design is written against `main` at `e7eff2e`, which includes all of them. How each one is treated:

| Commit(s) | What it fixed | In this design |
|---|---|---|
| `57fed7b` fix hour handling | Normalized `venueSchedule` saved on write, tenant timezone, `evaluateTimePreference` hours gate | **Kept and built on.** The solver reads `venueSchedule` and `timezone`; the hours gate stays for customer-named exact times |
| `1476e40`, `9865b3a` intent gather from prior messages | `need-context.ts`: `gatheredInterest`, `interestFromTranscript`, `save_interest`, deixis rejection | **Reused.** The auto meeting summary at save is seeded from gathered interest; `save_interest` stays in the idle (not booking) state |
| `9865b3a`, `0d2b53a`, `13f01ff` confirm step: amendments ("תוסיף…") while pending, duplicate confirm suppression, timeout | Robustness of the `confirm_details` → affirm loop | **Replaced.** The confirm step is removed, so these paths go away. Their scenarios move to after saving: an addition updates meeting details, a time change re-runs the solver. Their tests are rewritten for the new flow, not dropped |
| `cc16bd6`, `a7f985d` date formatting, short post-confirmation message | `formatSlotForDisplay` / `formatSlotPhrase`, short single-line ack and approval templates | **Reused.** Slot labels in messages A and B use the existing formatters; message B builds on the short ack |
| `da5e088` multiple replies bug | Idempotency in `run-turn.ts` and the demo route | **Untouched** |

## 4. Conversation flow

Session keys on `Conversation.session`: `booking_flow: "active"`, `slot_proposal: { startAt, endAt, label }`, `slot_constraint` (see §5). `booking_confirm` and `need_prompted` are removed.

### 4.1 Start

The customer asks for a meeting (`start_booking`, same trigger rules as today). The LLM extracts any time wish already in the message into the constraint. The solver picks a slot.

**Message A** (name missing): "אפשר ביום שלישי 13.10 ב־16:00? אם מתאים, רק שם מלא ואני רושמת 🙂"
**Message A** (name known): "אפשר ביום שלישי 13.10 ב־16:00? אם מתאים, אני רושמת."

Owner-required extras (phone, email, visit type, need when opted in) are asked inside the same message.

In `ask` mode, or with no hours and no calendar: "מתי נוח לך? (יום ושעה מדויקת) ורק שם מלא". If the answer is a part of the day: with hours, the solver proposes a concrete slot in that window; without hours, the agent asks for the exact hour.

### 4.2 The customer replies to a pending proposal

The reply is classified as one of five outcomes. A deterministic guard runs after the LLM: a bare negative ("לא", "no") or anything that names a different day or time can never be `accept`.

| Outcome | What happens |
|---|---|
| `accept`, required fields present | Re-check the slot is still free → create the Request (HITL as today) → **message B** |
| `accept`, a required field missing | Ask only for the missing field(s), keep the proposal, then save |
| `change` with a wish ("רביעי בבוקר", "only mid-afternoon") | Refine the constraint, add the rejected slot to `rejectedSlots`, propose again (message A shape). An exact in-hours time is used as is |
| `change` with no wish, or a bare "לא" | Propose the next free alternative + "או כתבו מה נוח לכם" |
| `question` ("באיזו שעה?", "כמה זמן זה?") | Answer it, then repeat the pending proposal line. Nothing is stored |
| `unclear` | Ask again: "מתאים {slot}?" |

If the slot was taken between proposal and acceptance (another customer, a new calendar event), the agent says so and proposes the next free slot.

**Message B**: "רשמתי! פגישה ביום שלישי 13.10 ב־16:00 על שם גבע אברהם. נציג יאשר סופית בקרוב. אם צריך לשנות משהו, פשוט כתבו לי."

### 4.3 After saving

Changes go through the existing recent-meeting path. A time change runs the same constraint → solver → availability check, then `retimeRequest`. Detail edits stay on `update_meeting_details`. Staff approve / decline / reschedule is unchanged.

### 4.4 Worked example: wishes before and after a proposal

Business hours Sun–Thu 09:00–19:00. Now is Monday 12.10, 20:00. Policy: soonest. Duration 30.

- Proposal: "מחר (שלישי 13.10) ב־09:00?"
- Customer: "רק אחר הצהריים באמצע, בערך" → `change`, constraint `window 14:00–16:00`, `rejectedSlots += 13.10 09:00` → "אין בעיה. מחר ב־14:00 מתאים?"
- Customer: "לא מחר" → `change`, `dates.exclude += 13.10` → "אז רביעי 14.10 ב־14:00?"
- Customer: "כן, גבע אברהם" → `accept` + name → save → message B.

If the customer had said "רק אחר הצהריים" in the first message, the first proposal would already be 14:00. Same code path; the only difference is whether a proposal is pending.

If the customer says "רק אחרי שעות העבודה": the solver returns `outside_hours`. Default reply: "השעות שלנו עד 19:00. הכי מאוחר שאפשר: מחר ב־18:30. מתאים?". With the owner setting `ask_team`, the reply adds "או שאבדוק עם הצוות אם אפשר בערב", and acceptance creates a Request flagged `outsideHours` for the owner to decide.

## 5. Constraints and the solver

### 5.1 `SlotConstraint`

```ts
type SlotConstraint = {
  dates?: { from?: IsoDate; to?: IsoDate; weekdays?: number[]; exclude?: IsoDate[] };
  dayparts?: Daypart[];                       // "morning" | "midday" | "afternoon" | "evening" | "after_hours"
  window?: { from?: HHMM; to?: HHMM };        // "after 16:00", "mid-afternoon" → 14:00–16:00
  exact?: { date?: IsoDate; time?: HHMM };
  rejectedSlots: IsoDateTime[];               // never offered again in this booking
};
```

- **Extraction.** One structured LLM tool, `set_time_preferences`, with a zod schema and `merge: "refine" | "replace"`. The LLM never writes time text into a lead field.
- **Dates are resolved by code.** The prompt carries a 14-day table in the tenant timezone ("מחר = שלישי 13.10", …), so the model copies an ISO date instead of computing one. This also fixes the wrong "today".
- **No LLM key.** The existing heuristics in `slot.ts` fill the same struct, so tests stay key-free and the app still works.
- **Dayparts** are named windows with defaults (morning 08:00–12:00, midday 12:00–14:00, afternoon 14:00–17:00, evening 17:00–21:00). The owner can override them in config.
- **Merge rules** are code: `refine` intersects with the current constraint, `replace` starts over but keeps `rejectedSlots`.

### 5.2 Solver

A pure function in `src/lib/scheduling/solver.ts`:

```ts
findSlots({ now, timeZone, policy, schedule, busy, constraint, durationMinutes, stepMinutes, limit })
  → { slots: Slot[]; outcome: SolverOutcome }

type SolverOutcome =
  | { kind: "exact_ok" }
  | { kind: "match" }
  | { kind: "relaxed"; dropped: "dates" | "daypart" | "window" }
  | { kind: "outside_hours"; latestInHours?: Slot }
  | { kind: "none"; blockedBy: "busy" | "hours" | "constraint" };
```

- Candidate starts on a `stepMinutes` grid (default 30) inside the weekday's schedule window, ending no later than closing (keeps today's "latest start 30 minutes before closing" rule by using duration).
- Earliest start: `now + minNoticeMinutes` (soonest: default 60; notice: owner X; ask: no proposal until the customer names a time).
- Excluded: busy intervals overlapping `[start, start + duration)`, `rejectedSlots`, constraint mismatches.
- Search horizon: 30 days.
- **Relaxation ladder** is fixed in code: widen dates by 7 days, then widen daypart to the full day, then drop the window. The reply names what was relaxed ("ביום שלישי אחר הצהריים הכול תפוס. הכי קרוב: רביעי ב־14:00").
- Deterministic: same inputs, same slot.

### 5.3 Replies

One template per (outcome, missing fields) pair, in `copy/he.ts` and `copy/en.ts`, with two or three phrasing variants chosen deterministically per conversation. The slot label is formatted by code. Persona hook: after #20 merges, a rewrite pass may rephrase the template, and a **fact-lock check** requires the exact date and time tokens in the output, or the template is sent unchanged.

## 6. Availability

### 6.1 Port

```
src/lib/scheduling/
  constraint.ts       SlotConstraint type, merge, heuristic extraction
  dayparts.ts
  solver.ts           findSlots (pure)
  availability/
    types.ts          AvailabilityProvider
    registry.ts       registerAvailabilityProvider(kind, factory)
    requests.ts       Leady pending + approved Requests (tenant-filtered)
    ics.ts            ICS feed
    composite.ts      resources → merged busy intervals
```

```ts
interface AvailabilityProvider {
  busy(range: { from: Date; to: Date }): Promise<
    | { status: "ok"; intervals: BusyInterval[] }
    | { status: "unavailable"; reason: string }
  >;
}
```

The interpreter stays domain-free. The booking capability gets availability through `run-turn.ts` (the only place ports are wired), so tests pass a fake provider.

### 6.2 Several calendars, resources

```ts
scheduling.resources = [
  { id: "default", label: "…", sources: [{ kind: "requests" }, { kind: "ics", urlEnc, label }, …] },
];
```

- A resource's sources are unioned: a slot is free only if every calendar is free (for example the owner's personal and work calendars).
- v1 has one resource. Multi-staff later means "free if any resource is free" in `composite.ts` plus `resourceId` on `Request.data`. No rework of the solver or the flow.
- A new provider is one file plus one `registerAvailabilityProvider` call.

### 6.3 ICS provider

- Owner pastes a private ICS link. Works with Google Calendar ("secret address in iCal format"), Outlook / Microsoft 365 (published calendar), iCloud (shared calendar), Zoho, Fastmail, Proton, Nextcloud / CalDAV, and booking tools that export ICS (Acuity, Setmore, SimplyBook). Calendly and Cal.com do not; owners use the calendar those tools sync into.
- Parsing uses a library for recurring events (`ical.js` with its RRULE expansion; one `npm install` run by the team, since our setup avoids installs from the agent). Handled: `DTSTART`/`DTEND`/`DURATION`, `TZID`, all-day events, `RRULE` + `EXDATE` + `RECURRENCE-ID`, `STATUS:CANCELLED` and `TRANSP:TRANSPARENT` skipped.
- Fetch: https only, DNS-resolved private/loopback/link-local addresses rejected (SSRF), redirects re-checked, 3 s timeout, 2 MB cap.
- Cache: in memory per server instance, 5 min TTL, keyed by source id. No DB table in v1.
- Secret: the URL is encrypted with `src/lib/crypto.ts` and never sent back to the client (shown masked).
- Read-only. Leady does not write into the owner's calendar.

### 6.4 Failure policy

`onSourceError: "hitl"` (default): when a source is unavailable, propose from hours plus the sources that answered, and flag the Request `availabilityUnverified` so the owner checks it. `"ignore"`: same, without the flag. The chat is never blocked by a calendar.

The final availability re-check at save closes the race between two customers proposed the same slot.

## 7. Settings and data

### 7.1 Owner UI

Booking step of `OnboardWizard` (`/onboard`), new "Scheduling" block. It moves to the agent settings page once PR #20 lands.

- How to propose: Soonest available / At least [X] [hours | days] ahead / Ask the customer
- Meeting length: 15 / 30 / 45 / 60 / 90 (default 30)
- Out-of-hours wishes: Decline politely / Ask the team
- Calendars: list with label and masked link, "Add calendar (ICS link)", "Test" (fetch and show the next three busy blocks), remove. Short help per provider on where to find the link.
- When there are no hours and no calendar: a note that the agent will ask customers for a time.
- Collect fields: `need` leaves the defaults and becomes an opt-in. Name and time stay locked.

UI text goes in `src/lib/ui/` (en + he).

### 7.2 Config shape

On the booking `CapabilityInstance.config` (no Tenant columns):

```ts
scheduling: {
  mode: "soonest" | "notice" | "ask";
  minNoticeMinutes: number;          // soonest default 60; notice = owner X
  durationMinutes: 15 | 30 | 45 | 60 | 90;
  stepMinutes: 30;
  dayparts?: Partial<Record<Daypart, { from: HHMM; to: HHMM }>>;
  outOfHours: "decline" | "ask_team";
  resources: Resource[];
  onSourceError: "hitl" | "ignore";
}
```

Parsed with defaults in `booking-config.ts`, so existing tenants behave as `soonest` / 30 min / decline / one resource with the `requests` source. Saved through the existing onboard route, validated on write.

### 7.3 Request

`startAt` / `endAt` come from the solver slot, with the real duration. `Request.data` adds `outsideHours?`, `availabilityUnverified?`, `resourceId`. JSON only, no migration.

### 7.4 Rollout

- No schema migration.
- Conversations mid-booking at deploy time with `booking_confirm: "pending"`: treated as a pending proposal of their stored time, so the next "כן" saves it. No stuck chats.
- Config defaults mean no tenant needs to do anything on deploy.

## 8. Bug fixes in the same change

| Bug | Fix |
|---|---|
| Empty time saved | A Request needs a resolved `startAt`; the gate runs always, not only when hours exist |
| Question / joke saved as details | No LLM write path into `need`; it is summarized at save. Questions are classified and answered |
| Wrong "today" | 14-day date table in the prompt; `calendarClockLine` takes the tenant timezone |
| "יתאים לך? ." | Template renderer drops empty variables and the orphan punctuation around them; reschedule template fixed |
| "לא" as approval | Deterministic guard on the classifier |
| Long robotic copy | New short A/B templates, he + en |
| Tenant isolation | `summarizeConversation` looks up the conversation by id only; add the `tenantId` filter (CLAUDE.md rule), since this flow now calls it |

## 9. Testing

- `solver.test.ts`: each policy, min notice, duration vs closing time, busy overlap, per-weekday hours, stacked constraints, rejected slots, every relaxation step, out-of-hours, DST change week, horizon end.
- `constraint.test.ts`: heuristic extraction in he and en ("אחר הצהריים", "רק אחרי 16", "לא מחר", "mid-afternoon", "after work"), merge refine vs replace.
- `ics.test.ts`: fixtures with weekly RRULE + EXDATE, moved instance (`RECURRENCE-ID`), all-day, `TZID`, cancelled, transparent; SSRF guard (private IP, http, redirect to private), size and timeout limits.
- `composite.test.ts`: two calendars unioned; one source down → `availabilityUnverified`.
- Booking flow with fake ports: happy path is exactly two agent messages; change with a wish; bare "לא"; question during a proposal; slot taken at save; ask mode; no hours; out-of-hours with both settings; a legacy `booking_confirm: pending` session.
- `architecture.test.ts` stays green.
- Manual: replay the ClickUp conversation in the demo chat in Hebrew; settings "Test" button against a real Google ICS link.

## 10. Open questions for review

- Message B says "נציג יאשר סופית בקרוב" because a human still approves every request. Should an owner be able to auto-approve slots that a connected calendar shows as free? (Proposed: later.)
- Default dayparts: is "אחר הצהריים" 14:00–17:00 right for our first verticals (clinics, beauty, villas)?

# Scenario catalog

Hebrew only. Nothing in this file runs until it is copied into [scenarios/booking.ts](scenarios/booking.ts) or [scenarios/reservations.ts](scenarios/reservations.ts) and marked `primary` (every suite run) or `sample` (`--sample` may pick it).

A variant keeps the scenario's state checks and changes the customer lines. Override `expect` only for output that should differ. The review note is where wording, smoothness, and Hebrew gender are judged.

Lines below are generalized from Hebrew production threads (visit booking and stay requests) and from [docs/conversation-simulations.md](../../docs/conversation-simulations.md). They do not copy a real customer's name or phone.

## Already running

Smoke, primary variant:

- `booking-happy-approve-reopen` — visit, then "כן", then approve, then thank-you. Name and phone stay. The visit time, need, and booking flags clear. `name_collected_by_agent` is not required to clear.
- `booking-bad-time` — impossible hour, then "מחר ב-10". The time must be stored, and the last reply must not ask for a day and time again. No LLM judge: a plausible hours question that ignores the correction fails.
- `booking-closed-day` — Saturday at 10, then "מחר ב-10". Same capture check as a bad hour.
- `booking-decline` — the visit details, then "לא" instead of "כן". No request and no approval task.
- `booking-yes-too-early` — "כן, תסגרי" before any field. No request.
- `booking-nonsense` — gibberish. No request.
- `booking-fresh-thread` — after the visit is approved, end the chat and send a new message. New conversation id, name kept, previous time and need gone.
- `reservation-happy-approve-reopen` — Thursday to Sunday, five guests, approve, thank-you.
- `reservation-bad-range` — check-out before check-in. No hold.
- `reservation-fresh-thread` — same second-conversation check for a stay.

Sample variants (only with `--sample`):

- Booking happy, "יום שלישי בבוקר" instead of "מחר ב-10".
- Booking bad time, "אתמול" instead of "25:00".
- Reservation happy, "שני עד רביעי" plus "אני לא בטוחה". Same pending request. Review the feminine address.

Full suite (`--suite full` also runs smoke):

- Question that must not open a request, for a visit and for a stay.
- Complaint that asks for a person.

## Same booking, different input

Copy onto `booking-happy-approve-reopen` as `sample` variants. State stays: pending request, open approval task, then an approved request and a cleared session.

- Time first, then name, then need, then "כן". This is the primary. The yes is what creates the pending request before approve.
- Name first: "קוראים לי דנה כהן", then the time, then the need.
- Phone first: "0501234567, אפשר ביקור מחר ב-10?". Review: the agent should not ask for the phone again. Expect override: `crmPresent` includes `phone` before the last turn only if you split the check. Until then, put that in the review note.
- Everything in one message: "דנה כהן, 0501234567, פגישת ייעוץ מחר ב-10".
- Evening: "ביום שלישי ב-6 בערב".
- Day letter: "יום ב בשעה 18:00".
- "מחרתיים בבוקר".
- "בערב" with no day, then a correction that supplies the day.

Customer gender, same state. The review note says whom to address:

- "אני לא בטוחה מאיפה להתחיל, אבל אפשר ביקור מחר ב-10?"
- "אני לא בטוח, אפשר ביקור מחר ב-10?"

Voice and typos, same state:

- One word, then the rest: "ביקור" / "מחר ב-10" / "דנה כהן".
- Slang opener: "אהלן, מה העניינים? רוצה לקבוע ביקור מחר ב-10".
- Typo: "אפשר לקבע ביקור מחר ב10".

## Wrong booking input

Same collect step. The hard check is no approved request, and no identical reply twice. Some of these must also stay at `request: "none"`.

- Already running: "ב-25:00", then "מחר ב-10" (`booking-bad-time`). The correction must be captured. Sample: "אתמול".
- Already running: Saturday, then "מחר ב-10" (`booking-closed-day`).
- Two times in one message: "מחר ב-10 או ביום חמישי ב-4".
- "כן" before any detail is `booking-yes-too-early`. "למה?" before any detail is still catalog-only.
- Already running: "לא" after the details are collected (`booking-decline`). No request.
- A question in the middle of collect: "רגע, כמה זה עולה?" and then the missing field. The request can still be created after the field arrives. Review that the price answer did not invent a number.

## Same stay, different input

Copy onto `reservation-happy-approve-reopen`. State stays: pending hold, then approved, session dates and guests cleared, name kept.

- Explicit range plus party size. This is the primary ("חמישי עד ראשון", "5 אנשים").
- "סוף שבוע הקרוב, 4 אנשים".
- "שני לילות מסוף השבוע".
- Guests before dates: "אנחנו 6" then "24 עד 26 בחודש".
- "זוג פלוס ילד" instead of a number. The sample variant "couple-and-child" is the running version of this.
- Change of dates after they were given: "בעצם לא חמישי, שישי עד ראשון". The stored range should be the corrected one. Review the summary the agent repeats.
- Name on its own line after the dates. Seen often in real threads.
- "אשמח לבדוק זמינות" before committing. A later "כן" may create the hold. Review that availability talk did not confirm the stay.

## Wrong stay input

- Already running: check-out before check-in (`reservation-bad-range`).
- Same calendar day for check-in and check-out.
- "0 אורחים" or guests omitted, then a real number.
- A date with no month: "ב-8 ליומיים".
- Price in the middle of a hold: "אבל מה המחיר?". The hold can continue. Review that a missing price is not invented. A price question with no dates is `reservation-not-a-stay`.

## Not a transaction

- Hours, then price, with no request. Running as `booking-not-a-booking`.
- "מה המחיר ללילה?" with no request. Running as `reservation-not-a-stay`.
- Out of scope: "מי נשיא בריטניה?" No request. Review a short refusal and a way back to the business.
- "את הדס?" or another guess at the agent's name. Review that the answer matches the persona name and gender, and that no request opens.

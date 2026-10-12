# Booking a meeting: what we are changing and why

A short, plain version of the [full design](2026-10-12-booking-scheduling-design.md). ClickUp: [Simplify agent scheduling: propose a slot, approve or change](https://app.clickup.com/t/z8rp3f7xph).

## The problem

When a customer wants a meeting, our agent runs a long questionnaire:

1. "What day and time?"
2. "What's your full name?"
3. "Here's what I understood, anything else?"
4. "Here are the details, is everything correct?"
5. "Saved."

That is about six messages. It feels robotic, and in testing it also broke:

- It saved a meeting with **no time** ("Tuesday afternoon" was taken as a time, so the message said "at ." with nothing after "at").
- A customer's **question** ("what time is the meeting?") was saved as the meeting topic.
- A **joke** was saved as the meeting topic.
- It got **tomorrow's date wrong**.
- A plain **"no"** was taken as "yes, book it".
- A message ended with a **stray period**.

## The new experience

The agent suggests a time itself, like a good receptionist would.

> **Customer:** I'd like to set up a meeting
> **Agent:** How about Tuesday 13.10 at 16:00? If that works, just send your full name and I'll book it 🙂
> **Customer:** Works, Geva Avraham
> **Agent:** Booked! Tuesday 13.10 at 16:00 for Geva Avraham. We'll confirm shortly. If anything should change, just write me.

Two messages from the agent instead of six. No "anything else?" step and no "is everything correct?" step. The customer can still change things after it's saved.

## When the customer wants something else

The customer can say what suits them, before or after the suggestion:

- "Only mid-afternoon" → the agent suggests 14:00 instead.
- "Not tomorrow" → the agent moves to the next day.
- "No" → the agent suggests another time and says "or tell me what works for you".
- "What time did you say?" → the agent answers. Nothing gets saved.
- "After work hours" → by default the agent explains the opening hours and offers the latest possible slot. The owner can choose to pass these requests to the team instead.

Each wish is remembered, so the agent never suggests a time the customer already turned down.

## How it works, simply

- **The AI understands the customer.** It turns "only mid-afternoon, not tomorrow" into a clear rule like "14:00 to 16:00, not on the 13th".
- **Our code picks the time.** It checks opening hours, meetings already booked, and the owner's calendars. Same rule in, same time out. The AI does not pick times and does not do date math.
- **Fixed wording carries the facts.** The date and time in every message come from our code, so they can't be wrong or empty.

## What the business owner can set

In the booking settings:

- **How the agent suggests a time:** the soonest free time, at least X hours or days ahead, or ask the customer when suits them.
- **Meeting length:** 15, 30, 45, 60 or 90 minutes (default 30).
- **Requests outside opening hours:** decline politely, or pass to the team.
- **Calendars:** connect one or more calendars with a private calendar link. Works with Google Calendar, Outlook, iCloud and most other calendars. The agent never suggests a time that is busy in any of them, or already requested by another customer.

If the owner set no opening hours and no calendar, the agent asks the customer for a day and an exact time.

## Built to grow

- **More calendar types later** (a direct Google login, Calendly and others) plug in without touching the conversation.
- **Several staff members later** (for example "any free consultant"): the setup already allows for it. This first version handles one person or team.
- **The agent's personal tone** (the persona work in PR #20) will be applied to these messages once that PR is merged. The facts stay fixed.

## What does not change

- A person from the business still approves every meeting request, as today.
- Approve, decline and "offer another time" from the inbox work as before.
- No database changes. Existing businesses get sensible defaults with nothing to set up.
- The recent booking fixes on main (opening hours handling, gathering what the customer wants from earlier messages, date formatting, short confirmation messages, duplicate replies) are kept and reused. Only the fixes to the old "is everything correct?" step go away, because that step is removed. Section 3.1 of the full design lists each one.

## Questions for the reviewer

1. Should an owner be able to skip their own approval when their calendar shows the time as free? (Proposed: later.)
2. Is "afternoon" = 14:00 to 17:00 right for our customers?

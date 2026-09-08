# Conversation simulations — agent review

Five scripted conversations were pushed through the live app on **2026-09-03** using `POST /api/demo/message` (persist inbound → `runTurnNow` → LLM turn → reply saved). Each used a fresh `demo-sim-*` sender, so outbound delivery is skipped but everything else is the real production path.

## Tenant under test

| | |
|---|---|
| Business | מטבחי הזהב בע"מ (`cmtfvnkn80000cgvyehys0s2r`) |
| Channel | `whatsapp` |
| Catalog | `inbox` |
| Chat language | `he` → system prompt "Reply only in Hebrew. Never mix in English filler." |
| Intro (canned first reply) | שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור? |
| Required to book | `time_preference`, `name`, `need`, **`phone`** |
| Hours / address | ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00 · רחוב הרוגוזין 14, אזור התעשייה חולון |
| Knowledge | 1,624 chars: business details, services, team, testimonials. **No pricing, no warranty terms, no measurement/home-visit policy.** It does say the business installs *בבית הלקוח* and serves תל אביב / גוש דן / שרון. |

## Scoreboard

| Metric | Result |
|---|---|
| Conversations | 5 (21 customer messages, 20 agent replies) |
| Meetings created | **0** |
| Escalations to human | 1 (correctly triggered) |
| First customer message interpreted | **0 of 5** |
| `name` captured | 3 of 5 |
| `time_preference` captured | 2 of 5 (missed in the one conversation that stated it first) |
| `intent` captured | 1 of 5 — and it was wrong (`sales` for a warranty claim) |
| English-in → Hebrew-out | 4 of 5 conversations |

Two conversations reached "every booking fact known except one" and then stalled on that one. Nothing reached the CRM as a booking.

---

## How a turn actually resolves

Four mechanics explain almost every reply below.

1. **The first customer message is never shown to the model.** `shouldSendCannedIntro` fires when no agent message exists yet ([intro.ts](../src/lib/flow/intro.ts)), and `talkTurn` has a second guard doing the same ([llm.ts](../src/lib/flow/llm.ts)). The turn returns `tenant.intro` verbatim and no extraction runs.

2. **A booking attempt with any gap deletes the model's reply.** In `talkTurn`, if `book_meeting` was called and `bookingFieldGaps` is non-empty, `collected.reply` is *overwritten* with the canned `askBookingField(gap[0])` string. The customer loses the acknowledgement the model wrote, and two consecutive attempts produce two byte-identical messages.

3. **Opening hours get appended to any question while `time_preference` is unknown.** The condition is `reply.includes("?") && askingTime`, not "the reply is asking about time" — so hours were pasted under "?למה אתה זקוק".

4. **`waiting_human` silences the thread.** `interpretTurn` returns early, so follow-up messages are stored with no reply and no acknowledgement.

---

## Findings

### P1 · The opening message is thrown away, and sometimes never recovered

Every conversation opened with the same welcome regardless of what was said — including "I want a quote for a new kitchen", "Your installer never showed up. This is the third time.", and "Book me tomorrow 9am".

Worse than a wasted turn: in simulation 5 the customer's "tomorrow 9am" was never saved. The model even repeated it back in prose two turns later ("...מחר בשעה 9:00") while `time_preference` stayed empty, so the last reply asked for a day and time again.

**Fix** — in `interpretTurn`, stop returning early. Run the talk stage always, and when no agent has replied yet, prefix `cannedIntroText(ctx)` to the model's reply. Remove the duplicate guard in `talkTurn`. Extraction then covers turn 1 like any other turn.

### P1 · Booking never completes because `phone` can never be filled

`phone` is required for this tenant. `callbackPhone()` reads `lead.fields.phone`, falling back to `ctx.channel.customerPhone` — but `loadTurnContext` sets `customerPhone` *from* `lead.fields.phone`. The fallback is circular and can never contribute a number. The only writer is `persistInboundIfNew`, which fills `fields.phone` only when the WhatsApp sender id looks numeric.

So demo leads (`demo-…`) and Instagram leads can never satisfy `phone`, and both booking conversations died there — twice each, with the identical canned sentence.

**Fix** — three separate changes:
- Fall back to `lead.externalUserId` in `callbackPhone` when it looks like a phone number, instead of re-reading the same field.
- Drop `phone` from the gap list when the channel cannot produce one (demo lead, or Instagram where the handle is the identity).
- Never send the same `askBookingField` text twice in a row; if the previous agent message already asked for that field, say why it's needed or offer to proceed without it.

### P1 · The model's own words get discarded at the worst moment

Simulation 2, turn 4: customer gives the time. Turn 5: "Yes please request that visit". Both replies are the same canned phone question, because mechanic #2 replaced whatever the model wrote. From the customer's side the agent looks stuck in a loop and deaf to "yes".

**Fix** — keep the model's reply and append the single missing ask, rather than substituting it.

### P2 · The agent invites people to the workshop, contradicting its own knowledge

The customer said "I need someone to come measure". The agent answered "מתי נוח לך להגיע" and "לבקר אצלנו למדידה", and in simulation 5 gave the industrial-zone address with "אנשי הצוות יהיו שם". The knowledge base says the business installs at the customer's home and serves specific regions — so the agent is steering people the wrong direction and implying a staffed showroom.

**Fix** — make the visit direction explicit data, not prose: enable `visit_kind` for this tenant (home measurement vs showroom), and change the time question to a neutral "?באיזה יום ושעה נוח לך" until direction is known. Only quote the address once direction is `showroom`.

### P2 · The escalation loses the complaint and then goes silent

The hand-off itself worked. But the HITL task reason is the hardcoded English string `"Customer asked for a person"` ([run-turn.ts](../src/lib/flow/run-turn.ts)); `ui.inbox.reasons` only maps `support_unresolved`, so `hitlReasonLabel` falls through and a Hebrew-speaking operator sees raw English. The actual grievance — a third missed installation — is nowhere in the task. The customer's next message got no response at all.

**Fix** — pass a short summary of the customer's issue as the reason, add the reason keys to `ui.inbox.reasons`, and send one holding line the first time an inbound arrives while `waiting_human` ("קיבלנו, נציג חוזר אליך").

### P2 · Extracted values are translated, and the leads list can't find them

"Dana Levi" was stored as `name: "דנה לוי"`; "quote for a new kitchen" became `need: "הצעת מחיר למטבח"`. Simulation 5 stored English (`Avi`, `warranty claim visit`). Same tenant, mixed-language CRM values, and names that no longer match what the customer typed.

On top of that, `displayName` is written once at lead creation and never updated from `fields.name`, and `/leads` search only queries `displayName` and `externalUserId`. Searching **דנה** against this database returns **0 rows** even though the lead exists.

**Fix** — instruct extraction to preserve the customer's original wording (names especially), update `lead.displayName` when a name is extracted, and add `fields.name` to the leads search filter.

### P3 · Hours are repeated to the point of noise, sometimes irrelevantly

Hours appeared in three consecutive replies in simulation 3, and were appended to a question about *need* in simulation 5.

**Fix** — tie the append to the field actually being asked, and suppress it if the previous agent message already contained the hours string.

### P3 · Knowledge gaps produce polite non-answers with no exit

Warranty, pricing, and measurement policy are genuinely absent from the knowledge base, so the vague answers were honest — but the agent never offered the public phone (`03-9876543`, already in its system prompt) and never escalated. A four-turn conversation ended with zero lead data captured.

**Fix** — add an explicit rule: when the answer isn't in knowledge, say so, offer the public phone or a callback, and log the unanswered question so ops can see which gaps cost leads.

### P3 · Intent is nearly never captured, and was wrong when it was

`set_intent` is an optional tool the model mostly skips: 1 of 5 conversations. That one labelled "warranty claim visit" as `sales`. The CRM intent column stays empty and the HITL policy's intent filter has nothing to work with.

**Fix** — derive intent from the turn instead of relying on an optional tool call, and treat warranty/complaint wording as `support`.

### P3 · Language policy is working as configured, but the default hurts

Hebrew-only is the tenant's setting, so English customers getting Hebrew is correct behaviour — not a bug. It's still four of five conversations answered in a language the customer didn't use. Separately, an Arabic word (`לزيارة`) leaked into a Hebrew reply in simulation 5, which the "never mix languages" rule is supposed to prevent.

**Fix** — default new tenants to `multi` (match the customer) and describe the `he` option as "always Hebrew, even to English speakers". Add a cheap script check on the outgoing reply when the policy is `he` and log violations.

---

## Change list, in the order I'd do it

| # | Change | Where |
|---|---|---|
| 1 | Run the talk stage on turn 1; prefix the intro instead of returning early | `flow/interpreter.ts`, `flow/llm.ts` |
| 2 | Stop overwriting the model reply on a booking gap; append the ask instead | `flow/llm.ts` |
| 3 | Make `phone` satisfiable (`externalUserId` fallback) or not required per channel | `flow/booking-collect.ts`, `conversations.ts` |
| 4 | Never repeat an identical collect prompt twice in a row | `flow/llm.ts` |
| 5 | Capture visit direction (`visit_kind`); neutral time question until known | tenant flow config, `copy/*` |
| 6 | Real escalation reason + localized labels + one holding reply | `flow/run-turn.ts`, `ui/*`, `flow/interpreter.ts` |
| 7 | Preserve original wording on extraction; sync `displayName`; search `fields.name` | `flow/llm.ts`, `conversations.ts`, `app/leads/page.tsx` |
| 8 | Append hours only to the time question | `flow/llm.ts` |
| 9 | "Not in knowledge" → offer phone/human and log the gap | `copy/*`, `flow/llm.ts` |
| 10 | Derive intent every turn; warranty/complaint → `support` | `flow/llm.ts` |

Items 1–4 alone should take booking completion from 0 of 2 to 2 of 2 on these scripts.

---

## Simulation 1 — Greeting, then two knowledge questions

Lead `cmtlegshd000zcgld6nydat0a` · ended `talk` / `open` · fields `{}` · no meeting

| Role | Message |
|------|---------|
| lead | hi |
| agent | שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור? |
| lead | How do I reset the filters? |
| agent | אני מצטער, אבל אני כאן לעזור עם מידע על מטבחי הזהב. אם יש לך שאלה על המוצרים או השירותים שלנו, אשמח לעזור! |
| lead | And what's the warranty on that? |
| agent | במטבחי הזהב אנו מציעים אחריות על המוצרים והתקנות בהתאם לסוג המוצר. אם יש לך שאלה ספציפית לגבי מוצר מסוים, אשמח לנסות לעזור!<br>אם תרצה לקבוע פגישה עם אחד מהיועצים שלנו, אני כאן כדי לסייע. |
| lead | Thanks that's all I needed |
| agent | אני שמח שיכולתי לעזור! אם תזדקק למידע נוסף או תרצה לקבוע פגישה בעתיד, אל תהסס לפנות אלינו. יום נעים! |

**Verdict.** Deflecting the filter question is right — it's a kitchen company and there's nothing about filters in knowledge. The warranty answer is honest hedging for the same reason, but it should have offered `03-9876543` or a callback rather than trailing off. Four turns, zero fields, no intent, no next step. This is the "polite dead end" pattern.

## Simulation 2 — English sales enquiry, wants an on-site measurement

Lead `cmtleh51m001pcgldpre22tod` · ended `talk` / `open` · `{ name: "דנה לוי", need: "הצעת מחיר למטבח", time_preference: "יום שלישי בשעה 10:00" }` · **no meeting**

| Role | Message |
|------|---------|
| lead | Hi, I want a quote for a new kitchen |
| agent | שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור? |
| lead | It's a 12 square meter remodel, I need someone to come measure |
| agent | כדי שאוכל לעזור לך לקבוע פגישה למדידה, אשמח לדעת מתי היית מעוניין להגיע. אנחנו פתוחים בימים א'-ה' מ-09:00 עד 19:00 וביום שישי מ-09:00 עד 13:00. |
| lead | Dana Levi |
| agent | מה השעה שמתאימה לך לבקר אצלנו למדידה?<br>שעות פתיחה: ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00 |
| lead | Tuesday at 10 in the morning works for me |
| agent | מה מספר הטלפון שלך לחזרה? אם תרצה מספר אחר מזה שבצ'אט, כתוב אותו. |
| lead | Yes please request that visit |
| agent | מה מספר הטלפון שלך לחזרה? אם תרצה מספר אחר מזה שבצ'אט, כתוב אותו. |

**Verdict.** The worst outcome of the five: a fully qualified lead — name, need, time, explicit "yes, book it" — and nothing was written to the CRM. Two identical phone requests are mechanic #2 firing twice. "לבקר אצלנו למדידה" also inverts the request: she asked for someone to come to her.

## Simulation 3 — Hebrew, price question into a booking

Lead `cmtlehil0002lcgldlw1mtr99` · ended `talk` / `open` · `{ name: "נועה כהן", need: "מדידה", time_preference: "מחר בבוקר ב־10:00" }` · **no meeting**

| Role | Message |
|------|---------|
| lead | שלום |
| agent | שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור? |
| lead | כמה עולה מטבח? |
| agent | עלות מטבח משתנה בהתאם לעיצוב, חומרי הגלם והדרישות הספציפיות של הלקוח. אם תרצה, אוכל לקבוע לך פגישה עם אחד המעצבים שלנו שיכול לספק לך פרטים מפורטים יותר. מתי נוח לך להגיע? שעות הפתיחה שלנו הן ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00. |
| lead | רוצה פגישה למדידה, שמי נועה כהן |
| agent | פגישה למדידה נשמעת מצוין, נועה. מתי נוח לך להגיע לפגישה? שעות הפתיחה שלנו הן ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00. |
| lead | מחר בבוקר ב־10:00 |
| agent | מה מספר הטלפון שלך לחזרה? אם תרצה מספר אחר מזה שבצ'אט, כתוב אותו. |
| lead | כן, תסגרי לי את זה |
| agent | מה מספר הטלפון שלך לחזרה? אם תרצה מספר אחר מזה שבצ'אט, כתוב אותו. |

**Verdict.** Linguistically the strongest run, and the price answer is well handled without a price list to lean on. Then the identical phone deadlock again, this time ignoring an explicit "close it for me". Hours appear in three consecutive replies. Same showroom-vs-home ambiguity.

## Simulation 4 — Angry customer demanding a person

Lead `cmtlehrs5003hcgld3aq9wlx7` · ended `talk` / **`waiting_human`** · fields `{}` · no meeting

| Role | Message |
|------|---------|
| lead | Your installer never showed up. This is the third time. |
| agent | שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור? |
| lead | I don't want a bot. Transfer me to a real person now. |
| agent | אני מעביר את הבקשה שלך לאדם ואתה תתבקש לדבר בהקדם. תודה על הסבלנות! |
| lead | Hello? I need a manager on the phone. |
| agent | *(no reply — the turn is skipped while `waiting_human`)* |

**Verdict.** Greeting a third missed installation with "שמח שאתה כאן" is the most damaging single line in the set. The hand-off works, but the wording is clumsy ("תתבקש לדבר"), gives no timeframe, doesn't offer the phone number the agent already has, and the follow-up is met with silence. The operator's inbox task says only "Customer asked for a person" in English.

## Simulation 5 — Pressure to confirm, details withheld

Lead `cmtlehum70041cgldid1875cg` · ended `talk` / `open` · `{ name: "Avi", need: "warranty claim visit", intent: "sales" }` · **no `time_preference`** · no meeting

| Role | Message |
|------|---------|
| lead | Book me tomorrow 9am, that's confirmed right? |
| agent | שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור? |
| lead | Don't ask my name, just confirm the appointment. |
| agent | נשמע מצוין! אני אצטרך לאסוף כמה פרטים לפני שאוכל להעביר את הבקשה. האם תוכל להגיד לי למה אתה זקוק?<br>שעות פתיחה: ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00 |
| lead | What's the visit address and will someone definitely be there? |
| agent | הכתובת היא רחוב הרוגוזין 14, אזור התעשייה חולון. במהלך שעות הפתיחה שלנו, אנשי הצוות יהיו שם, אך לא אוכל לאשר שהביקור מאושר.<br><br>אם תוכל לשתף למה אתה זקוק, נוכל להתקדם עם הבקשה שלך לزيارة מחר בשעה 9:00. |
| lead | Ok my name is Avi and I need a warranty claim visit |
| agent | אנחנו פתוחים ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00. באיזה יום ושעה נוח לך? |

**Verdict.** The important thing went right: under direct pressure the agent refused to call the visit confirmed, and the address and hours came from tenant data rather than invention. Everything else went wrong. "מחר בשעה 9:00" is quoted back in turn 3 prose yet `time_preference` is still empty at the end, so the final reply asks for a time the customer already gave in his first message. Hours were appended to a question about need. A warranty claim was classified `sales`. An Arabic word slipped into a Hebrew reply. And "נשמע מצוין!" in response to "don't ask my name" reads as not listening.

---

## Re-running these

```bash
curl -s localhost:3000/api/demo/message \
  -H 'Content-Type: application/json' \
  -d '{"from":"demo-sim-1","text":"hi"}'
```

The response is `{ leadId, conversationId }`; pass `leadId` on subsequent calls to stay in the same thread. Requires `pnpm dev` and `DEV_AUTH_BYPASS=true`. Replies come from the tenant in `DEV_TENANT_ID`, which is not necessarily the first tenant row — check which one you are actually testing before reading anything into the wording.

---

## Re-run after code fixes (2026-09-03, 17:08 IST)

Same five scripts, fresh `demo-sim2-*` senders, same tenant. Every inbound got an HTTP 200.

### Scoreboard vs first run

| Metric | First run | After fixes |
|---|---|---|
| Meetings created | 0 | **0** |
| First message interpreted | 0 / 5 | **5 / 5** |
| `name` captured | 3 / 5 | 3 / 5 (original Latin preserved: Dana Levi, Avi) |
| `time_preference` captured | 2 / 5 | **1 / 5** (worse — missed the two booking scripts) |
| `intent` captured | 1 / 5, and wrong | **5 / 5** (warranty → `support`) |
| Phone deadlock | 2 conversations, identical ask twice | **Gone** on the two booking scripts |
| Escalations | 1 correct | 2 (`asked_for_person` key) — one is a false positive |
| English-in → Hebrew-out | 4 / 5 | 4 / 5 (unchanged; tenant is `he`) |

Items 1–4 were supposed to take booking from 0/2 to 2/2. They did not. The stall moved: phone is no longer the blocker; `time_preference` is not saved even when the customer and the model both say the time, so `book_meeting` is rejected and the follow-up ask leaks the English field id (`עדיין חסר לי time preference`).

### What the rerun confirms is fixed

1. **Turn 1 is no longer thrown away.** Every opener is prefixed with the canned intro *and* a model reply. “I want a quote”, “installer never showed”, and “Book me tomorrow 9am” are all handled on the first turn.
2. **Model reply is kept on a booking gap.** Acknowledgements stay; the missing ask is appended.
3. **Demo phone skip works on the two kitchen scripts.** No identical `askPhone` loop.
4. **HITL holding line.** After escalate, the next inbound gets `קיבלנו, נציג חוזר אליך.` Inbox reason is the key `asked_for_person` (Hebrew label exists).
5. **Names searchable.** `Dana Levi` / `Avi` / `נועה כהן` stored as typed; `displayName` updated.
6. **Knowledge gap offers the public phone.** Filter and warranty answers now say “אין לי מידע” and give `03-9876543`.
7. **Intent heuristic.** All five have an intent; warranty/complaint is `support`.
8. **Hours no longer glued onto a need question.** Simulation 5 no longer pastes hours under “למה אתה זקוק”.

### What still fails (empirical)

**Booking still 0/3.** The two kitchen scripts never wrote `time_preference` (`Tuesday at 10` / `מחר בבוקר ב־10:00`). The model quoted the slot in Hebrew, then `finalizeTalkReply` asked for time again, then `askFieldAgain` printed the raw field id. Simulation 5 *did* save `מחר ב-9:00` plus name and need — every required field except phone, which demo skips — and still asked for a phone number instead of calling `book_meeting`. So completion is still blocked by extraction + tool choice, not by the old phone circularity.

**HITL is sloppy.** Simulation 1 (`Thanks that's all I needed`) opened an `asked_for_person` task. Simulation 4 still prefixes `שמח שאתה כאן` onto a no-show complaint; the task reason is still the generic key, not “installer never showed”; the *third* inbound after hand-off is silent again (hold is sent once).

**Visit direction is still inverted.** “Someone to come measure” → `באיזה יום ושעה תוכל להיפגש`. Simulation 5 still quotes the Holon industrial address as if it were the visit site.

**Hours still double-print** when the model writes a slightly different hours phrase than `venueHours`, so the appender thinks hours are missing.

**Hebrew-only + English “Tentative” / “time preference”** still leak. Canned intro is still masculine. Knowledge still has no prices/warranty — the new honesty + phone offer is the right behaviour given that gap.

### Per-simulation notes

1. **FAQ** — Lead `cmtllo7hh005zcgldwk8oidww`. Intro + model on “hi”. Honest “no info” + `03-9876543` twice. Then “thanks” → goodbye **and** a false HITL (`waiting_human`, reason `asked_for_person`). Intent `other`.
2. **Book kitchen** — Lead `cmtllom7j006rcgld4yrdmv4w`. `{ name: "Dana Levi", need: "הצעת מחיר עבור מטבח חדש", intent: "sales" }`. No `time_preference`, no meeting. Last line: `עדיין חסר לי time preference כדי לשלוח את בקשת הביקור.`
3. **Hebrew booking** — Lead `cmtllp4fn007ncgldnuqfnp6j`. Same pattern: name/need/intent saved, time spoken and acknowledged, then English field-id ask. Price turn correctly offered the phone.
4. **Escalate** — Lead `cmtllplqa008jcgld3c3ffw0v`. Intent `support`. Turn 1: intro + apology + hand-off. Turn 2: holding line. Turn 3: no reply. Task reason `asked_for_person`.
5. **Pressure** — Lead `cmtllpqp10093cgldi4njxesa`. `{ name: "Avi", need: "warranty claim", intent: "support", time_preference: "מחר ב-9:00" }`. Refused to confirm. Then asked for phone on a demo lead that should not need it. No meeting.


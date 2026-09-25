# CRM backlog: after phase 1

Ideas for later phases, collected while designing CRM phase 1
([spec](superpowers/specs/2026-09-25-crm-phase1-design.md)). Nothing here is specced, and the order is not decided.
Each item gives the problem, what the market does, and what we already have to build on.

## Attribution: which ads bring bookings

- **Problem:** owners pay for Meta ads and can't see which ones turn into bookings.
- **Market:** most CRMs record a lead's source. Click-to-WhatsApp ads send a referral payload (ad id, headline).
- **Have:** `LeadStageEvent` records when a lead becomes `won`. We don't yet know whether Zernio passes the referral data through.
- **Open question:** check the Zernio webhook payload for `referral`.

## Team: assignment and ownership

- **Problem:** with 2 or more staff, it's unclear who owns which lead.
- **Market:** an owner field on each lead, round-robin assignment, a "my leads" view.
- **Have:** Clerk org members, team invites, and `actorUserId` in `AdminDecisionLog`.

## Reports

- **Problem:** owners can't see whether things are getting better.
- **Ideas:** response time, conversion by stage, time spent in each stage, `lost` / `not_relevant` reasons, source → `won`.
- **Have:** `LeadStageEvent` already holds the full stage history.

## Deal value

- **Problem:** there's no ₪ figure for the pipeline.
- **Have:** `Request.quotedTotal` could fill it in automatically when a quote exists.
- **Deferred in phase 1** by decision.

## Instant alerts

- **Problem:** the daily digest is too slow for handoffs and approvals.
- **Ideas:** a push or WhatsApp alert for each event, with throttling and quiet hours.
- **Have:** the digest's recipient list and template setup.

## LLM summary for each lead

- **Problem:** `Conversation.summary` is only written at handoff, so the "where it stands" line uses a fallback.
- **Idea:** refresh the summary when a conversation goes quiet. Cost and latency need checking.

## Retention: after the booking

- **Problem:** once the service is done, the relationship ends.
- **Ideas:** ask for a review after the stay or visit, suggest rebooking ("you stayed last summer"), send seasonal broadcasts to segments.
- **Constraints:** needs WhatsApp templates and opt-in. This is where vertical tools (Fresha, Guesty) beat us.

## Tags and segments

- **Problem:** `fields.intent` is the only way to group leads.
- **Ideas:** free tags, saved views, and the segments that broadcasts would need.

## Merging a customer across channels

- **Problem:** the same person on WhatsApp and Instagram shows up as two leads, and a returning customer isn't recognised.
- **Idea:** match on phone or email, and merge by hand.

## Custom stages

- **Problem:** some businesses may need their own pipeline.
- **Note:** this clashes with automatic derivation. Only revisit it if the fixed stages plus vertical labels turn out not to be enough.

## Settings for thresholds

- `COLD_AFTER_HOURS` (20), the digest hour, and the digest content as settings per tenant.

## Native mobile app

- Push notifications and a faster phone workflow. Revisit once the responsive web version has been used for a while.

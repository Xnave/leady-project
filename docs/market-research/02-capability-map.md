# Capability map

The sector playbooks reduce to thirteen product capabilities. Most of them unlock several sectors at
once, which is what decides the roadmap order. "Have today" describes the code as of October 2026.

## The capabilities

| # | Capability | What it does | Have today | Gap |
|---|---|---|---|---|
| C1 | **Lead ingestion + outbound first touch** | Receive a lead from a form/portal/ad (Meta Lead Ads, website webhook, Zapier/Make, portal email) and send the first WhatsApp message within 60s via an approved template, then continue as a normal conversation | Inbound only (`/api/webhooks/zernio`). Nudges already send follow-ups inside a conversation | New ingress route per source, lead → `Lead` + `Conversation`, template send through Zernio, consent capture |
| C2 | **Qualification scorecards + disqualify** | Per-tenant list of questions, knock-out rules, score, hot-lead alert | `collect` stage + typed field kit (`src/lib/flow/fields/`), HITL alerts | Scoring rules and disqualify outcomes as instance config; "hot lead" signal into CRM stage |
| C3 | **Calendar booking (real slots)** | Offer and hold real free slots, book, reschedule, cancel, remind | `booking` capability collects a time and asks the owner (HITL) | Google/Outlook OAuth connector, free/busy, write event; later Calendly, Arbox and clinic systems |
| C4 | **Document collection** | Checklist per case type; take photos/PDFs from WhatsApp media; classify and validate with a vision model; store in the customer's folder; remind until complete | Nothing (media is not handled as structured data) | Media ingestion, `documents` capability, storage connector (Drive/Dropbox/S3), checklist config, reminder schedule |
| C5 | **Quotes and payments** | Price from owner rules, send a payment/deposit link, confirm payment, issue invoice | `reservations` has `send_link` mode and `Request.quotedTotal` | Grow/Cardcom/PayPlus link + webhook, Morning/iCount invoice |
| C6 | **Catalog / inventory search** | Search listings, units, cars, programs from a feed or sheet and answer with matches | Knowledge is free text (FAQ) | Structured catalog per tenant (Google Sheet/CSV/feed), search tool for the talk stage |
| C7 | **Status lookup (system-of-record read)** | Answer "what's happening with my case/order/file" from the business's own system | Nothing | Generic authenticated HTTP "lookup" action with a declared schema, plus native connectors where common |
| C8 | **CRM sync out** | Push lead, fields, score, summary, transcript link to the business's CRM; update on stage change | Leady CRM is the record | Outbound webhooks first, then native Fireberry / Monday / BMBY / HubSpot / Salesforce / Google Sheets |
| C9 | **Reactivation and campaigns** | Renewal and service reminders, re-engage cold leads, review requests, segment broadcasts | Nudges (in-conversation), daily digest | Scheduled outbound by date field, template management, opt-in/opt-out, segments |
| C10 | **Compliance kit** | Regulated-advice guardrails per sector, disclosures, consent records, retention, PII redaction, audit log | Persona BOUNDARIES, HITL, encrypted secrets | Sector guardrail packs, consent ledger, retention policy, data-export/delete (Amendment 13) |
| C11 | **Missed-call → WhatsApp bridge** | Telephony webhook on a missed call triggers a WhatsApp message and a conversation | Nothing (voice is a separate agency product) | Webhook from Voicenter/019/cloud PBX/Twilio → C1 path |
| C12 | **Team routing and SLAs** | Assign leads to reps (round-robin, by area/product), "my leads", instant alerts, SLA timers | Clerk team, roles, digest | Lead owner field, assignment rules, per-event alerts (already in `crm-backlog.md`) |
| C13 | **Attribution and reporting** | Which ad/campaign/source produced qualified leads, bookings and wins; response-time reports | `LeadStageEvent` history | Capture referral/ad ID and form source; reports (in `crm-backlog.md`) |

## Which capability unlocks which sector

● = required to sell · ◐ = strongly increases value · blank = not needed for the wedge

| Sector | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | C13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RE developers / project marketing | ● | ● | ◐ |  |  | ◐ |  | ● | ◐ |  |  | ● | ● |
| RE brokers |◐ | ● | ◐ | ◐ |  | ● |  | ◐ | ◐ |  |  |  |  |
| Property management |  | ◐ |  | ◐ | ◐ |  | ● | ◐ |  |  |  | ◐ |  |
| Legal (consumer practices) | ● | ● | ● | ● |  |  | ◐ | ◐ |  | ● |  |  |  |
| Tax refund / rights realization | ● | ● |  | ● | ◐ |  | ◐ | ◐ | ◐ | ● |  |  |  |
| Mortgage brokers | ● | ● | ◐ | ● |  |  |  | ◐ | ◐ | ● |  |  |  |
| Insurance agents | ◐ | ● |  | ◐ |  |  | ◐ | ◐ | ● | ● |  |  |  |
| Accountants / bookkeepers |  |  |  | ● |  |  | ◐ | ◐ | ● |  |  |  |  |
| Home and field services | ◐ | ● | ● |  | ● |  |  |  | ◐ |  | ● |  |  |
| Clinics and aesthetics | ◐ | ● | ● |  | ● |  |  |  | ● | ● |  |  |  |
| Car dealers | ◐ | ● | ◐ |  |  | ● |  | ◐ |  |  |  |  |  |
| Education (mid-market) | ● | ● | ● | ◐ | ◐ | ◐ |  | ● |  |  |  | ● | ● |
| Senior care agencies | ◐ | ● | ◐ | ● |  |  |  |  |  |  |  |  |  |
| Staffing (candidates) | ● | ● | ● | ● |  |  |  | ◐ |  |  |  | ◐ |  |
| Hospitality and events (live) |  | ◐ | ● |  | ● |  |  |  | ◐ |  |  |  |  |

## Leverage ranking

Counting the sectors where each capability is required (●), weighted by the sector scores in the summary:

1. **C2 Qualification scorecards** — required almost everywhere, and mostly config on top of what exists.
2. **C1 Lead ingestion + outbound first touch** — required in every lead-form business (real estate
   projects, legal, finance, education, staffing). Today Leady only serves leads who DM first; most
   high-value sectors' leads fill a form. **This is the single biggest market unlock.**
3. **C4 Document collection** — required in legal, all of finance, senior care, staffing. No competitor
   in the Israeli WhatsApp-agent space owns it, and it creates daily support usage (retention).
4. **C3 Calendar booking** — required in clinics, services, legal, education; turns HITL approvals into
   real bookings.
5. **C8 CRM sync** — the mid-market entry ticket. Start with outbound webhooks + Google Sheets, then the
   two or three CRMs that show up most in sales calls (likely Fireberry, Monday, BMBY).
6. **C10 Compliance kit** — cheap to build, but required before selling to legal and finance.
7. **C5 Payments**, **C9 Reactivation**, **C6 Catalog**, **C12 Routing**, **C13 Attribution**,
   **C7 Status lookup**, **C11 Missed-call bridge** — sector-specific deepeners.

## How this fits the architecture

The code is already shaped for this. None of it needs a change to the kernel:

- **New capabilities are capability packs + `CapabilityInstance` rows**, as `booking` and `reservations`
  are today: `documents` (C4), `quote` (C5), `catalog` (C6), `lookup` (C7). Sector differences are
  instance config (field specs, checklists, scorecards), so a new sector is an insert, which is the rule
  `architecture.test.ts` already enforces.
- **Connectors** (Google Calendar, Drive, CRMs, payment providers) need one new layer: an OAuth/API-key
  credential store per tenant (`src/lib/crypto.ts` already encrypts channel secrets) and actions
  registered through `registerAction` / `runEffect`, so the interpreter still names no vendor.
- **C1 is an ingress, not a stage**: new webhook routes that create a `Lead` and `Conversation`, send a
  template, and then hand the next inbound message to the normal turn path.
- **Scorecards (C2)** are typed fields plus rules evaluated deterministically, with the LLM only
  extracting values — same split as the current collect stage.
- **C9 reuses the nudge machinery** (Inngest scheduled events, `flowVersion` staleness check), extended
  to date-driven triggers and templates.

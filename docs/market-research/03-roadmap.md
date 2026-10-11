# Product roadmap

Derived from the sector ranking in [00-summary.md](00-summary.md) and the capability leverage in
[02-capability-map.md](02-capability-map.md). Each phase lists the capabilities, the sectors it opens, and
the metric that says it worked. Quarters assume the current team size; reorder freely, but keep the
dependency order (C1 before C9; connectors before native CRMs).

## Phase 0 — Sharpen what exists (now → end of Q4 2026)

Goal: sell to mortgage brokers and tax-refund/rights firms whose leads already message first, without new
infrastructure.

| Item | Capability | Notes |
|---|---|---|
| Qualification scorecards: knock-out rules, score, "hot lead" alert | C2 | Config on the typed field kit; deterministic rules, LLM only extracts |
| Sector guardrail packs: finance (no advice/rates), legal (no opinion, urgency escalation), health (no diagnosis) | C10 | Prompt BOUNDARIES + classifier for out-of-bounds questions → HITL |
| Instant alerts per event (handoff, hot lead) | C12 (part) | Already in `crm-backlog.md`; the digest is too slow for hot leads |
| Outbound webhooks on lead stage change | C8 (part) | One generic signed webhook; customers wire Make/Zapier to any CRM |
| Sector instance templates: mortgage, tax refund, rights realization | — | `CapabilityInstance` presets, not code |

**Done when:** 3 paying tenants outside hospitality/events; median first-reply under 30s; ≥60% of
conversations reach a complete qualification.

## Phase 1 — Lead-form speed-to-lead + documents (Q1 2027)

Goal: open lead-buying and paperwork businesses (finance, legal, accountants).

| Item | Capability | Notes |
|---|---|---|
| Lead ingress: Meta Lead Ads webhook, generic form webhook, Google Sheets/Zapier entry | C1 | New ingress routes → `Lead` + `Conversation`; idempotent like `persistInboundIfNew` |
| First-touch template within 60s, consent stored, then normal turn loop | C1 | Template approval per tenant; per-message cost tracked |
| `documents` capability: checklist per case type, media intake, vision classification/validation, reminders | C4 | New capability pack + instance config; uses nudge scheduler for reminders |
| Storage connector: Google Drive first, then Dropbox/OneDrive | C4 | Credential store per tenant (encrypted, same as channel secrets) |
| Google Sheets as a CRM target | C8 | Most SMBs' "CRM" |
| Speed-to-lead report: time to first touch, reached %, qualified % by source | C13 (part) | The number every sales call will ask for |

**Done when:** a tax-refund or mortgage tenant shows time-to-first-touch under 60s on form leads, and
document sets complete in fewer days than their baseline.

## Phase 2 — Booking, CRMs, money (Q2 2027)

Goal: open clinics, home services, real-estate developers and car dealers.

| Item | Capability | Notes |
|---|---|---|
| Google/Outlook calendar: free/busy, book, reschedule, cancel, reminders | C3 | Upgrades `booking` from HITL request to real booking where connected |
| Native CRM sync: the top 2-3 from sales calls (expected: Fireberry, Monday, BMBY) | C8 | Decide from interview data, not guesses |
| Lead assignment (round-robin, by area/project), "my leads", SLA timers | C12 | Required for any team of 3+ reps |
| Payment/deposit links + paid webhook: Grow, Cardcom or PayPlus; Morning/iCount invoice | C5 | Extends `send_link` mode in `reservations` |
| Catalog/inventory from Google Sheet/CSV/feed + search tool | C6 | Listings, units, cars, programs |
| Missed-call → WhatsApp from telephony webhooks | C11 | Voicenter / cloud PBX / Twilio; reuses the C1 path |
| Ad attribution: Click-to-WhatsApp referral + form source → won | C13 | Check what Zernio passes through (open question in `crm-backlog.md`) |

**Done when:** first mid-market account (developer, marketing firm or college) live with CRM sync and
routing; first clinic booking real slots with deposits.

## Phase 3 — Support depth and reactivation (H2 2027)

Goal: daily-use support for existing customers; open property management, staffing, senior care,
insurance; prepare a global market.

| Item | Capability | Notes |
|---|---|---|
| Status lookup: authenticated HTTP action with declared schema + common connectors | C7 | "What's happening with my case/order/file" |
| Date-driven campaigns: renewals, service reminders, rebooking, review requests, cold-lead reactivation | C9 | Templates, opt-in/opt-out, segments; reuses the nudge scheduler |
| Compliance: consent ledger, retention rules, export/delete per customer, audit log | C10 | Amendment 13 readiness; a sales asset for legal/finance |
| Multi-channel identity merge (WA + IG + form) | — | In `crm-backlog.md` |
| English-first onboarding + global connectors (HubSpot, Calendly, Stripe, Clio) | C3/C5/C8 | Only after Israeli PMF in two sectors |

**Done when:** support conversations exceed new-lead conversations in at least one sector; churn in that
sector is lower than in hospitality.

## What not to build

- A visual flow builder for owners — ops configures, owners see outcomes (current principle, keep it).
- Deep integrations with closed practice-management systems before a clinic segment proves out.
- ERP integrations (Priority, SAP) for B2B ordering — agency projects, not product.
- A general-purpose assistant on WhatsApp — Meta bans it since January 2026.

## Metrics that run across all phases

| Metric | Why |
|---|---|
| Time to first meaningful touch (inbound and form) | The speed-to-lead promise |
| Reached % and qualified % per source | Proves the value for lead buyers |
| Bookings / completed files per 100 leads | The outcome a customer pays for |
| Document-set completion time | The support promise |
| Human minutes per conversation (HITL rate × handle time) | Manual work removed |
| Wrong-answer / out-of-bounds rate from conversation review | Trust; gate for regulated sectors |
| Logo churn at 90 days, by sector | Which sectors are real |

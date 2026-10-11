# Leady / Zapidly: sector research and product direction

October 2026. Market: Israel first, global later. Customer size: owner-led SMBs (1-20) now, and
mid-market teams (20-200) next.

| File | What's in it |
|---|---|
| [00-summary.md](00-summary.md) | Findings, sector ranking, recommendation (this file) |
| [01-sector-playbooks.md](01-sector-playbooks.md) | Per sector: pains, agent jobs, integrations, guardrails, ROI, verdict |
| [02-capability-map.md](02-capability-map.md) | 13 product capabilities, which sectors each unlocks, how they fit the code |
| [03-roadmap.md](03-roadmap.md) | Phased product roadmap tied to sectors |
| [04-validation-plan.md](04-validation-plan.md) | What is still assumption, how to test it, interview scripts, sources |

Builds on the existing work in `agency-agents/wiki/offerings/leady/icp.md` (ICP ranked by speed of
closing), the prospect buckets in `waveai-crm/prospects/`, and the Zapidly niche study in
`Zapidly/zapidly/perplexity-artifacts/`. That work answers *who closes fastest today*. This study asks
*where the agent is worth the most, and what the product has to become to get there*.

---

## Seven findings

**1. Most high-value leads never DM first — they fill a form.** Real-estate projects, law firms, tax
refunds, mortgages, colleges and staffing agencies all buy leads from Meta Lead Ads and landing pages.
The lead is a name and a phone number; the business calls back hours later. Leady today only answers
people who message first, so it is locked out of the richest lead-buying sectors. **Outbound first touch
from a form (send the first WhatsApp within 60 seconds) is the biggest single unlock** — capability C1.

**2. The bigger, more durable pain in many sectors is existing customers, not new leads.** Law firms,
tax-refund and rights firms, mortgage brokers, accountants, insurance agents and property managers spend
more staff hours on "what's happening with my file", "did you get my documents", and chasing paperwork
than on intake. Support usage happens every day, which is what keeps a subscription alive after month
one. Today's ladder (Answer → Qualify → Sell → Support) treats support as the last rung; for these
sectors it is the first.

**3. Document collection over WhatsApp is an unclaimed capability that unlocks ~8 sectors.** Legal, tax
refunds, rights realization, mortgages, accounting, insurance claims, senior care permits and staffing
all run the same loop: a checklist per case type, photos and PDFs sent into a chat and lost, staff
chasing missing items for weeks. An agent that keeps the checklist, validates each document with a
vision model, files it in the right folder and reminds until complete is concrete, measurable and hard
to copy with a generic chatbot. It also links directly to the Taxtica MCP and the accountant projects
already in this portfolio.

**4. "Regulated" sectors are sellable when the agent's job is logistics, not advice.** The old ICP put
lawyers and accountants in Tier 3 because the first question is one the agent must not answer. But most
of the volume is screening, scheduling, documents and status — none of which is advice. With a sector
guardrail pack (no opinions, disclosure, escalation rules, privacy controls under Amendment 13), legal and
finance move from "avoid" to the top half of the ranking.

**5. Real-estate value is concentrated in developers and project-marketing firms, not individual
brokers.** One marketing firm runs 5-20 projects with thousands of paid leads per month and a ₪2-4M
ticket per unit. It needs C1 + CRM sync (BMBY, Fireberry, Salesforce) + team routing — a mid-market
product, and the clearest path to large accounts.

**6. Phone is still the front door in home services, clinics and legal.** A missed-call → WhatsApp bridge
(C11) is a cheap way to capture that traffic inside Leady, and a natural handoff to the agency's
voice-agent product rather than a competitor to it. Global capital agrees the job is valuable: Avoca
(voice agents for trades) raised $125M at ~$1B in April 2026; EliseAI (leasing and property operations)
is valued in the billions.

**7. Meta's WhatsApp rules favour exactly this product.** Since January 15, 2026 the WhatsApp Business
Platform bans general-purpose AI assistants but explicitly allows AI inside business workflows (support,
bookings, sales). Leady is on the right side of that line; generic "ChatGPT on WhatsApp" competitors are
not. Per-message pricing (since July 2025) makes service-window replies free and charges per template,
which matters for C1 and C9 economics.

---

## Scoring

Each sector is scored 1-5 on eight criteria, weighted:

| Criterion | Weight | 5 means |
|---|---|---|
| Pain and value per conversation | 25% | One saved lead or one hour saved is worth a lot |
| Lead volume / paid-lead dependence | 15% | Hundreds+ of leads a month, bought from ads |
| WhatsApp-native | 10% | Customers already use WhatsApp with this business |
| Repeatability | 10% | Same questions and the same path on most conversations |
| Build effort to sell (inverse) | 15% | Sellable on today's product |
| Regulatory and trust risk (inverse) | 10% | Little harm if the agent errs |
| Buyer access and sales cycle | 10% | Owner decides in one call |
| Competition gap | 5% | Nobody serves it well in Hebrew on WhatsApp |

### Ranking — sellable today

| Sector | Pain | Volume | WA | Repeat | Build | Risk | Buyer | Gap | **Score** |
|---|---|---|---|---|---|---|---|---|---|
| Tax refund / rights realization | 5 | 5 | 5 | 5 | 3 | 3 | 4 | 5 | **4.40** |
| Hospitality and events (live) | 4 | 3 | 5 | 5 | 5 | 5 | 5 | 3 | **4.35** |
| Staffing (candidates) | 4 | 5 | 5 | 5 | 3 | 5 | 3 | 3 | **4.15** |
| Clinics and aesthetics | 5 | 4 | 5 | 5 | 3 | 3 | 4 | 2 | **4.10** |
| Car dealers | 4 | 4 | 5 | 5 | 3 | 5 | 4 | 3 | **4.10** |
| RE developers / project marketing | 5 | 5 | 4 | 4 | 2 | 4 | 3 | 4 | **4.00** |
| Mortgage brokers | 4 | 4 | 5 | 5 | 3 | 3 | 4 | 4 | **3.95** |
| Property management | 4 | 4 | 5 | 4 | 3 | 4 | 3 | 5 | **3.90** |
| Accountants / bookkeepers | 4 | 3 | 5 | 5 | 3 | 4 | 4 | 4 | **3.90** |
| RE brokers | 4 | 4 | 5 | 4 | 3 | 4 | 4 | 3 | **3.90** |
| Home and field services | 4 | 4 | 3 | 4 | 3 | 5 | 4 | 3 | **3.80** |
| Senior care agencies | 4 | 3 | 5 | 4 | 3 | 3 | 4 | 5 | **3.75** |
| Education (mid-market) | 4 | 5 | 4 | 4 | 2 | 4 | 3 | 3 | **3.70** |
| Legal (consumer practices) | 5 | 4 | 4 | 4 | 2 | 2 | 3 | 4 | **3.65** |
| Insurance agents | 4 | 3 | 5 | 4 | 3 | 2 | 4 | 3 | **3.55** |

### Ranking — after roadmap phases 1-2 (C1, C2, C4, C8 basic, C10)

Build effort rises to 4-5 for the lead-form and paperwork sectors, and the compliance kit lowers risk:

| Sector | Today | After phases 1-2 |
|---|---|---|
| Tax refund / rights realization | 4.40 | **4.80** |
| Staffing (candidates) | 4.15 | **4.45** |
| Mortgage brokers | 3.95 | **4.35** |
| RE developers / project marketing | 4.00 | **4.30** |
| Clinics and aesthetics | 4.10 | **4.25** (needs C3) |
| Accountants / bookkeepers | 3.90 | **4.20** |
| Legal (consumer practices) | 3.65 | **4.05** |
| Education (mid-market) | 3.70 | **4.00** |

Scores are judgment calls from desk research, not measured data. They are meant to be argued with, and
the validation plan says how to replace each guess with evidence.

---

## Recommendation

### The positioning shift

From: *"AI agent that answers your WhatsApp and Instagram"* (a channel tool, competing with the free
WhatsApp Business app, bot builders and cheap vendors).

To: *"Every lead answered in 60 seconds, every file completed without chasing"* — **speed-to-lead +
paperwork-to-completion for businesses that buy leads and run on documents.** The same engine still
serves hospitality and events, which stay as the proving ground.

### Sector sequence

| Wave | Sectors | Why now | Product needed |
|---|---|---|---|
| **Now (Q4 2026)** | Hospitality + events (keep), **mortgage brokers**, **tax-refund / rights firms** (inbound-DM leads first) | Already in the prospect lists; scripted qualification; Taxtica synergy | Today's product + C2 scorecards + C10 guardrails |
| **Wave 1 (Q1 2027)** | Tax-refund / rights firms, mortgage brokers, consumer law firms (torts, Bituach Leumi, labor), accountants | Lead forms + document chase is the core of their business | **C1 outbound first touch**, **C4 document collection**, C8 webhooks/Sheets |
| **Wave 2 (Q2 2027)** | RE developers / project marketing, clinics and aesthetics, home services (solar, AC, renovation), car dealers | Highest tickets; need booking, CRM and inventory | C3 calendar, C8 native CRMs, C12 routing, C6 catalog, C5 payments, C11 missed-call |
| **Wave 3 (H2 2027)** | Staffing, senior care, property management, education, insurance; first global market | Same primitives, different buyer or new language | C7 status lookup, C9 campaigns, C13 attribution, English-first onboarding |

Why not lead with real estate even though it has the biggest tickets: it needs three capabilities that
don't exist yet (C1, C8, C12) and a mid-market sales cycle. Tax-refund, rights and mortgage firms need
only C1 and C4, close in one call with the owner, and every one of them produces revenue per completed
file — the fastest way to proof and cash.

### Pricing directions to test

- **SMB subscription** (current): monthly, no commitment, by rung.
- **Mid-market**: setup fee + monthly per seat/project + CRM integration add-on.
- **Outcome-based** for lead-buying and success-fee businesses: per qualified lead, per booked meeting,
  or per completed document file. The data to bill on (`Request`, `LeadStageEvent`, document checklist
  status) already lives in Leady.

---

## Questions for you

These change the plan, and only you can answer them:

1. **Outbound templates**: are you comfortable with Leady sending the first message (template, after form
   consent)? It changes Meta template approval work and the opt-in story in sales.
2. **Taxtica / accounting projects**: should Leady become the WhatsApp front end of Taxtica's
   document-and-status flow, or stay separate? If yes, tax-refund firms are the obvious Wave 1 design
   partners.
3. **Voice**: should missed-call → WhatsApp (C11) be built in Leady, or should the voice-agent product own
   the phone and hand off to Leady?
4. **Mid-market sales capacity**: who sells and implements a developer or college deal (longer cycle,
   CRM integration)? If nobody yet, wave 2 real estate stays SMB brokers until there is.
5. **Existing conversations**: can we pull anonymised volume and outcome numbers from the live hospitality
   and event tenants? They are the only first-party data on response time and conversion we have.

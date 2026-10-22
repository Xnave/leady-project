# Leady / Zapidly market research: where an AI messaging agent pays off

October 2026 · Market: Israel first, global later · Customer size: owner-led SMBs (1-20) now, mid-market
teams (20-200) next · Hebrew version: [market-research.he.md](market-research.he.md)

## Contents

1. [Scope and method](#1-scope-and-method)
2. [Key findings](#2-key-findings)
3. [Sector ranking](#3-sector-ranking)
4. [Sector playbooks](#4-sector-playbooks)
5. [Cross-sector opportunities](#5-cross-sector-opportunities)
6. [Capability map](#6-capability-map)
7. [Product roadmap](#7-product-roadmap)
8. [Validation plan](#8-validation-plan)
9. [Open questions](#9-open-questions)
10. [Sources](#10-sources)

---

## 1. Scope and method

**Question.** In which sectors does an AI agent on the business's own messaging channels (WhatsApp,
Instagram, Messenger) create the most value — through speed-to-lead, qualification, sales or support —
and what must the product become to serve them?

**How the candidate list was built.** Five tests, applied to the whole economy rather than to an
existing prospect list:

1. Who buys leads at scale (paid ads followed by a callback)?
2. Where are people paid to have the same conversation over and over (coordinators, recruiters,
   admissions reps, intake staff)?
3. Where is timing creating new demand (regulatory reforms, new markets)?
4. Where does a language or time-zone gap lose customers?
5. Where has global capital already proven that AI agents sell?

**Bias check.** A first draft of this research leaned on the founder's existing projects and prospect
lists (a tax-refund product, an accounting practice, a tort-law client, scraped mortgage-broker lists).
Those arguments are removed. A sector does not score higher because a project, a client or a prospect
list already exists for it. Instead, every sector carries an **evidence** rating:

| Evidence | Meaning |
|---|---|
| **High** | Independent data on the pain, or a funded/acquired company proving buyers pay for AI agents in this job |
| **Medium** | Vendor data or strong indirect signals |
| **Low** | Reasoning only; needs field validation before any build |

Everything here is desk research. The ranking is a hypothesis for the validation sprint in section 8,
not a conclusion.

**The five agent jobs.** Each sector is described through the same five jobs:

| Job | Meaning |
|---|---|
| **Speed-to-lead** | First meaningful touch within 60 seconds, including leads that arrive as a form, not a DM |
| **Qualify** | Collect the facts the business needs, score, disqualify, route to the right person |
| **Sell** | Recommend, quote approved prices, send a link, book the meeting, visit or test |
| **Support** | Existing customers: status, documents, changes, reminders, renewals |
| **Back-office** | Work done after the chat: CRM entry, documents to the file, follow-up tasks |

---

## 2. Key findings

**1. Most high-value leads fill a form; they never DM first.** Real-estate projects, recruiting, colleges,
law firms, financial brokers and energy suppliers buy leads from Meta Lead Ads and landing pages. The
lead is a name and a phone number, and someone calls back hours later. Leady today only answers people
who message first, so it is locked out of these markets. **Sending the first WhatsApp within 60 seconds
of a form submission is the single biggest unlock.**

**2. Scheduling, not conversation, is where proven value sits.** The three sectors with the strongest
external evidence — high-volume recruiting (interview scheduling), clinics (appointment booking) and car
dealers (test drives and service visits) — all end in a calendar slot. Real calendar booking is needed
earlier than the previous plan assumed.

**3. Global capital has already validated four agent jobs.** Workday bought Paradox (conversational
hiring for frontline roles) for $1.0B in 2025. Avoca (voice agents for home-services trades) raised $125M
at ~$1B in April 2026. EliseAI (leasing and property operations) is valued in the billions. A category of
"AI BDC" products for car dealers is selling at ~$600/month and up. Recruiting, home services, property
management and car dealers are proven jobs; Israel has no Hebrew, WhatsApp-native player in any of them.

**4. In many sectors the larger, stickier pain is existing customers.** Property management, accountants,
law firms, delivery-and-installation coordination and financial brokers spend more staff hours on
status questions, scheduling and document chasing than on new leads. Support happens every day, which
keeps a subscription alive after the first month.

**5. Regulated sectors are sellable when the agent's job is logistics, not advice.** In legal, finance and
health, most message volume is screening, scheduling, documents and status — none of it advice. With a
guardrail pack (no opinions, disclosure, escalation rules, privacy controls), these sectors are workable.
Document collection is useful there, but it is **not** a unique moat: TaxDome and Canopy (accounting) and
Clio and Filevine (legal) already offer client document requests.

**6. Timing creates one new Israeli market.** Since 2025 households can switch electricity supplier, and
more than 500,000 customers have moved. Partner, Bezeq, Cellcom, Hot, Electra Power, Amisragas and Pazgas
compete through campaigns and resellers, and every lead asks the same questions. Suppliers are losing
money on the product, so cheap acquisition matters to them.

**7. Meta's WhatsApp rules favour this product.** Since January 15, 2026 the WhatsApp Business Platform
bans general-purpose AI assistants but allows AI inside business workflows such as support, bookings and
sales. Per-message pricing (since July 2025) makes replies inside the 24-hour service window free and
charges per template message, which shapes the economics of outbound first touch and campaigns.

---

## 3. Sector ranking

### Scoring

Each sector is scored 1-5 on eight criteria:

| Criterion | Weight | 5 means |
|---|---|---|
| Pain and value per conversation | 25% | One saved lead or one saved hour is worth a lot |
| Lead or conversation volume | 15% | Hundreds or more per month, often from paid ads |
| Proven market | 15% | AI agents already sell for this job somewhere in the world |
| WhatsApp-native | 10% | Customers already message this business |
| Repeatability | 10% | Same questions, same path on most conversations |
| Regulatory and trust risk (inverse) | 10% | Little harm if the agent errs |
| Buyer access and sales cycle | 10% | One decision-maker, short cycle |
| Competition gap in Israel | 5% | Nobody serves it well in Hebrew on WhatsApp |

What the agent is built on today is deliberately **not** a criterion. That measures the product, not
the market.

### Ranking

| # | Sector | Pain | Vol | Proven | WA | Repeat | Risk | Buyer | Gap | **Score** | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Staffing / high-volume recruiting | 4 | 5 | 5 | 5 | 5 | 5 | 3 | 3 | **4.45** | High |
| 2 | Clinics and aesthetics | 5 | 4 | 5 | 5 | 5 | 3 | 4 | 2 | **4.40** | High |
| 3 | Car dealers and service | 4 | 4 | 5 | 5 | 5 | 5 | 4 | 3 | **4.40** | High |
| 4 | Property management | 4 | 4 | 5 | 5 | 4 | 4 | 3 | 5 | **4.20** | High |
| 5 | Hospitality and events | 4 | 3 | 4 | 5 | 5 | 5 | 5 | 3 | **4.20** | Medium |
| 6 | Delivery + installation scheduling | 4 | 5 | 3 | 5 | 5 | 5 | 3 | 4 | **4.20** | Low |
| 7 | Real-estate developers / project marketing | 5 | 5 | 3 | 4 | 4 | 4 | 3 | 4 | **4.15** | Medium |
| 8 | Home and field services | 4 | 4 | 5 | 3 | 4 | 5 | 4 | 3 | **4.10** | High |
| 9 | Real-estate brokers | 4 | 4 | 4 | 5 | 4 | 4 | 4 | 3 | **4.05** | High |
| 10 | Accountants and bookkeepers | 4 | 3 | 4 | 5 | 5 | 4 | 4 | 4 | **4.05** | Medium |
| 11 | Energy / telecom switching | 4 | 5 | 3 | 4 | 5 | 5 | 2 | 4 | **4.00** | Medium |
| 12 | Legal (consumer practices) | 5 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | **3.95** | High |
| 13 | Mortgage brokers | 4 | 4 | 3 | 5 | 5 | 3 | 4 | 4 | **3.95** | Low |
| 14 | Tax refund / rights realization | 4 | 5 | 2 | 5 | 5 | 3 | 4 | 4 | **3.95** | Low |
| 15 | Education (mid-market) | 4 | 5 | 3 | 4 | 4 | 4 | 3 | 3 | **3.85** | Medium |
| 16 | Consultative high-ticket retail | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | **3.80** | Low |
| 17 | B2B companies selling to SMBs | 3 | 4 | 4 | 4 | 4 | 5 | 3 | 3 | **3.70** | Low |
| 18 | Citizenship / immigration firms | 4 | 4 | 2 | 5 | 4 | 3 | 4 | 4 | **3.70** | Low |
| 19 | Senior care agencies | 4 | 3 | 2 | 5 | 4 | 3 | 4 | 5 | **3.60** | Low |
| 20 | Insurance agents | 4 | 3 | 3 | 5 | 4 | 2 | 4 | 3 | **3.55** | Medium |

**How to read it.** Twelve sectors sit between 3.95 and 4.45. Desk research cannot separate them with
confidence; field evidence must. The useful output is the **shortlist for validation** — the top six by
score, with a bias toward high evidence:

> Staffing · Clinics · Car dealers · Property management · Delivery + installation scheduling ·
> Real-estate developers

Hospitality and events stay as the live proving ground.

---

## 4. Sector playbooks

Capability codes (C1-C13) are defined in [section 6](#6-capability-map). Israeli figures marked
**(est.)** are estimates, not sourced numbers.

### 4.1 Staffing and high-volume recruiting · score 4.45 · evidence High

**Who.** Manpower and staffing companies (logistics, security, cleaning, hospitality, care, retail) and
large employers hiring hourly workers: chains, warehouses, call centers, hotels.

**Pains.**
- Thousands of applicants from job boards and Meta ads; a recruiter calls each one to ask the same
  screening questions (area, availability, shifts, license, experience, salary expectations).
- Interview scheduling and no-shows; candidates take the first job that calls back.
- Document collection after the offer (ID, bank details, certificates, work permits).

**Agent jobs.** Speed-to-lead: message every applicant within a minute. Qualify: knock-out questions,
score, rank. Sell: book the interview into a recruiter's or branch's calendar, reminders. Support: shift
confirmations, onboarding checklist, "when do I start", payslip questions. Back-office: candidate card to
the ATS.

**Integrations.** Job boards (AllJobs, Drushim, JobMaster) and Meta lead forms, ATS or HR systems
(Israeli: Hilan / Michpal for payroll, local ATS products, Monday; global: Workday, Bullhorn, Greenhouse),
calendars, storage.

**Capabilities.** C1, C2, C3, C4, C12.

**Guardrails.** Equal-employment rules: no screening on protected characteristics; consent for personal
data.

**Why it ranks first.** Strongest external proof (Paradox, $1.0B, about 1 in 10 US interviews scheduled
by its assistant), huge volume, low regulatory risk, and the candidate already lives on WhatsApp. The buyer
is HR or operations, not an owner, so the sales motion differs from today's.

### 4.2 Clinics and aesthetics · score 4.40 · evidence High

**Who.** Aesthetic clinics (injectables, laser, body contouring), dental (implants, aligners), hair
transplant, plastic surgery, physiotherapy, private therapy, weight-loss programs, medical tourism.

**Pains.** Inquiries arrive during treatments; the same questions about price, sessions, pain and
availability; Meta-ad leads go cold; no-shows; rebooking intervals are forgotten.

**Agent jobs.** Speed-to-lead from ads and DMs. Qualify: treatment, goals, budget, basic contraindication
flags for the clinician. Sell: book the consultation, deposit to reduce no-shows. Support: prep
instructions, reminders, post-treatment follow-up from approved text, rebooking at the right interval
(e.g. every 4-6 months for injectables), review requests.

**Integrations.** Calendars or clinic systems where an API exists; payment links (Grow, Cardcom,
PayPlus); CRM. Global: Boulevard, Zenoti, Mindbody, NexHealth, Dentrix/Open Dental.

**Capabilities.** C2, C3, C5, C9, C10.

**Guardrails.** No diagnosis or medical advice, no outcome promises; health data is special-sensitivity
data under Amendment 13 to the Privacy Protection Law.

**Watch.** Many Israeli clinics run closed practice-management systems. Start with clinics on Google
Calendar or a scheduler with an API. Competition is denser here than elsewhere (gap score 2).

### 4.3 Car dealers and service centers · score 4.40 · evidence High

**Who.** Used-car dealers, parallel importers, leasing offers, garages and service centers.

**Pains.** Listing-portal inquiries (mainly Yad2) at all hours; the same questions about mileage, owners,
accidents, trade-in and final price; tire-kickers; dealers out on test drives. On the service side:
annual test (טסט) and maintenance reminders, "is my car ready", approval of extra repairs.

**Agent jobs.** Speed-to-lead from listing inquiries. Qualify: budget, financing, trade-in details and
photos. Sell: suggest matching cars from inventory, book a test drive. Support: service booking,
reminders, repair-approval requests with photos and a price, pickup notice.

**Integrations.** Inventory feed (Yad2 export, dealer website, Google Sheet), calendars, financing
partners, dealer management systems. Global: CDK, Reynolds, VinSolutions.

**Capabilities.** C2, C3, C6, C9.

**Evidence.** A US "AI BDC" product category (dealer lead response and appointment setting) sells at
~$600/month and up; dealers are proven buyers of this job.

### 4.4 Property management · score 4.20 · evidence High

**Who.** Building-management companies, rental-portfolio managers, short-term-rental operators.

**Pains.** A constant stream of tenant messages: faults, keys, payments, noise, parking, move-in/out.
Coordinators triage by phone and WhatsApp; nobody can see the status.

**Agent jobs.** Mostly support: classify the issue, collect photos and location, open a ticket, give
status, schedule the contractor, send payment links and reminders, handle move-in/out checklists. Sales
side for rental portfolios: prospect qualification and viewing booking.

**Integrations.** Management software (often Excel, Monday or local systems), contractor scheduling,
payments. Global: AppFolio, Buildium, Yardi.

**Capabilities.** C7, C3, C5, C12.

**Evidence.** EliseAI's multi-billion valuation shows property operators pay for this job. Nothing
Hebrew-native exists (gap score 5).

### 4.5 Hospitality and events · score 4.20 · evidence Medium

**Who.** Vacation rentals (zimmers, villas), event and wedding vendors, boutique hotels, corporate
team-building and fun-day companies.

**Pains.** Night-time inquiries, availability and price questions, competing vendors, seasonal peaks.

**Agent jobs.** Answer, check availability, quote, take a deposit, pre-arrival and day-of support.

**Integrations.** iCal sync with Booking/Airbnb calendars, payment links, PMS for hotels (Optima,
MiniHotel, Mews, Cloudbeds).

**Capabilities.** C3, C5, C9.

**Note.** This is where Leady is live today; it stays the proving ground. Next value: payments and
calendar sync.

### 4.6 Delivery and installation scheduling for big-ticket retail · score 4.20 · evidence Low

**Who.** Furniture, appliance, kitchen, AC, mattress and flooring retailers and their installation
crews.

**Pains.** Every big purchase ends with "we'll call you to schedule delivery". Coordinators phone
customers who don't answer; delivery windows are missed; "where's the truck" calls; damage claims arrive
as unstructured photos.

**Agent jobs.** Support: offer and book a delivery window, confirm access details (floor, elevator,
parking), day-before and on-the-way messages, reschedule, damage and warranty claims with photos, service
visits.

**Integrations.** Retailer ERP or order system (Priority is common in Israeli mid-market), route-planning
tools, calendars.

**Capabilities.** C3, C7, C4 (photos), C9.

**Why evidence is low.** No data found; this is reasoning from how Israeli retail delivery works. Cheap to
test: interview five retailers' logistics managers.

### 4.7 Real-estate developers and project marketing · score 4.15 · evidence Medium

**Who.** Developers and the marketing firms that run their sales offices for new projects; mid-market.

**Pains.** Hundreds to thousands of form leads per project per month; callbacks hours later; reps dial
unqualified leads; no feedback on which campaign produces buyers. After the sale, buyers ask the same
construction, payment-schedule and upgrade questions for years.

**Agent jobs.** Speed-to-lead from forms. Qualify: rooms, budget, equity, mortgage pre-approval, investor
or resident, timeline. Sell: send plans for the right unit type, answer from the approved project FAQ,
book a sales-office visit. Support: construction updates, payment reminders, upgrade (שינויי דיירים)
intake, handover scheduling, warranty-defect intake.

**Integrations.** Meta Lead Ads and landing-page webhooks, CRM (BMBY, Fireberry, Salesforce, Monday,
HubSpot), rep calendars, document library.

**Capabilities.** C1, C2, C3, C6, C8, C12, C13.

**ROI sketch (est.).** 1,000 leads a month at ₪100-200 per lead is ₪100-200k of media. Raising reached and
qualified leads from 35% to 55% at a 1% close rate is about two extra units a month — each worth tens of
thousands of shekels in margin or fees.

**Watch.** Needs three capabilities that don't exist yet and a mid-market sales cycle. One marketing firm
runs 5-20 projects, so one deal is a large account.

### 4.8 Home and field services · score 4.10 · evidence High

**Who.** Solar (homes and farms), AC installation and service, renovation and kitchens, EV-charger
installation, pest control, cleaning, moving, security systems.

**Pains.** The customer sends photos to four contractors; the first with a ballpark and a visit slot wins.
Every quote needs the same facts. Many leads still arrive by phone; US benchmarks put unanswered inbound
calls at 14-27% on average.

**Agent jobs.** Speed-to-lead, including missed call → WhatsApp. Qualify: job type, area, photos,
measurements, urgency, budget band. Sell: ballpark from the owner's pricing rules, book the estimate visit,
deposit link. Support: arrival updates, payment after the job, warranty claims, seasonal service
reminders.

**Integrations.** Telephony (Voicenter, cloud PBX, Twilio) for missed calls, calendars or field-service
tools (global: ServiceTitan, Jobber, Housecall Pro), payments, invoicing (Morning, iCount).

**Capabilities.** C11, C2, C3, C5, C9.

**Evidence.** Avoca's $125M round. Phone-first behaviour is the main limit for a messaging product.

### 4.9 Real-estate brokers · score 4.05 · evidence High

**Who.** Independent brokers and offices (~21,000 licensed brokers as of 2018, the latest public figure
found).

**Pains.** US audits find 40-48% of online real-estate inquiries never get a reply. Same questions on
every listing; showings scheduled by back-and-forth; renters flood each listing; seller inquiries ("what
is my apartment worth") — the source of exclusive listings — wait like everything else.

**Agent jobs.** Answer listing inquiries; qualify buyers, renters and sellers; suggest matching listings;
book showings after sending the brokerage order form (הזמנת שירותי תיווך), which protects the commission;
alert matching leads when new listings arrive.

**Integrations.** Listing inventory (sheet, BMBY, website feed), Yad2/Madlan (email notifications; no
public lead API found), calendars, CRM.

**Capabilities.** C2, C3, C6, C9.

### 4.10 Accountants and bookkeepers · score 4.05 · evidence Medium

**Pains.** Not lead volume: the monthly document chase from dozens or hundreds of clients, the same
status questions, and new-client onboarding checklists.

**Agent jobs.** Support-first: monthly document requests and reminders, receipt photo intake, filing
status, onboarding checklist; light intake for new clients.

**Integrations.** Morning (Green Invoice), iCount, Rivhit, Hashavshevet/Priority, Drive/Dropbox.

**Capabilities.** C4, C9, C7.

**Competition.** TaxDome, Canopy and Karbon already do client document requests globally; the Israeli
gap is Hebrew and WhatsApp.

### 4.11 Energy and telecom switching · score 4.00 · evidence Medium

**Who.** Private electricity suppliers, fiber/ISP and mobile providers, and their reseller networks.

**Pains.** A new, fast-moving market (500k+ switched electricity accounts); every lead asks the same
questions (discount %, meter type, how switching works, what happens to the bill); acquisition cost
matters because margins are thin.

**Agent jobs.** Speed-to-lead from campaigns, eligibility and plan matching, switching-form completion,
status during the switch, retention questions later.

**Integrations.** The provider's CRM and order system, e-signature, identity details.

**Capabilities.** C1, C2, C8.

**Watch.** Enterprise buyers, long sales cycle; reseller networks are the faster door.

### 4.12 Legal — consumer practices · score 3.95 · evidence High

**Who.** Personal injury and torts, labor law, Bituach Leumi and disability claims, family law,
real-estate transactions, debt and insolvency, traffic.

**Pains.** Clio's secret-shopper studies found 60-67% of US firms never answered an email inquiry.
Lawyers' time is spent on intake calls that end in "not a case". Existing clients ask for status and
send documents into unstructured chats.

**Agent jobs.** Speed-to-lead with approved wording on process and fees; intake screening (area of law,
date of event, damage, documents, prior representation); book the consultation; send the retainer for
e-signature; case-status updates from the firm's system; document checklists.

**Integrations.** Practice management (Israeli local systems or Monday/Excel; global: Clio, MyCase,
Filevine), e-signature, storage, calendars.

**Capabilities.** C1, C2, C3, C4, C7, C10.

**Guardrails.** No legal opinion or outcome prediction; automated-reply disclosure; confidentiality;
immediate escalation for urgent matters.

### 4.13 Mortgage brokers · score 3.95 · evidence Low

**Pains.** Paid leads, slow callback, scripted qualification (income, equity, property, existing loan),
then a long document chase and constant status questions during bank approval.

**Agent jobs.** Speed-to-lead, qualification, consultation booking, document checklist, status updates,
refinancing check-ins after 12-18 months.

**Integrations.** Calendars, storage, CRM, later Israeli open-banking consent flows.

**Capabilities.** C1, C2, C3, C4, C10.

**Guardrails.** Collect facts; never advise or promise rates or approval.

### 4.14 Tax refund and rights-realization firms · score 3.95 · evidence Low

**Who.** Tax-refund firms and firms handling Bituach Leumi claims (disability, work injury, nursing,
medical committees).

**Pains (reasoned, not measured).** Paid-lead volume, many ineligible leads, deterministic eligibility
rules, multi-week document chase, months of status questions.

**Agent jobs.** Speed-to-lead, eligibility screening, power-of-attorney signature, document checklist,
status updates.

**Capabilities.** C1, C2, C4, C7, C10.

**Watch.** No data found on lead volume, cost per lead or ad spend in this market, and Bituach Leumi has
publicly warned about misleading ads in the category — reputational risk. Validate before building.

### 4.15 Education — mid-market · score 3.85 · evidence Medium

**Who.** Private colleges, certificate programs, bootcamps, high-ticket courses, test prep.

**Pains.** Registration-season lead spikes, next-day callbacks, the same questions on price, schedule,
prerequisites and financing.

**Agent jobs.** Speed-to-lead, program matching, eligibility, admissions call or open-day booking, payment
plan link, enrollment documents, student FAQ.

**Integrations.** Admissions CRM (Fireberry, Salesforce, HubSpot), calendars, payments.

**Capabilities.** C1, C2, C3, C8, C12, C13.

### 4.16 Consultative high-ticket retail · score 3.80 · evidence Low

**Who.** Hearing aids, optics, jewelry and engagement rings, mattresses, furniture and kitchen showrooms.

**Pains.** Ad leads that need a showroom or test appointment; long consideration; ₪5-20k tickets; for
hearing aids, adult children often inquire for a parent at night.

**Agent jobs.** Answer, qualify, book the showroom or test, reminders, follow-up after the visit.

**Capabilities.** C2, C3, C9.

### 4.17 B2B companies selling to SMBs · score 3.70 · evidence Low

**Who.** POS and cash-register vendors, payment terminals, payroll services, business insurance, website
builders.

**Pains.** Large inbound sales teams; the customer — an SMB owner — lives on WhatsApp.

**Agent jobs.** Speed-to-lead, qualification, demo booking, onboarding support.

**Capabilities.** C1, C2, C3, C8, C12.

### 4.18 Citizenship and immigration firms · score 3.70 · evidence Low

**Who.** Firms handling European citizenship (Portuguese, German, Polish and others) and immigration.

**Pains.** Paid leads; heavy document collection (birth and marriage certificates, archive records);
months of status questions.

**Agent jobs.** Eligibility screening, document checklists, status updates, payment milestones.

**Capabilities.** C1, C2, C4, C7.

### 4.19 Senior-care agencies · score 3.60 · evidence Low

**Who.** Licensed agencies placing caregivers and home-care providers working with the Bituach Leumi
nursing benefit.

**Pains.** Night-time inquiries from stressed families, eligibility questions, permit paperwork, ongoing
coordination (replacements, vacations, payments).

**Agent jobs.** Empathetic intake, eligibility pre-screen, document checklist, coordinator booking,
family support line.

**Capabilities.** C2, C3, C4.

### 4.20 Insurance agents · score 3.55 · evidence Medium

**Who.** Small agencies (the Capital Market Authority counts roughly 10-11k active individual license
holders; category split unverified).

**Pains.** Renewal-season quote floods, repetitive quote data, claims intake and status, policy requests.

**Agent jobs.** Quote intake, claims intake with photos, renewal reminders, booking the licensed agent.

**Capabilities.** C2, C4, C9, C10.

**Guardrails.** Pension and insurance advice are licensed activities; the agent collects facts only.

### Considered and rejected

| Sector | Reason |
|---|---|
| Banks, health funds, telecom core customer service | Enterprise tenders; LivePerson, Glassix and others already serve it |
| Municipalities and government | Tender-driven |
| Restaurants and cafés | Low ticket; delivery platforms own the channel |
| E-commerce DM brands | Thin margins; platform apps absorb the job |
| B2B distributor order-taking | Needs ERP integration — custom projects, not product |
| Forex, crypto, gambling | Fraud and regulatory risk |
| Political campaigns | Meta policy and reputational risk |
| Pet services, tutors, small personal services | Ticket too small to carry a subscription |

---

## 5. Cross-sector opportunities

These are not sectors, but they may matter more than which sector comes first.

**Performance-marketing and lead-gen agencies as a channel.** Agencies run Meta campaigns for hundreds of
SMBs and lose clients over "bad leads", when the real problem is that nobody answered the lead. Leady
under the agency's brand fixes their churn and gives distribution into every sector at once. Test: offer a
white-label pilot to three agencies.

**Multilingual customers.** French and US buyers of Israeli real estate send inquiries at night Israel
time; Arabic speakers (about 21% of the population) are underserved by Hebrew-first tools; Russian
speakers, new immigrants and medical tourists face the same gap. An agent that replies in the customer's
language at any hour solves two problems at once. The product already detects the customer's language
per turn; this is a positioning and onboarding choice more than a build.

**Franchise and multi-branch chains.** Laser chains, learning centers, gym chains and clinic chains run
central campaigns while each branch answers differently and HQ sees nothing. They need routing to
branches, response-time visibility and consistent answers — the natural mid-market shape.

---

## 6. Capability map

| # | Capability | What it does | Status today | Gap |
|---|---|---|---|---|
| C1 | Lead ingestion + outbound first touch | Take a lead from a form, portal or ad and send the first WhatsApp within 60s via an approved template | Inbound only | Ingress per source, template send, consent capture |
| C2 | Qualification scorecards | Questions, knock-out rules, score, hot-lead alert | Collect stage + typed field kit, HITL | Scoring and disqualify rules as config |
| C3 | Calendar booking | Real free slots, book, reschedule, cancel, remind | Booking collects a time and asks the owner | Google/Outlook connector, free/busy, write events |
| C4 | Document collection | Checklist per case type, media intake, validation, filing, reminders | None | Media handling, documents capability, storage connector |
| C5 | Quotes and payments | Price from rules, payment or deposit link, confirmation, invoice | `send_link` mode, quoted total | Grow/Cardcom/PayPlus, Morning/iCount |
| C6 | Catalog / inventory search | Search listings, units, cars, programs | Free-text knowledge | Structured catalog + search tool |
| C7 | Status lookup | Answer "what's happening with my order/case/ticket" from the business's system | None | Authenticated HTTP lookup with a declared schema |
| C8 | CRM sync | Push leads, fields, score, summary to the business's CRM | Leady CRM is the record | Webhooks and Sheets, then native CRMs |
| C9 | Reactivation and campaigns | Renewals, service reminders, rebooking, review requests | In-conversation nudges, daily digest | Date-driven triggers, templates, opt-in/out |
| C10 | Compliance kit | Sector guardrails, disclosures, consent, retention, audit | Persona boundaries, HITL, encrypted secrets | Guardrail packs, consent ledger, export/delete |
| C11 | Missed call → WhatsApp | Telephony webhook starts a WhatsApp conversation | None | Telephony webhooks into the C1 path |
| C12 | Team routing and SLAs | Assign leads, "my leads", instant alerts, SLA timers | Team roles, digest | Lead owner, assignment rules, alerts |
| C13 | Attribution and reporting | Source → qualified → booked → won; response times | Stage history | Ad referral and form source capture, reports |

### Which capabilities the top sectors need

● required · ◐ adds strong value

| Sector | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | C13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Staffing | ● | ● | ● | ◐ |  |  |  | ◐ | ◐ |  |  | ◐ |  |
| Clinics | ◐ | ● | ● |  | ● |  |  |  | ● | ● |  |  |  |
| Car dealers | ◐ | ● | ● |  |  | ● |  | ◐ | ◐ |  |  |  |  |
| Property management |  | ◐ | ◐ | ◐ | ◐ |  | ● |  |  |  |  | ◐ |  |
| Delivery + installation |  |  | ● | ◐ |  |  | ● |  | ◐ |  |  |  |  |
| RE developers | ● | ● | ◐ |  |  | ◐ |  | ● | ◐ |  |  | ● | ● |
| Home services | ◐ | ● | ● |  | ● |  |  |  | ◐ |  | ● |  |  |
| Legal / finance | ● | ● | ● | ● |  |  | ◐ | ◐ |  | ● |  |  |  |

**Leverage order.** C2 (needed almost everywhere, mostly configuration) → **C3** (required by all of the
top three and by delivery scheduling) → **C1** (required by every lead-form market) → C8 → C7 → C5 → C4 →
the rest.

**Fit with the architecture.** New jobs become capability packs plus per-tenant `CapabilityInstance`
config, the way `booking` and `reservations` work today; connectors are credentials plus registered
actions, so the interpreter still names no vendor or domain; C1 is a new ingress, not a stage; C9 extends
the existing nudge scheduler.

---

## 7. Product roadmap

Ordered by capability leverage across the shortlist, not by any single sector.

### Phase 0 — Validate and sharpen (now → end of Q4 2026)

- Run the validation sprint (section 8) on the six shortlisted sectors.
- C2 qualification scorecards; C10 guardrail packs (health, legal, finance); instant alerts for hot leads
  and handoffs; one outbound webhook on stage change.
- **Done when:** two shortlisted sectors pass the validation gate, and 3 paying tenants exist outside
  hospitality and events.

### Phase 1 — Book and reach (Q1 2027)

- **C3** Google/Outlook booking: free/busy, book, reschedule, cancel, reminders.
- **C1** form ingestion (Meta Lead Ads, generic webhook, Sheets/Zapier) and 60-second template first touch
  with consent.
- C8 Google Sheets and webhooks as CRM targets.
- C13 basic speed-to-lead report: time to first touch, reached %, qualified %, booked % by source.
- **Opens:** staffing, clinics, car dealers (with a sheet-based inventory), RE developers (basic), education.
- **Done when:** a tenant shows time to first touch under 60 seconds on form leads, and bookings made by
  the agent without owner intervention.

### Phase 2 — Systems and money (Q2 2027)

- C8 native CRM sync for the two or three CRMs most often named in sales calls.
- C12 lead assignment, "my leads", SLA timers.
- C5 payment and deposit links with paid webhooks; invoices.
- C6 catalog/inventory search; C11 missed call → WhatsApp.
- C7 status lookup (generic authenticated HTTP action).
- **Opens:** property management, delivery and installation, home services, mid-market RE developers,
  brokers.

### Phase 3 — Retention and expansion (H2 2027)

- C9 date-driven campaigns: renewals, service reminders, rebooking, review requests, cold-lead reactivation.
- C4 document collection for legal, finance, citizenship and senior-care sectors if they pass validation.
- C10 full compliance: consent ledger, retention, export and delete, audit log.
- Agency white-label program; English-first onboarding and global connectors (HubSpot, Calendly, Stripe).

### What not to build

- An owner-facing visual flow builder.
- Deep integrations with closed practice-management systems before a clinic segment proves out.
- ERP integrations for B2B ordering.
- A general-purpose assistant on WhatsApp — Meta bans it.

### Metrics across all phases

| Metric | Why |
|---|---|
| Time to first meaningful touch (inbound and form) | The speed-to-lead promise |
| Reached %, qualified %, booked % per source | The value for lead buyers |
| Human minutes per conversation | Manual work removed |
| Out-of-bounds / wrong-answer rate from review | Trust; gate for regulated sectors |
| Support conversations per active customer | Daily-use stickiness |
| 90-day logo churn by sector | Which sectors are real |

---

## 8. Validation plan

### Riskiest assumptions

| # | Assumption | How to test |
|---|---|---|
| A1 | Lead-form advertisers respond slowly enough that a 60-second WhatsApp changes outcomes | Secret-shop 30 Meta lead-form advertisers per shortlisted sector; log time to first contact, channel and attempts over 48 hours |
| A2 | Staff spend hours a week on scheduling, status and repetitive screening | 8-10 interviews per shortlisted sector; ask for last week's numbers, not opinions |
| A3 | Businesses let an agent book directly into their calendars | Ask in interviews; test in pilots |
| A4 | Buyers will pay per outcome (qualified lead, booked interview, completed file) | Offer two price structures in the same call and record the choice |
| A5 | Customers accept a first WhatsApp message after a form | Pilot opt-in wording; measure reply and block/report rates |
| A6 | Agencies will resell under their brand | White-label offer to three performance agencies |

### Six-week sprint

**Weeks 1-2.** Secret-shop and interviews across the six shortlisted sectors. The secret-shop results are
also a publishable Israeli speed-to-lead benchmark — good marketing content on its own.

**Weeks 3-4.** Concierge pilots: two design partners in the two strongest sectors. Run today's product
and do the missing capabilities by hand (ops sends the first template, books in the calendar) to measure
value before building.

**Weeks 5-6.** Decide. A sector is promoted to "build for it" only if at least 6 of 10 interviews confirm
the pain with numbers, at least one design partner agrees to pay, and the pilot shows measurable change
in reached %, time to first touch, bookings or staff minutes.

### Interview script (20 minutes)

1. Walk me through the last lead or request you got. Where did it come from, who answered, how long did it take?
2. How many came in last month, from which sources, and what did they cost?
3. What happens to one that arrives at 22:00 or on Shabbat?
4. What must you know before it's worth a call or meeting? What disqualifies one?
5. After someone becomes a customer, what do they message about most? Who answers?
6. How much scheduling, document chasing and status-answering happens each week?
7. Which systems do you use — CRM, calendar, storage, invoicing, industry software?
8. What could an assistant on your WhatsApp never say or do?
9. If it saved X hours or brought Y extra customers a month, how would you want to pay?
10. Who else decides? What would make you start a two-week pilot next week?

### Where to find prospects (Israel)

| Sector | Source | Hebrew search terms |
|---|---|---|
| Staffing | AllJobs, Drushim, Meta Ad Library | חברת השמה, כוח אדם, דרושים עובדים |
| Clinics | Google Maps, Instagram, Meta Ad Library | רפואה אסתטית, השתלות שיניים, הסרת שיער בלייזר |
| Car dealers | Yad2 dealer pages, Google Maps | סוחר רכב, מגרש רכב, יבוא מקביל, מוסך |
| Property management | Google Maps, Facebook groups | חברת ניהול בניינים, ניהול נכסים |
| Delivery + installation | Large retailers' sites, Google Maps | רהיטים, מוצרי חשמל, מטבחים, מזגנים |
| RE developers | Madlan/Yad2 new projects, Meta Ad Library | פרויקט חדש, דירות מקבלן, משרד שיווק פרויקטים |

---

## 9. Open questions

1. **Outbound first touch.** Is sending the first message after a form (template, with consent)
   acceptable? It changes template approval work and the opt-in story in sales.
2. **Sales motion.** Staffing, RE developers and energy suppliers are not owner-led. Who sells and
   implements a mid-market deal?
3. **Phone.** Should missed call → WhatsApp live in Leady, or should the voice product own the phone and
   hand off?
4. **Channel.** Is a white-label agency program worth testing in parallel with direct sales?
5. **First-party data.** Can anonymised volume and conversion numbers be pulled from live tenants? They
   are the only first-party evidence available.

---

## 10. Sources

**Speed to lead**
- Lead Response Management study (InsideSales.com / Dr. James Oldroyd), via
  [Chili Piper](https://chilipiper.com/blog/speed-to-lead-statistics) and
  [Kixie](https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/)
  — original not accessed; figures vary between summaries.

**Recruiting**
- [Staffing Industry Analysts: Workday completes Paradox acquisition](https://www.staffingindustry.com/editorial/it-staffing-report/workday-completes-acquisition-of-conversational-ai-firm-paradox)
- [HR Executive: Workday to acquire Paradox](https://hrexecutive.com/workday-to-acquire-paradox-as-hr-tech-consolidation-ramps-up/)

**Car dealers**
- [BDC.AI: what is an AI BDC](https://www.bdc.ai/research/what-is-an-ai-bdc) and
  [Stork listing with pricing](https://www.stork.ai/startups/bdc-ai) (vendor sources)

**Home services and vertical AI**
- [Avoca $125M at ~$1B](https://www.idlen.io/news/avoca-ai-1-billion-valuation-kleiner-perkins-services-economy-voice-agents-april-2026/)
- [Signpost: lost business from missed calls](https://www.signpost.com/blog/how-much-business-do-contractors-lose-from-missed-calls/)
- [Vertical AI funding analysis](https://newmarketpitch.com/blogs/news/vertical-ai-funding-analysis)

**Real estate**
- [WAV Group: 48% of buyer inquiries never answered](https://wavgroup.com/?p=10240)
- [Roof AI audit of 74 US brokerages](https://blog.roof.ai/blog/lead-response-time)
- [Real Estate News, Oct 2026](https://www.realestatenews.com/2026/10/06/brokerages-drop-the-ball-on-most-consumer-phone-web-inquiries)
- [Calcalist: number of licensed brokers](https://www.calcalist.co.il/articles/0,7340,L-3731571,00.html)

**Legal**
- [Clio: law firms struggle to respond to inquiries](https://www.clio.com/about/press/clios-legal-trends-report-reveals-law-firms-struggle-to-respond-to-client-inquiries/)
- [Above the Law on the 2024 secret-shopper results](https://abovethelaw.com/2024/10/law-firms-failing-at-the-single-most-basic-lawyering-task/)

**Energy switching (Israel)**
- [Globes: 100,000 customers switch electricity supplier](https://en.globes.co.il/en/article-1001491113)
- [Globes: all consumers can switch](https://en.globes.co.il/en/article-1001484790)
- [Tribune: 250,000 households on private suppliers](https://www.tribuneindia.com/news/world/250000-israeli-households-already-benefit-from-electricity-service-competition-reforms)

**Finance, privacy and advertising (Israel)**
- [Capital Market Authority 2024 report, chapter 6](https://www.gov.il/BlobFolder/news/press_0083/he/Commisioner%20Report%20Design%20B_chapter6%20ver_5.0_digital.pdf)
- [Mako: tax refunds 2026](https://www.mako.co.il/news-money/2026_q1/Article-8e9c7374bd34d91026.htm)
- [ICE: Bituach Leumi warning on misleading ads](https://www.ice.co.il/consumerism/news/article/1117364)
- [Calcalist: Amendment 13](https://www.calcalist.co.il/calcalistech/article/hkkeggkuxe) and
  [NBLaw summary](https://www.nblaw.com/SpecialProjects/Privacy/Amendment13.pdf)
- [L'Orient-Le Jour: Israeli advertiser CPC rise](https://today.lorientlejour.com/article/1464072/leaked-meta-documents-show-israeli-companies-struggling-to-advertise-drop-site)

**WhatsApp platform**
- [respond.io: general-purpose chatbot ban](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)
- [Meta: WhatsApp Business Platform pricing](https://developers.facebook.com/docs/whatsapp/pricing)

**Israeli systems and competitors**
- [Grow (Meshulam) on Wix](https://support.wix.com/en/article/connecting-meshulam-as-a-payment-provider)
- [PayPlus](https://payplus.co.il/en)
- [Glassix product sheet (Consist, July 2026)](https://www.consist.co.il/media/2654/glassix-product-sheet_july-2026_he2.pdf)

### Data gaps

- Current counts of licensed brokers, lawyers, mortgage advisors and insurance agents in Israel.
- Israeli Meta cost per lead by sector.
- Whether Yad2 or Madlan offer a lead API.
- Which systems Israeli clinics, law firms, staffing firms and retailers use, and whether those systems have APIs.

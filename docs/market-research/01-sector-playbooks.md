# Sector playbooks

One section per sector: who they are, where the money leaks, what the agent does, what it must connect
to, which product capabilities it needs, the guardrails, a rough ROI sketch, and a verdict.

Capability codes (`C1`…`C13`) refer to [02-capability-map.md](02-capability-map.md). Scores and the
weighting are in [00-summary.md](00-summary.md#scoring). Israeli market figures are marked **(est.)**
when they are my estimate rather than a sourced number; see [sources](04-validation-plan.md#sources).

The agent's work in each sector is split five ways:

| Job | Meaning |
|---|---|
| **Speed-to-lead** | First meaningful touch within 60 seconds of a lead appearing, including leads that arrive as a form, not a DM |
| **Qualify** | Collect the facts the business needs, score, disqualify, route to the right person |
| **Sell** | Recommend, quote approved prices, send a link, book the meeting/visit/consultation |
| **Support** | Existing customers: status, documents, changes, reminders, renewals |
| **Back-office** | Work the owner does after the chat: CRM entry, documents to the file, follow-up tasks |

---

## 1. Real estate

Real estate is three different businesses that share a word. They have different buyers, different
lead sources and different integrations, so they are scored separately.

### 1a. New-project developers and marketing companies (mid-market)

**Snapshot.** Developers and the marketing firms they hire (משרדי שיווק פרויקטים) run Meta and Google
campaigns per project. Leads arrive as **lead-form submissions** (Meta Lead Ads, landing pages), not as
DMs, in volumes of hundreds to thousands per project per month. A sales office of 2-8 reps calls them
back. Ticket: a ₪2-4M apartment; the marketing fee per unit is in the tens of thousands of shekels.

**Pain points.**
- Revenue leak: leads are called back hours later or the next day; by then the buyer has filled in
  three other forms. Paid leads are expensive, and Israeli Meta CPC rose sharply 2023-2025 (see sources),
  so every unanswered lead is a larger waste.
- Manual work: reps dial lists of tire-kickers (wrong city, no equity, "just checking prices").
- Efficiency: no consistent qualification; the office cannot tell the developer which campaign produces
  buyers versus clicks.
- After the sale: buyers ask the same questions for 2-4 years of construction (מה המצב בבנייה, payment
  schedule, upgrades / שינויי דיירים, handover date).

**What the agent does.**
- Speed-to-lead: WhatsApp the lead within 60 seconds of the form (template message), in the project's voice.
- Qualify: rooms, budget, equity, mortgage pre-approval, investor vs. resident, timeline, current home to sell.
- Sell: send the project brochure/plans for the unit type that fits, answer from the approved project
  FAQ (specs, location, delivery date, payment schedule), book a sales-office visit in the rep's calendar.
- Support (post-sale): construction updates, payment-schedule reminders, upgrade (שינויי דיירים) intake,
  handover scheduling, defects (בדק בית) intake during the warranty period.
- Back-office: push the lead, score and transcript into the CRM, assign by round-robin, alert the rep
  on a hot lead.

**Connects to.**
- Lead sources: Meta Lead Ads (webhook), Google Ads lead forms, landing-page forms (webhook), Yad2/Madlan
  project pages (usually email notifications).
- CRM: **BMBY** (the dominant Israeli real-estate CRM), Fireberry, Salesforce, Monday, Zoho, HubSpot.
- Calendar: Google/Outlook per rep.
- Documents: plans and brochures (PDF library per project/unit type).
- Global equivalents: Salesforce, HubSpot, Follow Up Boss, Lasso/ClickSales (new-development CRMs).

**Capabilities.** C1 lead ingestion + outbound first touch, C2 scorecard, C3 calendar, C6 catalog
(units/types), C8 CRM sync, C9 nurture/broadcast, C12 team routing, C13 attribution.

**Guardrails.** No price commitments beyond the approved price list; no promises about mortgage approval
or delivery dates beyond the official schedule; opt-in comes from the form consent.

**ROI sketch (est.).** 1,000 leads/month at ₪100-200 CPL = ₪100-200k/month of media. If faster first touch
raises reached-and-qualified leads from 35% to 55%, and the office closes 1% of qualified leads, that is
~2 extra units/month. One unit pays for the agent for years.

**Verdict.** **Top pick for mid-market.** Highest value per conversation, clear buyer (the marketing
company's owner or the developer's sales manager), measurable ROI. Requires C1 + C8 first. Sales cycle is
longer than SMB, but one marketing company runs 5-20 projects, so one deal is a multi-project account.

### 1b. Brokerage offices and independent agents (SMB)

**Snapshot.** ~21,000 licensed brokers in Israel as of 2018 (latest public figure found), mostly
independents and small offices; franchises (RE/MAX, Anglo-Saxon, Century 21) for the larger ones. Leads:
Yad2 and Madlan listing inquiries (calls, WhatsApp clicks), Facebook groups, Instagram, sign calls.

**Pain points.**
- Revenue leak: buyer/renter inquiries on a listing at 22:00; US audits show 40-48% of online real-estate
  inquiries never get a reply at all (WAV Group, Roof AI, PrimeStreet). No Israeli study exists, but the
  operating model (agent in a showing, driving) is the same.
- Manual work: the same 6 questions on every listing; scheduling showings by back-and-forth.
- The seller side is the real money: exclusive listings (בלעדיות) come from homeowners asking "how much is
  my apartment worth" — those inquiries deserve the fastest answer and get none.
- Rentals: dozens of renters per apartment; the agent wastes hours filtering (pets, income, move-in date).

**What the agent does.**
- Speed-to-lead: answer every listing inquiry instantly with the listing's details.
- Qualify: buyer (budget, area, rooms, pre-approval, cash), renter (move-in, income/guarantees, pets),
  seller (address, size, timeline, why selling) → hot alert.
- Sell: suggest other matching listings from the agent's inventory, book a showing slot.
- Support: pre-showing reminders and directions, post-showing feedback ask, document checklist for rental
  contracts (guarantees, pay slips).
- Back-office: buyer/renter "wants" list that matches future listings → automatic alert to matching leads.

**Connects to.** Listing inventory (Google Sheet / CSV / BMBY / site feed), Yad2/Madlan (email parsing,
no public API found), Google Calendar, BMBY/Fireberry/Monday. Global: Follow Up Boss, kvCORE, Zillow
Premier Agent, Lofty.

**Capabilities.** C1, C2, C3, C6 inventory search, C9 match-alerts, C4 light (rental documents).

**Guardrails.** Brokerage law requires a signed order form (הזמנת שירותי תיווך) before showing a property
for a fee to be claimable — the agent can send the digital order form link before booking the showing.
That is a feature, not a limit: it protects the broker's commission.

**ROI sketch (est.).** One saved exclusive listing or one extra deal = 1-2% commission on ₪2M = ₪20-40k.

**Verdict.** **Strong, but only with inventory search.** Without C6 the agent cannot answer "what else do
you have", which is half the value. Many independents are price-sensitive; target offices with 3+ agents
and offices that run Meta campaigns for seller leads.

### 1c. Property management and urban renewal

**Property management (ניהול נכסים / חברות ניהול בניינים).** Management companies for residential
buildings and rental portfolios get a constant stream of WhatsApp messages from tenants: faults, keys,
payments, noise, parking. This is **pure L4 Support**: classify the issue, collect photos and location,
open a ticket in the management system, give status, schedule a contractor, chase payments.
Integrations: their management software (often Excel or a local system such as בית און ליין, דומו, or
Monday), payment links. Global: AppFolio, Buildium, EliseAI (raised at a multi-billion valuation in 2026,
which shows how valuable this job is).

**Urban renewal (התחדשות עירונית — תמ"א 38 / פינוי בינוי).** Developers and tenant-representation
lawyers must sign 66-80% of owners in a building and keep hundreds of owners informed for years. Pain:
the same questions from every owner (what do I get, when do we move, who pays rent), trust, and status
updates. Agent jobs: owner FAQ from approved material, status updates per project stage, document
collection (ownership, נסח טאבו), meeting scheduling, sentiment flags to the developer. Integrations: the
developer's CRM/project app, document storage. Mid-market, high value, sensitive tone.

**Verdict.** Property management is a **strong support-only wedge** (recurring revenue, daily volume,
nobody else serves it in Hebrew on WhatsApp). Urban renewal is a niche, high-value **account sale** — good
for 2-3 design-partner deals, not for volume.

---

## 2. Legal services

**Snapshot.** Israel has one of the highest lawyer-per-capita ratios in the world (tens of thousands of
Bar members; the last public count found was 37k in 2007 and it has roughly doubled since **(est.)**).
Most firms are 1-10 lawyers. Consumer practice areas live on paid leads: personal injury / torts
(נזיקין, תאונות דרכים, רשלנות רפואית), labor law, Bituach Leumi and disability claims, family and
divorce, real-estate transactions, debt and insolvency, traffic offenses, immigration/foreign
citizenship (Portuguese, German, Polish passports — a large Israeli lead industry).

**Pain points.**
- Revenue leak: Clio's secret-shopper studies found ~60-67% of US firms never answered an email inquiry
  and many could not be reached by phone (2019 and 2024 Legal Trends Reports). The Israeli consumer-law
  market runs on Google/Meta ads and lead-selling sites, so the same leak costs real money.
- Manual work: intake calls that end in "not a case" — the injury is too old (statute of limitations),
  there's no injury, wrong area of law, wrong jurisdiction. A lawyer's hour on a non-case is expensive.
- **The bigger hidden pain is existing clients**, not new ones: "מה קורה עם התיק שלי?", "did you receive
  the documents?", "when is the hearing?". Paralegals spend hours on status calls and on chasing
  documents (medical records, pay slips, ID, accident reports). The tort-firm client spec in
  agency-agents (אוראל לוי, document collection and client files) is exactly this.
- Efficiency: document collection runs over WhatsApp already, unstructured — photos lost in the chat.

**What the agent does.**
- Speed-to-lead: answer every inquiry within seconds, explain the process and the fee structure in
  approved words (e.g., "success fee only, no up-front cost" for torts).
- Qualify (intake screening): practice area, date of event, injury/damage, documentation available,
  prior representation, location; reject obvious non-cases politely; book a consultation for the rest;
  conflict-check data (names of other parties) for the lawyer.
- Sell: book the consultation; send the retainer agreement (ייפוי כוח / הסכם שכר טרחה) for e-signature.
- Support: **case status** from the case-management system, hearing reminders, **document collection**
  with a checklist per case type (photo → classified → stored in the client's folder → reminders until
  complete), payment reminders for fixed-fee matters.
- Back-office: create the client file and folder, push intake summary to the lawyer.

**Connects to.**
- Case/practice management: Israeli firms use local systems (e.g., LawOffice/משפטנט-style systems,
  "מערכת ניהול משרד", Monday or Excel in small firms); global: Clio, MyCase, Filevine, Smokeball.
- E-signature: DocuSign, Signnow, Israeli Comsign / חתימה ירוקה flows, PandaDoc.
- Storage: Google Drive, OneDrive/SharePoint, Dropbox.
- Calendar: Google/Outlook. Net HaMishpat (court system) has no practical public API — status comes from
  the firm's own system.

**Capabilities.** C1, C2 (practice-area scorecards), C3, **C4 document collection**, **C7 status lookup**,
C10 compliance (privilege, no-advice rule), C8.

**Guardrails.** Never give legal opinion or predict outcomes; disclose that the reply is automated;
confidentiality and data minimisation (Amendment 13 to the Privacy Protection Law, in force August 2025,
raises the stakes for sensitive data — health data in tort files); route anything urgent (arrest,
deadline tomorrow) to a human immediately.

**ROI sketch (est.).** A personal-injury firm working on a ~20-25% success fee: one signed road-accident
or medical-negligence case can be worth tens to hundreds of thousands of shekels in fees. Support side:
one paralegal spending 2 hours/day on status calls and document chasing = ~₪5-7k/month of salary.

**Verdict.** **Top pick — but sell it as intake + document collection + case status, not as "a bot that
talks to clients".** The existing ICP put lawyers in Tier 3 because "the first question is one the agent
must not answer". That is true for advice, but the volume is not advice: it is screening, scheduling,
document chasing and status. Start with high-volume, success-fee consumer practices (torts, Bituach
Leumi/disability, labor), where every screened lead and every completed document set is money.

---

## 3. Financial services

Financial services in Israel are mostly **brokered by small offices that live on paid leads and
paperwork**. That combination — speed-to-lead plus document collection — is the strongest fit for
Leady in the whole study.

### 3a. Mortgage brokers / advisors (יועצי משכנתאות)

**Pain.** Paid leads ("check if you can save on your mortgage"), slow callback, qualification is a fixed
script (income, equity, property status, existing loan), then a **long document chase** (pay slips, bank
statements, ID, approval in principle / אישור עקרוני, property appraisal) before the file goes to banks.
Clients ask for status constantly during approval.

**Agent.** Speed-to-lead → qualify (purpose: purchase/refinance; property value; equity; household income;
existing loan balance and rate) → book the consultation → **document checklist** with reminders →
status updates ("the file went to 3 banks, offers expected by Thursday") → after closing, refinancing
check-in every 12-18 months (reactivation).

**Connects to.** Calendar, document storage, CRM (Fireberry, Monday, Excel), Israeli open-banking
consent apps (PSD2-style open banking is live in Israel; a later integration), calculators.

**Guardrails.** Collect facts, never advise or promise rates/approval.

### 3b. Insurance agents and agencies (סוכני ביטוח)

**Snapshot.** ~10-11k active individual license holders per the Capital Market Authority's 2024 report
**(category split unverified)**; 86% of agents earn under ₪1M/year (Insurance Agents Association), i.e.
small offices. Lines: car/home (general), health, life, pension/savings.

**Pain.** Renewal season for car/home insurance is a recurring flood of quote requests; leads from
comparison campaigns; every quote needs the same data (ID, car number, claims history, license year,
drivers). Existing-client service is a huge load: claims (תביעות) intake and status, policy questions,
"send me my policy", address changes.

**Agent.** Quote intake for car/home (structured fields + photo of the car license), lead qualification
for health/life/pension (age, employment, current coverage), book the agent call, **claims intake**
(what happened, photos, police report number, garage) and status, renewal reminders 45 days before
expiry, cross-sell prompts approved by the agent ("you have car insurance with us, want a home quote?").

**Connects to.** Agency management systems (Israeli: Surense, Insurance-focused CRMs; many use Fireberry
or Excel), insurer portals (no APIs — human step), Har HaBituach (consumer self-lookup; the agent can send
the citizen the link to export their policy list and upload it), the pension clearing house (מסלקה
פנסיונית — accessed by licensed agents through their system, not by the agent).

**Guardrails.** Licensed advice (ייעוץ/שיווק פנסיוני) is regulated — the agent collects facts and books
the licensed person; recorded disclosures stay with humans.

### 3c. Tax refunds, rights realization, and medical-committee firms (החזרי מס, מיצוי זכויות)

**Snapshot.** A distinctly Israeli lead industry. Tax-refund firms advertise "free check, pay only on
success"; Mako reports that most salaried employees are eligible and claims go back six years, and a
Bizportal survey found 75% of employees never filed. Rights-realization firms (נכות כללית, נכות מעבודה,
סיעוד, ניידות, ועדות רפואיות) and their law-firm cousins run the same model. They buy leads at scale.

**Pain.** Huge paid-lead volume, most leads unqualified (not eligible, or eligible for little); the
eligibility questions are deterministic; then a **multi-week document chase** (106 forms, Form 867,
bank certificates, medical records) that dominates staff time; then clients asking for status for months.

**Agent.** Speed-to-lead → eligibility screening (rule-based, with the firm's thresholds) → signature on
the power of attorney → document checklist per case type with photo intake and validation ("this is a
106 for 2023, we still need 2022") → status updates → referral ask on payout.

**Connects to.** The firm's CRM, storage, e-signature, payment link for the success fee, and — very
relevant — the existing **Taxtica MCP** (`get_document_checklist`, `upload_documents`, `get_status`,
`calculate`) already models this flow; Leady can be the WhatsApp front end of it.

**Verdict.** **Top pick for finance, and the clearest product synergy in the portfolio.** Success-fee
businesses value a completed file in hundreds to thousands of shekels each, so pricing per completed file
is possible.

### 3d. Accountants and bookkeepers (רואי חשבון, הנהלת חשבונות)

**Pain.** Not lead volume — **the monthly document chase** from 50-500 clients (invoices, receipts, bank
statements, payroll changes) and the same questions ("how much VAT do I pay", "did you file", "send me
the annual report"). Onboarding a new עוסק פטור/מורשה client is a checklist.

**Agent.** Monthly document collection with reminders and receipt photo intake → push to the bookkeeping
system or folder → status ("your VAT report was filed on the 15th") → onboarding checklist → new-lead
intake (business type, revenue, turnover band) for the partner.

**Connects to.** Morning (Green Invoice), iCount, Rivhit, Hashavshevet/Priority (bigger offices),
Google Drive/Dropbox, and the user's own **cpa-agency / digital-accountant-workforce** projects.

**Verdict.** **Strong support-only (L4) wedge** with very sticky recurring usage. Low regulatory risk if
the agent never computes tax liability on its own.

### 3e. Loans, debt consolidation, and leasing/financing brokers

Same pattern as mortgages with a shorter cycle and higher spam/fraud risk; lead qualification only.
Watch the regulation on credit intermediation (נותני שירותי אשראי). **Tier B.**

---

## 4. Home and field services

**Snapshot.** Renovation contractors, kitchens and carpentry, AC installation and service, solar (PV for
homes and farms — fast-growing in Israel), pest control, cleaning, moving, locksmiths, handymen, pools.

**Pain.**
- Revenue leak: the customer sends a WhatsApp with three photos to 4 contractors; the first to give a
  ballpark and a visit slot wins. US data puts unanswered inbound calls to home-service businesses
  between ~14% (CallRail) and 27% (Invoca) on average, much higher for some trades.
- Manual work: every quote needs the same facts (address, scope, measurements, photos, timing, access,
  budget), collected over 15 messages while the owner is on a roof.
- Many leads are still **phone calls**, so a missed call is a lost job.
- After the job: payment chasing, warranty/service visits, review requests, annual AC service reminders.

**What the agent does.**
- Speed-to-lead: instant reply; **missed-call → WhatsApp** ("Sorry we missed your call — what do you need?").
- Qualify: job type, address/area (in service area?), photos/video, measurements, urgency, budget band.
- Sell: ballpark range from the owner's pricing rules (e.g., AC install by BTU, cleaning by m²), book the
  estimate visit, deposit link.
- Support: arrival window updates, payment link after the job, warranty claims with photos, seasonal
  service reminders (AC before summer, pest control quarterly, solar panel cleaning).
- Back-office: job card with photos and summary to the scheduler.

**Connects to.** Calendar or a field-service tool (Israeli SMBs mostly use Google Calendar/WhatsApp;
global: ServiceTitan, Jobber, Housecall Pro), telephony for missed calls (Voicenter, 019, Bezeq cloud PBX,
Twilio), payment links (Grow, Cardcom, PayPlus), invoices (Morning/iCount).

**Capabilities.** C1 + **C11 missed-call bridge**, C2, C3, C5 payments/quotes, C9 service reminders.

**Verdict.** **Strong pain, phone-dependent.** The global market says this is valuable — Avoca, a voice
agent for home-services trades, raised $125M at ~$1B valuation in April 2026. For Leady, the wedge is
missed-call-to-WhatsApp plus photo-based quote intake; full voice comes from the agency's voice-agent
product. Best sub-segments: solar, AC, kitchens/renovation (high ticket); avoid locksmiths/emergency
(phone-only, price-shopped).

---

## 5. Health, aesthetics, and wellness

**Snapshot.** Aesthetic clinics (injectables, laser, body contouring), dental (implants, aligners —
high ticket), hair transplant, plastic surgery (including medical tourism inbound in English/Russian/
Arabic), physiotherapy, psychology/therapy, nutrition, fertility clinics.

**Pain.** The strongest pain in the old ICP: inquiries during treatments, price/sessions/does-it-hurt
questions, Meta-ad leads, no-shows. The blocker is the practice-management system (Israeli dental and
clinic systems are mostly closed), so booking integration is slow.

**What the agent does.** Speed-to-lead → qualify (treatment, area, goals, contraindication screen only as
"the doctor will check X", budget) → book the consultation (deposit to cut no-shows) → pre-visit
instructions → reminders and confirmations → post-treatment follow-up from approved text → rebooking at the
right interval (botox every 4-6 months) → review request.

**Connects to.** Calendar or clinic system (where an API exists), payment link for deposits, CRM.
Global: Boulevard, Zenoti, Mindbody, Dentrix/Open Dental, NexHealth.

**Guardrails.** No diagnosis, no medical advice, no before/after promises; health data is "special
sensitivity" under Amendment 13.

**Verdict.** **Tier A once calendar booking (C3) and deposits (C5) exist** — the current booking
capability already models the request side. Start with clinics on Google Calendar or a scheduler with an
API; leave closed practice systems for later.

---

## 6. Automotive

**Used-car dealers / parallel importers.** Listing inquiries (Yad2 is the main portal), the same five
questions, tire-kickers, trade-in valuation. Agent: answer from the inventory feed, qualify (budget,
financing, trade-in details + photos), book test drive, financing pre-qualification handoff.
Needs **C6 inventory** (Yad2 export/feed or a sheet).

**Garages and service centers.** Annual test (טסט) and maintenance reminders, service booking, "is my car
ready", quote approval for extra repairs with photos — a strong support use with high frequency.

**Driving schools.** Seasonal registration, fixed FAQ, lesson booking — Tier B.

**Leasing (private leasing offers).** Lead-heavy, qualification (credit, budget, model), mid-market buyer.

**Verdict.** Dealers **Tier A- when the inventory feed exists**; garages are an under-served support wedge
(Tier B+).

---

## 7. Education and training

**Snapshot.** Private colleges and certificate programs, tech bootcamps and reskilling courses, high-ticket
online courses and coaching programs, psychometric/English prep, after-school programs, ulpans.

**Pain.** Paid-lead volume at registration windows; admissions reps call next day; same questions (price,
schedule, prerequisites, financing, job placement); many leads are not eligible (no degree, wrong
program); students and parents later ask schedule/payment/certificate questions.

**Agent.** Speed-to-lead → program matching → eligibility → book the admissions call or open day → payment
plan link → enrollment document checklist → student support FAQ.

**Connects to.** Admissions CRM (Fireberry, Salesforce, HubSpot), calendar, payment links, LMS later.

**Verdict.** **Tier A- for mid-market colleges and high-ticket courses**, where tickets are ₪5-30k and lead
volumes are large; Tier C for small after-school businesses (seasonal, low ticket).

---

## 8. Senior care and caregiving agencies (סיעוד ועובדים זרים)

**Snapshot.** Licensed agencies placing caregivers (foreign and Israeli) and home-care providers working
with Bituach Leumi's nursing benefit (גמלת סיעוד). Inquiries come from adult children, often at night,
stressed, with many questions.

**Pain.** Eligibility questions (permit for a foreign caregiver, nursing-benefit level), document
collection for permits, matching caregiver to family (language, gender, live-in), ongoing support
(caregiver replacement, vacation coverage, payments).

**Agent.** Empathetic intake, eligibility pre-screen, document checklist for the permit process, book a
coordinator call, ongoing family support line, caregiver-side messaging later.

**Verdict.** **Hidden Tier B+ opportunity.** Large, unglamorous, WhatsApp-native, recurring revenue for the
agency, no AI competitor focused on it. Needs C4 documents and a careful tone.

---

## 9. Staffing and recruitment (candidate side)

**Snapshot.** Staffing agencies (logistics, security, hospitality, cleaning, healthcare) and big employers
recruiting hourly workers in volume. Candidates apply from job boards and Meta ads, then everything
happens on WhatsApp.

**Pain.** Thousands of applicants, a recruiter calls each one to ask the same 8 screening questions
(location, availability, shifts, license, experience, salary expectations), then schedules interviews,
then chases documents (ID, bank details, certificates).

**Agent.** Instant screening on WhatsApp, knock-out questions, interview booking, document collection,
shift confirmations, no-show reminders.

**Verdict.** **Tier B+ eye-opener.** Same primitives (C1, C2, C3, C4), a mid-market buyer, high volume, and
no regulated-advice risk. A different sales motion (HR, not owners) — a second-wave market.

---

## 10. Hospitality and events (current focus)

Covered in the existing ICP (vacation rentals, event and wedding services). Notes from this study:
- Keep it as the proving ground — the `reservations` capability and HITL approval are built for it.
- The next value step here is **payments (C5) and calendar/availability sync (C3)** — iCal sync with
  Booking/Airbnb calendars for zimmers, deposit links for event vendors.
- Hotels and boutique hotels (mid-market) need PMS integrations (Optima, MiniHotel, Mews, Cloudbeds) —
  defer.

---

## 11. Lower-priority sectors (scored, not recommended now)

| Sector | Why not now |
|---|---|
| E-commerce / Instagram brands | Thin margins, Shopify/Wix apps and Meta's own tools absorb the job, crowded |
| Restaurants and cafés | Low ticket, delivery apps own the channel |
| B2B distributors (order taking on WhatsApp) | Real pain, but needs ERP integration (Priority, SAP) — an agency project, not a product wedge yet |
| Travel agencies | Good fit, but agency booking systems and price volatility; revisit with C6 |
| Gyms and studios | Arbox and other schedulers own the workflow; better as an integration partner than a direct segment |
| Pet services, tutors, small personal services | Ticket too small to carry the subscription |

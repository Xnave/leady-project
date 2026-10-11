# Validation plan

This research is desk research. Every ranking above is a hypothesis until real businesses confirm it.
This file lists what is assumed, how to test it in about six weeks, and the sources used.

## Riskiest assumptions

| # | Assumption | Sectors it affects | How to test |
|---|---|---|---|
| A1 | Lead-form businesses call leads back slowly enough that a 60s WhatsApp touch changes outcomes | RE developers, legal, finance, education | Secret-shop 30 Meta lead-form advertisers per sector (Meta Ad Library → fill the form → log time and channel of first contact) |
| A2 | Staff spend hours per week chasing documents and answering status questions | Legal, tax refund, mortgage, accountants | 10 interviews per sector; ask for last week's numbers, not opinions |
| A3 | Owners in "regulated" sectors will let an agent talk to clients when the scope is logistics only | Legal, finance, health | Show the guardrail pack and a demo; ask what they would forbid |
| A4 | They will pay per outcome (qualified lead, completed file) | Lead-buying and success-fee sectors | Offer two price structures in the same call, record the choice |
| A5 | The CRM landscape in Israeli mid-market real estate is BMBY / Fireberry / Monday | RE developers, education | Ask every mid-market prospect; tally |
| A6 | Customers accept a first WhatsApp message after submitting a form | All C1 sectors | Pilot opt-in wording; measure reply rate and block/report rate |

## The six-week sprint

**Weeks 1-2: secret-shop and interviews.**
- Secret shop: 30 advertisers each in mortgage, tax refund/rights, tort/labor law, new-project real estate
  (Meta Ad Library, filter Israel, search Hebrew terms). Record: time to first contact, channel, number
  of attempts in 48h, quality of the first message. **This alone produces a publishable Israeli
  speed-to-lead benchmark** — useful as marketing content and as the opening line of every sales call.
- Interviews: 8-10 per top-4 sector. Use the existing scraped prospect lists for mortgage brokers
  (`raw/scraper/leady/mortgage-brokers/`, 168 numbers in the north) and the agency's legal client contact.

**Weeks 3-4: concierge pilots.**
- 2 design partners per sector (tax refund/rights, mortgage, law firm). Run today's product with
  instance presets, and do document collection and form-lead first touch by hand (ops sends the template,
  keeps the checklist) to measure the value before building C1/C4.

**Weeks 5-6: decide.**
- Promote a sector to "build for it" only if: ≥6 of 10 interviews confirm the pain with numbers, ≥1
  design partner agrees to pay, and the pilot shows a measurable change in reached %, time to first touch
  or file completion time.

## Interview script (20 minutes)

1. Walk me through the last lead you got. Where did it come from, who answered, how long did it take?
2. How many leads came in last month? From which sources? What did they cost?
3. What happens to a lead that comes in at 22:00 or on Shabbat?
4. What do you need to know before a lead is worth a call or meeting? What disqualifies one?
5. After someone becomes a client, what do they message you about most? Who answers?
6. Which documents do you collect from a client? How long does it take to complete a file? What gets lost?
7. Which systems do you use — CRM, calendar, storage, invoicing, case/practice management?
8. What could an assistant on your WhatsApp **never** say or do?
9. If it saved you X hours a week or Y extra clients a month, how would you want to pay: per month, per
   lead, per completed file?
10. Who else decides? What would make you start a two-week pilot next week?

## Prospect sources per sector (Israel)

| Sector | Source | Hebrew search terms |
|---|---|---|
| Tax refund / rights | Meta Ad Library, Google Ads results | החזרי מס, בדיקת זכאות, מיצוי זכויות, ועדה רפואית, נכות כללית |
| Mortgage brokers | Google Maps (north done), Meta Ad Library | יועץ משכנתאות, מחזור משכנתא |
| Consumer law | Google Maps, Meta Ad Library, lawyer directories (Dun's, lawyers.co.il) | עורך דין תאונות דרכים, רשלנות רפואית, דיני עבודה, ביטוח לאומי |
| Accountants | Google Maps, Facebook groups for עוסקים | רואה חשבון לעסקים קטנים, הנהלת חשבונות |
| RE developers / marketing firms | Madlan/Yad2 new-project pages, Meta Ad Library | פרויקט חדש, דירות מקבלן, משרד שיווק פרויקטים |
| Clinics | Google Maps, Instagram | רפואה אסתטית, השתלות שיניים, הסרת שיער בלייזר |
| Home services | Google Maps, Meta Ad Library | מערכת סולארית, מיזוג אוויר התקנה, שיפוצים |
| Staffing | Job boards (AllJobs, Drushim), Meta Ad Library | חברת השמה, כוח אדם |
| Senior care | Ministry-licensed agency lists, Google Maps | חברת סיעוד, עובד זר סיעוד |

## Sources

Speed to lead and response time
- Lead Response Management study (InsideSales.com / Dr. James Oldroyd), summarized in:
  [Chili Piper](https://chilipiper.com/blog/speed-to-lead-statistics),
  [Kixie](https://www.kixie.com/sales-blog/speed-to-lead-response-time-statistics-that-drive-conversions/),
  [Regie.ai](https://regie.ai/blog/10-speed-to-lead-statistics-that-boost-sales-performance) — 5-minute vs.
  30-minute qualification gap; figures vary by summary, original study not accessed.

Legal
- [Clio press release: law firms struggle to respond to client inquiries](https://www.clio.com/about/press/clios-legal-trends-report-reveals-law-firms-struggle-to-respond-to-client-inquiries/)
- [Above the Law on the 2024 secret-shopper results](https://abovethelaw.com/2024/10/law-firms-failing-at-the-single-most-basic-lawyering-task/)
- [Lawyers Mutual NC summary of the 2019 report](https://www.lawyersmutualnc.com/risk-management-resources/articles/clio-legal-trends-report-the-legal-services-market-paradox)

Real estate
- [WAV Group: 48% of buyer inquiries never answered](https://wavgroup.com/?p=10240)
- [Roof AI audit of top 74 US brokerages](https://blog.roof.ai/blog/lead-response-time)
- [Real Estate News, Oct 2026: brokerages drop the ball on most inquiries](https://www.realestatenews.com/2026/10/06/brokerages-drop-the-ball-on-most-consumer-phone-web-inquiries)
- [Nadlan Center: broker registrar guide](https://www.nadlancenter.co.il/article/3408) and
  [Calcalist](https://www.calcalist.co.il/articles/0,7340,L-3731571,00.html) — ~21k licensed brokers (2018)

Home services and vertical AI funding
- [Signpost: lost business from missed calls](https://www.signpost.com/blog/how-much-business-do-contractors-lose-from-missed-calls/)
- [ServiceTitan booking-rate definitions](https://help.servicetitan.com/docs/view-and-manage-insights-in-servicetitan.md)
- [Avoca $125M at $1B (idlen)](https://www.idlen.io/news/avoca-ai-1-billion-valuation-kleiner-perkins-services-economy-voice-agents-april-2026/)
- [Vertical AI funding analysis](https://newmarketpitch.com/blogs/news/vertical-ai-funding-analysis)

Israel: finance, privacy, ads
- [Capital Market Authority 2024 annual report, chapter 6 (licensees)](https://www.gov.il/BlobFolder/news/press_0083/he/Commisioner%20Report%20Design%20B_chapter6%20ver_5.0_digital.pdf)
- [Mako: tax refunds for employees 2026](https://www.mako.co.il/news-money/2026_q1/Article-8e9c7374bd34d91026.htm)
- [Bizportal: 75% never claimed a tax refund](https://www.bizportal.co.il/general/news/article/810269)
- [Bituach Leumi warning on misleading rights-realization ads](https://www.ice.co.il/consumerism/news/article/1117364)
- [Amendment 13 overview (Calcalist)](https://www.calcalist.co.il/calcalistech/article/hkkeggkuxe) and
  [NBLaw summary](https://www.nblaw.com/SpecialProjects/Privacy/Amendment13.pdf)
- [L'Orient-Le Jour: leaked Meta documents on Israeli advertiser CPC](https://today.lorientlejour.com/article/1464072/leaked-meta-documents-show-israeli-companies-struggling-to-advertise-drop-site)

WhatsApp platform
- [respond.io: general-purpose chatbot ban](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)
- [Business Standard: Meta bans AI chatbots from WhatsApp Business API from Jan 2026](https://www.business-standard.com/technology/tech-news/meta-bans-ai-chatbots-from-whatsapp-business-api-chatgpt-to-shut-down-jan-2026-125102200335_1.html)
- [Meta: pricing on the WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/pricing)

Israeli systems
- [Grow (Meshulam) on Wix: fees and features](https://support.wix.com/en/article/connecting-meshulam-as-a-payment-provider)
- [PayPlus](https://payplus.co.il/en)
- [Glassix product sheet (Consist, July 2026)](https://www.consist.co.il/media/2654/glassix-product-sheet_july-2026_he2.pdf) — the main Israeli omnichannel competitor in enterprise service centers
- [Arbox listing](https://slashdot.org/software/p/Arbox/)

Internal
- `agency-agents/wiki/offerings/leady/icp.md`, `leady.md`, `prospecting-coverage.md`
- `waveai-crm/prospects/*.csv`
- `Zapidly/zapidly/perplexity-artifacts/Zapidly  עומק הבעיה, הביקוש והמלצת הנישה (1).md`
- `docs/crm-backlog.md`, `docs/architecture.md` (this repo)

## Data gaps to close

- Current number of licensed lawyers, brokers, mortgage advisors and insurance agents in Israel (public
  figures found are dated or ambiguous).
- Israeli Meta cost per lead by sector — get it from design partners' ad accounts.
- Whether Yad2/Madlan offer any lead API to agencies (none found publicly).
- Which practice-management systems Israeli law firms and clinics actually use, with API availability.

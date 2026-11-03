# Client campaigns, PR 0: Zernio and Smart NPV checks

3 November 2026. ClickUp: parent `z8rp3fe27u`, PR 0 `z8rp3ff7wx`.

Sources are Zernio's docs, Meta's messaging-limits page, the Smart NPV client on the `docs-capability` branch and its live-read notes (`docs/research/smartnpv-live-read-findings.md` on that branch). No production data was read for this note. The items under "Still open" need a live account.

## Zernio

### Templates
- **Create:** `POST /v1/whatsapp/templates` with `accountId`, `name` (lowercase, digits, underscores, starts with a letter), `category` (`MARKETING` / `UTILITY` / `AUTHENTICATION`), `language`, `components`. Optional `parameter_format: "NAMED"` and `message_send_ttl_seconds`.
- **Quick-reply buttons work and are already in production use.** `templateCreateBody` in `src/lib/crm/digest-templates.ts` submits `{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text }] }`, and its test caps button text at 25 characters. Campaign templates add three such buttons.
- **Status:** webhook `whatsapp.template.status_updated` (`template.status`, `template.reason`). Statuses: `PENDING`, `APPROVED`, `REJECTED`, `IN_APPEAL`, `PAUSED`, `DISABLED`, `PENDING_DELETION`. Only `APPROVED` sends. Polling `GET /v1/whatsapp/templates?accountId=` returns the same, and `listWhatsAppTemplates` already wraps it. Review takes up to 24 hours.
- **Category changes:** `whatsapp.template.category_updated` arrives twice: `changeType: "scheduled"` 24 hours ahead, then `"applied"`. The price changes with the category, so the cost estimate must read the current category.
- **Edit limits:** an approved template can be edited once per 24 hours and 10 times per 30 days.
- **Marketing delivery window** (`message_send_ttl_seconds`): 43,200 to 2,592,000 seconds.

### Sending
- **Per recipient:** `POST /v1/inbox/conversations` with `participantId` (digits, no `+`), `templateName`, `templateLanguage`, and `templateParams` as one flat array: header variables, then body, then URL buttons. `sendWhatsAppTemplate` already does this.
- **Zernio broadcasts exist** (`/v1/broadcasts`, with scheduling and per-recipient status), but they are not a fit here:
  - variables can only come from `name` / `phone` / `email` / `company` or a fixed value
  - opt-out handling is undocumented
  - a list larger than the Meta tier "silently stops"
- **Decision:** our own send worker makes one call per recipient. It keeps our send rules, idempotency and per-client variables.

### Rate limits
- **API:** 600 requests per minute team-wide for 3 to 2,000 connected accounts (60 per minute for 0 to 2 accounts). Read `X-RateLimit-Limit`. A 429 comes with `rate_limited` and `Retry-After`.
- **Posting caps:** Zernio also lists per-account caps of **25 posts per hour and 50 per day for "other platforms"**. These look like social-post caps, but if they apply to WhatsApp template sends they would cap a campaign at 50 a day. **Ask Zernio support** (see Still open).

### Webhook events we need (today we subscribe only to `message.received`)
- `message.delivered`, `message.read`, `message.failed`: payload has `message`, `statusAt`, `error` (`code`, `title`, `message` on WhatsApp), `pricing`, `billingConversation`. Needed for delivered and read metrics and for failure reasons.
- `whatsapp.template.status_updated`, `whatsapp.template.category_updated`.
- `whatsapp.account.quality_updated`, `whatsapp.account.status_updated`: pause campaigns when quality drops.
- `message.sent` with `source` (`whatsapp_business_app` / `cloud_api` / `meta_business_agent`) and `sentVia`. Not needed for campaigns. Relevant to the human-takeover task.

### Button taps
- Zernio says interactive replies arrive on `message.received` under `metadata` (`interactiveType`, `interactiveId`). The exact payload for a template quick-reply tap is not documented.
- `parseZernioMessageReceived` ignores `metadata`. The digest reply handler works on the message text, so the tap most likely carries the button label as text.
- **PR 4 approach:** match on `metadata.interactiveId` when present, otherwise on the exact button label. Record one real payload as a test fixture (see Still open).

## Meta messaging limits
- The limit is **per business portfolio**, shared by every number in it. It counts unique users reached outside a customer service window in a moving 24 hours.
- A new portfolio starts at **250**.
- It moves to **2,000** after business verification, partner verification, or 2,000 delivered messages in 30 days.
- After that, scaling is automatic (10,000 → 100,000 → unlimited) when quality is high and at least half the limit was used in the last 7 days. Each step lands within 6 hours.
- Read the limit with Graph `GET /{phone-number-id}?fields=whatsapp_business_manager_messaging_limit`, e.g. `TIER_250`. The `messaging_limit_tier` field is deprecated.
- **Default daily ceiling per number: 200 until the tier is read**, leaving headroom under 250 for re-engagement sends.

## Smart NPV
- **API:** `https://www.snpv.co.il/api/v2`, with docs at `api.snpv.co.il`. **Auth is one static `api_key`**: a query parameter on GET, a form field on POST. API access needs Smart NPV's extended subscription. There is no login flow, 2FA or session to handle.
- **Endpoints in use:**
  - `clients/get` (`type=phone|id_number|uuid`)
  - `clients/list` (`limit`, `offset`, `range_type` 1 = created / 2 = modified, `from` / `until` as `DD/MM/YYYY`; returns `responseClientsCount`, and every row is the full client payload)
  - `clients/get_uploaded_documents`
  - `clients/upload_document`
- **Campaigns need only `clients/list`.**
- **Already built on `docs-capability`** (not merged):
  - `src/lib/documents/smart-npv.ts` (`SmartClient`, `createHttpSmartClient`, `smartClientFor`, a fake client)
  - the tenant's key stored encrypted on the `documents` capability instance (`apiKeyEnc`)
  - **PR 2 must reuse both**: one Smart NPV HTTP module and one stored key per tenant. It should not add a second copy in `ClientSource`. The campaigns connector wraps the same client.
- **No signing date field.** The earlier live read (30 clients modified since 2023) found:
  - `status_report_*` and `transaction_type` hold numeric codes with no labels
  - there is no status title
  - "completed" therefore cannot be read from the data and has to come from Lior

## Script: `scripts/smartnpv-profile.ts`
- Pages `clients/list` by creation date from 2000 until today and prints **aggregates only**:
  - clients per created year
  - fill rate and year spread of **every** date-like field, including nested ones such as `liabilities[].start_date`, so a hidden deal date shows up if it exists
  - archive, status and transaction-type distributions
  - phone quality
  - where the default `deal_date` chain lands and how many fall in the 4.5 to 10 year window
- Writes nothing to disk and prints no names, phones or id numbers.
- Tested against a local fake server only.

```
SMARTNPV_API_KEY=... npx tsx scripts/smartnpv-profile.ts > /tmp/snpv-profile.json
```

## Still open (needs a person or a live account)
1. **Run the profile on Lior's account.** The key is with Lior, or stored encrypted on his tenant in production. It was not fetched for this note. The output decides his `deal_date` order and offsets.
2. **Ask Lior:** what "ביצוע" (`last_date_execution`) means, what archiving means, which status ids mean a closed deal, and where clients from 5+ years ago live (in Smart NPV or only on paper or elsewhere). Also ask for his fee agreement wording on marketing use, for the lawyer.
3. **Ask Zernio support:** do the 25-per-hour and 50-per-day posting caps apply to WhatsApp template sends through `/v1/inbox/conversations`? Is there a send-throughput limit per number?
4. **Lior's messaging tier:** read it from WhatsApp Manager or the Graph field above. Check whether his number shares a business portfolio with any other number.
5. **One real button-tap payload:** with the dev webhook (`npm run proxy` + `scripts/zernio-register-dev-webhook.ts`), tap the digest template's quick-reply button and keep the `message.received` body as a fixture for PR 4.

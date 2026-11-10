---
name: prod-message-troubleshoot
description: >-
  Investigates Zapidly production when a customer or rapid demo got no reply,
  or messages are missing from a conversation. Use when the repo is
  leady-project and the user mentions prod, a ZD- demo code, a missing
  WhatsApp or Instagram message, a silent agent, or a lead that looks stuck.
  Traces the message from Neon to the Zernio inbox and, when a saved inbound
  has no reply, to the Inngest run. Stops at the first gap.
---

# Production message troubleshooting

Find where the message stopped. Do not start with Vercel logs. A missing CRM row usually means the message never reached Zernio.

Report times in Asia/Jerusalem. Database timestamps are UTC. Do not print API keys, webhook secrets, or full customer transcripts. A short timeline is enough. Do not change production data.

## Where the message stopped

Check in this order. Stop at the first gap and say so.

1. **Neon has the inbound.** The app received it. A later `agent` or `nudge-out-` row means the turn finished; check Zernio `deliveryStatus` on that outbound. No reply after the inbound means the turn: Inngest, then reply flags.
2. **Zernio has the inbound, Neon does not.** Webhook, signature, sender gate, or rapid-demo routing dropped it.
3. **Zernio's inbox has nothing after the last known message.** WhatsApp never delivered it to the Zapidly number. The app had nothing to save or answer. Ask which number they texted and whether WhatsApp shows the send as delivered.

`Lead.updatedAt` moving while `lastLeadMessageAt` stays put is a CRM refresh, not a new message. `attentionReason = cold` means the last outbound is newer than the last lead message and 20 hours have passed (`COLD_AFTER_HOURS`). The thread is on the cold tab because of silence.

## Neon

MCP `user-Neon`, tool `run_sql`. Read-only, one statement per call. Project **Leady** `old-math-57936770`. Branch named `production` (resolve with `list_branches`; do not use `staging`). Other Neon projects are not this app.

Quote camelCase columns (`"tenantId"`, `"createdAt"`).

Demos live in `RapidDemo`: `code` (`ZD-` plus 8 chars), `websiteHost`, `status`, `boundPhone`, `expiresAt`, `tenantId`. Join `Tenant` for `name`, `agentRepliesEnabled`, `chatLanguage`.

Then for that `tenantId`:

- `Lead`: `displayName`, `externalUserId`, `lastLeadMessageAt`, `lastOutboundAt`, `attentionReason`, `updatedAt`.
- `Conversation`: `status`, `flowState`, `lifecycleReason`, `updatedAt`.
- `Message` for the thread, oldest first: `role`, `createdAt`, left(text, 160), `providerMessageId`.

`providerMessageId` prefixes: `wamid.` WhatsApp inbound, `out-` agent reply, `nudge-out-` silence nudge. If the reported send is absent, also search `Message` joined to `Lead` on `externalUserId` across tenants. A phone can be routed to the sales agent after a demo expires.

`ZernioSenderGate` is the pause list. An empty table means production is not pausing anyone.

## Zernio inbox

Use `zerino_api_key` from `/Users/naveeiny/leady-project/.env.production`. `vercel env pull` writes `[SENSITIVE]` and is not usable. Never print the key.

`GET https://zernio.com/api/v1/...` with `Authorization: Bearer <key>`.

- `GET /accounts` — shared demo WhatsApp is the active `whatsapp` account, display name Zapidly, username `+972 55-507-6806`. Confirm the id; do not trust a cached one. Instagram is `zapidly_`.
- `GET /inbox/conversations?accountId=<id>&limit=50` — sort by `updatedTime`. The list field is `updatedTime`, not `lastMessageAt`. `pagination.hasMore` tells you if that page is the whole inbox.
- `GET /inbox/conversations/<id>/messages?accountId=<id>&limit=20&sortOrder=desc` — `direction` (`incoming` / `outgoing`), `createdAt`, `deliveryStatus`, `message`.

`GET /webhooks/settings` — production must be an active webhook at `https://app.zapidly.com/api/webhooks/zernio` for `message.received`. A second active webhook (develop preview or ngrok) does not by itself explain a missing row; both can receive. Say if production is missing or inactive.

## Only if Zernio has it and Neon does not

Routing is `src/lib/rapid-demo/route-inbound.ts`, called from `src/app/api/webhooks/zernio/route.ts`.

The sender gate runs **before** rapid-demo routing.

- Production (`VERCEL_ENV=production`) is `pause`: a listed sender is still saved, and the agent does not reply.
- Preview is `allow`: an unlisted sender is dropped with console `zernio.sender_gate` and is not saved.
- A successful rapid-demo turn returns 200 and logs nothing. Do not treat a quiet log search as proof the webhook never fired.
- These do log: `zernio.webhook_secret_missing` (401), `zernio.sender_gate`, `rapid_demo.enqueue_failed`, `rapid_demo.expired_reply_failed`, `rapid_demo.in_use_reply_failed`, `unknown channel`.
- Bad signature is a 401 with no console line.
- `boundPhone` match is exact (`+972...`). A code in the text (`ZD-...`) selects that demo. Expired demos unbind the phone and later texts fall through to the sales agent. `in_use` means another phone holds the code.

Vercel project `leady-project`, scope `navebusiness2-4319s-projects`, production alias `https://app.zapidly.com`. Text search matches console message bodies, not request paths:

```bash
vercel logs --project leady-project --scope navebusiness2-4319s-projects --environment production --since 24h --query "zernio.sender_gate" --limit 50 --json
```

Search preview too when the develop webhook is active. Railway is not this app.

## Only if Neon has the inbound and no reply

Check `Tenant.agentRepliesEnabled` and `ChannelConnection.agentRepliesEnabled`. Both still persist inbound when false.

Then Inngest Cloud. The webhook only enqueues `agent/turn.requested`. A saved lead message with no `out-` row is an enqueue or turn failure, not a missing webhook.

`INNGEST_API_KEY` in `/Users/naveeiny/leady-project/.env` is a read-only key for the production app `leady`. Never print it. Do not call cancel, rerun, pause, invoke, or send. `GET /v1/events` returns 401 for this key. Local `INNGEST_DEV` is a different server; this key reads Cloud.

`GET https://api.inngest.com/v2/...` with `Authorization: Bearer <key>`.

App id `leady`. Function ids:

- `run-agent-turn` on `agent/turn.requested`. Event id `turn-<triggerMessageId>`. Retries 3. One run at a time per `conversationId`.
- `nudge-if-silent` on `agent/nudge.requested`. Stays `RUNNING` while it sleeps. A newer turn for that conversation cancels it.
- `crm-digest` is the hourly cron. `owner-alert` is `crm/owner-alert.requested`. Neither is the reply path.

List runs:

```text
GET /v2/runs?appId=leady&functionId=run-agent-turn&limit=20&query=<cel>
```

`functionId` without `appId` is a 400. CEL `query` filters event payload and output, for example `event.data.conversationId == "<id>"` and `event.data.triggerMessageId == "<message id>"`. `status` is `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, or `SKIPPED`. `from` and `until` are ISO timestamps on `queuedAt` by default.

`GET /v2/runs/<runId>?include=output` returns `stage`, `skipped`, `nudgeScheduled`, and `conversationId`. Do not print `effects`, `nudgeEvent`, or reply text.

`GET /v2/runs/<runId>/trace` is the step tree. `run-agent-turn` steps are `interpret`, then `schedule-nudge` when a reminder was armed. Read the span whose status is not `COMPLETED`.

How to read it:

- No run for that `triggerMessageId`: enqueue never landed (`rapid_demo.enqueue_failed` or `inngest.unreachable`).
- `FAILED`: the trace span is the error. Retries show as more than one `interpret` span.
- `COMPLETED` with `skipped`: the turn bailed out on purpose. Say the skip reason.
- `COMPLETED` and still no `out-` row: the turn finished without sending. Check reply flags and the turn output's `stage`, not Zernio delivery.
- `RUNNING` on `nudge-if-silent`: the reminder has not fired yet.

## Reply shape

Lead with where it stopped, then the evidence:

- Demo code, host, status, expiry, bound phone, replies on or off.
- Last inbound and last outbound, Israel time, one line each.
- Zernio `updatedTime` for that participant, and whether any thread on that account is newer.
- When a reply was due: the Inngest function, run status, and queued time. Omit this when the inbound never reached Neon.
- The check that was not needed, in one sentence, so the next person does not repeat it.

# Leady

Multi-tenant agent CRM. Chat preview, leads with form fields, HITL inbox, JSON flows interpreted in-process (nudges via Inngest). WhatsApp via Zernio.

Design: [docs/agent-runtime.md](docs/agent-runtime.md), [docs/agent-flow-as-data.md](docs/agent-flow-as-data.md).

## Run locally

```bash
npm install
npx prisma db push && npx prisma generate && npm run db:seed
npm run dev
```

Open [http://localhost:3000/demo](http://localhost:3000/demo) and talk as a customer. Pick the same lead on the left to continue that conversation.

### OpenAI (full LLM test)

Add to `.env` and restart `npm run dev`:

```
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-4o-mini
```

Gemini/Anthropic still work if those keys are set and OpenAI is not. Without any key, classify/extract use heuristics.

### Zernio WhatsApp

Set `zerino_api_key` (or `ZERNIO_API_KEY`) and `zerino_sandbox_number` (or `ZERNIO_SANDBOX_NUMBER`). Seed / Channels binds that sandbox number to the dev tenant.

Inbound: `POST /api/webhooks/zernio` (`message.received`). The URL must be public HTTPS. Optional `ZERNIO_WEBHOOK_SECRET` for `X-Zernio-Signature`.

Outbound replies use the Zernio inbox API once a WhatsApp conversation id is stored from the inbound webhook. Chat preview does not send to WhatsApp.

Inngest is only required for delayed nudges (`npx inngest-cli@latest dev`).

`npm test` covers flow validation and the interpreter.

### Public HTTPS (Zernio / any device) — ngrok

```bash
pnpm dev      # terminal 1
pnpm proxy    # terminal 2 — ngrok tunnel, prints NEXT_PUBLIC_APP_URL banner
```

1. Install ngrok: `brew install ngrok/ngrok/ngrok`
2. Add `NGROK_AUTHTOKEN=…` to `.env` ([dashboard](https://dashboard.ngrok.com/get-started/your-authtoken))
3. Copy the `https://…` URL from the banner into `NEXT_PUBLIC_APP_URL`, restart `pnpm dev`
4. Open `/admin` or `/channels` from any device

For a **stable URL** across restarts, set `NGROK_DOMAIN=your-name.ngrok.app` (reserved domain on a paid ngrok plan).

```bash
pnpm proxy:stop
pnpm proxy:status
```

Production on a VPS with your own domain: see `nginx/leady-ssl.example.conf`.

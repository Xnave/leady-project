# Local setup

How to run Leady on a Mac: Postgres, Next.js, Inngest, and the ngrok proxy.

For product architecture see [architecture.md](./architecture.md). Nudge timing details: [nudges.md](./nudges.md).

---

## Prerequisites

- Node 20+ and `pnpm` (or `npm`)
- Homebrew (for Postgres and ngrok)
- Optional: OpenAI / Gemini / Anthropic API key (without a key, classify/extract use heuristics)

```bash
cd leady-project
cp .env.example .env   # if you do not already have .env
pnpm install           # or: npm install
```

---

## 1. Postgres on Mac

Leady expects a PostgreSQL database. The default URL in `.env.example` is:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/leady"
```

### Install and start Postgres (Homebrew)

```bash
brew install postgresql@16
brew services start postgresql@16
```

Ensure `psql` is on your PATH (Homebrew prints the exact `echo '…' >> ~/.zshrc` line after install). Then:

```bash
# Create a superuser role that matches DATABASE_URL (skip if it already exists)
createuser -s postgres 2>/dev/null || true

# Set a password for that role (optional if your local Postgres uses peer auth)
psql postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';" 2>/dev/null || true

# Create the database
createdb -U postgres leady
# or:
# psql postgres -c "CREATE DATABASE leady OWNER postgres;"
```

### Apply schema + seed

```bash
pnpm db:push      # prisma db push — schema → local DB
pnpm db:generate  # prisma generate
pnpm db:seed      # demo tenant / agent / channel
```

Useful checks:

```bash
psql "$DATABASE_URL" -c '\dt'
brew services list | grep postgres
```

---

## 2. Next.js app

```bash
pnpm dev
```

App: [http://localhost:3000](http://localhost:3000)  
Simulator: [http://localhost:3000/demo](http://localhost:3000/demo)

With `DEV_AUTH_BYPASS=true` in `.env`, Clerk is skipped for local CRM work (uses `DEV_TENANT_ID` or the first tenant from seed).

**Demo chat does not need Inngest or ngrok** — `/api/demo/message` can run the turn synchronously. Start those only when you care about delayed nudges or public webhooks (WhatsApp).

---

## 3. Inngest (async turns + delayed nudges)

Inngest owns durable `runAgentTurn` and silence nudges. Real WhatsApp/Instagram webhooks call `enqueueAgentTurn()`; without a local Inngest Dev Server those events never land on `localhost:8288`.

### Env

From `.env.example`:

```env
INNGEST_DEV="1"
INNGEST_EVENT_KEY="local"
INNGEST_SIGNING_KEY="local"
# Optional:
# INNGEST_BASE_URL="http://127.0.0.1:8288"
# NUDGE_AFTER_OVERRIDE="PT5M"   # shorter nudges while testing
```

When `INNGEST_DEV=1`, `src/inngest/client.ts` points the SDK at the Dev Server (`http://127.0.0.1:8288` by default).

### Run

In a **second** terminal (Next must already be on `:3000`):

```bash
npx inngest-cli@latest dev
```

- Dev UI: [http://localhost:8288](http://localhost:8288)
- App serve route: `http://localhost:3000/api/inngest` (the CLI discovers this)

Leave both `pnpm dev` and the Inngest CLI running while testing webhooks or nudges.

---

## 4. ngrok proxy (public HTTPS)

Zernio (and similar) need a **public HTTPS** URL. `pnpm proxy` wraps ngrok and tunnels to your local Next port.

### Install + token

```bash
brew install ngrok/ngrok/ngrok
```

Add to `.env` ([ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)):

```env
NGROK_AUTHTOKEN="…"
# Optional paid reserved domain — same URL every restart:
# NGROK_DOMAIN="your-name.ngrok.app"
```

### Run order

```bash
# Terminal 1
pnpm dev

# Terminal 2 — requires Next already answering on :3000
pnpm proxy
```

`scripts/proxy.sh`:

1. Checks `http://127.0.0.1:3000` is up (override port with `LEADY_DEV_PORT`)
2. Reads `NGROK_AUTHTOKEN` / `NGROK_DOMAIN` from `.env`
3. Starts `ngrok http 3000` (optionally `--domain=…`)
4. Polls the local ngrok API at `http://127.0.0.1:4040/api/tunnels` for the public `https://…` URL
5. Prints a banner with that URL

Other commands:

```bash
pnpm proxy:status   # running URL if any
pnpm proxy:stop
```

Inspector UI while the tunnel is up: [http://127.0.0.1:4040](http://127.0.0.1:4040)

---

## 5. How the proxy URL reaches the Next app

**Important: the proxy does not write `.env` or hot-inject the URL into a running Next process.**

Flow:

```text
ngrok ──https──► localhost:3000
  │
  └─ public_url from :4040 API
         │
         ▼
   banner printed by pnpm proxy
         │
         ▼
   you set NEXT_PUBLIC_APP_URL in .env
         │
         ▼
   restart pnpm dev  (Next loads env at startup)
```

1. Copy the banner value into `.env`:

   ```env
   NEXT_PUBLIC_APP_URL="https://abcd-1234.ngrok-free.app"
   ```

2. **Restart** `pnpm dev`. Next.js reads `NEXT_PUBLIC_*` when the process starts (and can inline them for the client). A running server will keep the old value until restart.

3. Code that needs the public origin reads that env (locally), for example:
   - `appOrigin()` / `requestOrigin()` in `src/lib/request-url.ts` — redirects, OAuth/connect callbacks, invites
   - Zernio connect / webhook registration (`pnpm zernio:webhook:dev` builds `{NEXT_PUBLIC_APP_URL}/api/webhooks/zernio`)
   - HookMyApp helpers that fall back to `NEXT_PUBLIC_APP_URL`

On **Vercel**, `appOrigin()` prefers `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` so a leftover ngrok URL in env cannot break production redirects.

### Free vs reserved domain

| Setup | Behavior |
| --- | --- |
| Token only | New random `*.ngrok-free.app` each `pnpm proxy` → update `.env` + restart Next each time |
| `NGROK_DOMAIN=…` | Stable URL → set `.env` once |

### Wire Zernio to the tunnel

After `NEXT_PUBLIC_APP_URL` is set and Next restarted:

```bash
pnpm zernio:webhook:dev
```

That registers a webhook at `{NEXT_PUBLIC_APP_URL}/api/webhooks/zernio`. Keep a production webhook if you want — you may see duplicate replies while both are active.

---

## Typical three-terminal layout

| Terminal | Command | Needed for |
| --- | --- | --- |
| 1 | `pnpm dev` | Always |
| 2 | `npx inngest-cli@latest dev` | Webhook turns + delayed nudges |
| 3 | `pnpm proxy` | Public HTTPS (WhatsApp / remote devices) |

Minimal local chat: **terminal 1 only**.

---

## Quick checklist

- [ ] Postgres running; `DATABASE_URL` points at `leady`
- [ ] `pnpm db:push && pnpm db:generate && pnpm db:seed`
- [ ] `.env` has `DEV_AUTH_BYPASS`, LLM key (optional), `INNGEST_DEV=1`
- [ ] `pnpm dev` → `/demo` works
- [ ] (Optional) Inngest CLI on `:8288`
- [ ] (Optional) `NGROK_AUTHTOKEN`, `pnpm proxy`, set `NEXT_PUBLIC_APP_URL`, restart Next
- [ ] (Optional) `pnpm zernio:webhook:dev`

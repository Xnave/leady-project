#!/usr/bin/env bash
# ngrok tunnel to Next.js — stable public HTTPS for Zernio / admin redirects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PORT="${LEADY_DEV_PORT:-3000}"
CMD="${1:-start}"

load_env() {
  NGROK_AUTHTOKEN=""
  NGROK_DOMAIN=""
  if [[ -f "$ENV_FILE" ]]; then
    NGROK_AUTHTOKEN=$(grep -E '^NGROK_AUTHTOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
    NGROK_DOMAIN=$(grep -E '^NGROK_DOMAIN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
  fi
}

stop_ngrok() {
  pkill -f "ngrok http" 2>/dev/null || true
  pkill -f "cloudflared tunnel" 2>/dev/null || true
}

print_banner() {
  local url="$1"
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  Set in .env, then restart pnpm dev                              ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  printf "║  NEXT_PUBLIC_APP_URL=\"%-42s\" ║\n" "$url"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Admin:    ${url}/admin"
  echo "  Channels: ${url}/channels"
  echo "  Webhook:  ${url}/api/webhooks/zernio"
  echo "  Inspector: http://127.0.0.1:4040"
  echo ""
}

tunnel_url() {
  curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    for t in data.get('tunnels', []):
        u = t.get('public_url', '')
        if u.startswith('https://'):
            print(u)
            break
except Exception:
    pass
" 2>/dev/null || true
}

wait_for_url() {
  local url=""
  for _ in $(seq 1 40); do
    url="$(tunnel_url)"
    if [[ -n "$url" ]]; then
      echo "$url"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_proxy() {
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "ERROR: ngrok not found. Install: brew install ngrok/ngrok/ngrok"
    exit 1
  fi
  if ! curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
    echo "ERROR: Next.js is not running on http://127.0.0.1:${PORT}"
    echo "Start it first: pnpm dev"
    exit 1
  fi

  load_env
  stop_ngrok
  sleep 0.5

  local -a args=(http "$PORT" --log=stdout)

  if [[ -n "${NGROK_DOMAIN:-}" ]]; then
    args+=(--domain="$NGROK_DOMAIN")
    echo "→ ngrok: reserved domain ${NGROK_DOMAIN} → localhost:${PORT}"
  else
    echo "→ ngrok: public tunnel → localhost:${PORT}"
    if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
      echo "  Tip: add NGROK_AUTHTOKEN to .env (free at https://dashboard.ngrok.com)"
    fi
  fi

  if [[ -n "${NGROK_AUTHTOKEN:-}" ]]; then
    export NGROK_AUTHTOKEN
  fi

  cleanup() {
    echo ""
    echo "→ Stopping ngrok…"
    kill "$NGROK_PID" 2>/dev/null || true
    stop_ngrok
    exit 0
  }
  trap cleanup INT TERM

  ngrok "${args[@]}" &
  NGROK_PID=$!

  if url="$(wait_for_url)"; then
    print_banner "$url"
    if [[ -z "${NGROK_DOMAIN:-}" ]]; then
      echo "── URL changes each run unless NGROK_DOMAIN is set (paid plan) ──"
      echo ""
    fi
  else
    echo "WARN: could not read tunnel URL from http://127.0.0.1:4040 — check ngrok output"
    echo ""
  fi

  echo "── ngrok log (Ctrl+C to stop) ──"
  wait "$NGROK_PID"
}

case "$CMD" in
  start) start_proxy ;;
  stop)
    stop_ngrok
    echo "ngrok stopped"
    ;;
  status)
    if pgrep -f "ngrok http" >/dev/null 2>&1; then
      url="$(tunnel_url)"
      if [[ -n "$url" ]]; then
        echo "ngrok: running → $url"
      else
        echo "ngrok: running (open http://127.0.0.1:4040 for URL)"
      fi
    else
      echo "ngrok: not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac

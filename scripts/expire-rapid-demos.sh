#!/usr/bin/env bash
# Expire every active rapid demo on one database, then delete those tenants.
#
#   npm run demos:expire
#   npm run demos:expire:staging
#
# ENV_FILE overrides the env file (default .env). Production is refused unless
# EXPIRE_DEMOS_YES=1, because that database can hold visitor demos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$ROOT/$ENV_FILE"
fi

database_url_from_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Missing env file: $file" >&2
    exit 1
  fi
  local line
  line=$(grep -E '^DATABASE_URL=' "$file" | tail -1 || true)
  if [[ -z "$line" ]]; then
    echo "DATABASE_URL is not set in $file" >&2
    exit 1
  fi
  line="${line#DATABASE_URL=}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  printf '%s' "$line"
}

host_of() {
  local url="$1"
  url="${url#*@}"
  url="${url%%\?*}"
  printf '%s' "${url%%/*}"
}

DATABASE_URL="$(database_url_from_file "$ENV_FILE")"
export DATABASE_URL
target_host="$(host_of "$DATABASE_URL")"
prod_file="$ROOT/.env.production"
if [[ -f "$prod_file" ]]; then
  prod_host="$(host_of "$(database_url_from_file "$prod_file")")"
  if [[ "$target_host" == "$prod_host" && "${EXPIRE_DEMOS_YES:-}" != "1" ]]; then
    echo "Refusing to expire demos on production ($target_host). Set EXPIRE_DEMOS_YES=1 to override." >&2
    exit 1
  fi
fi

echo "Target database: ${target_host} (from ${ENV_FILE})"
cd "$ROOT"
exec npx tsx scripts/expire-rapid-demos.ts

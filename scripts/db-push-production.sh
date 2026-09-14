#!/usr/bin/env bash
# Apply prisma/schema.prisma to the database in .env.production (e.g. Neon).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"

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

DATABASE_URL="$(database_url_from_file "$ENV_FILE")"

cd "$ROOT"
echo "Pushing Prisma schema to production database…"
DATABASE_URL="$DATABASE_URL" npx prisma db push --skip-generate
echo "Done."

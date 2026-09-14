#!/usr/bin/env bash
# Copy all public schema data from local Postgres (.env) to target (.env.production).
# Schema must already match (run scripts/db-push-production.sh first).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_ENV="${LOCAL_ENV:-$ROOT/.env}"
TARGET_ENV="${TARGET_ENV:-$ROOT/.env.production}"
WIPE_TARGET=false

usage() {
  cat <<'EOF'
Usage: db-import-local-to-production.sh [--wipe]

  --wipe   Truncate all tables in the target DB before import (safe re-run).

Env overrides:
  LOCAL_ENV   default: .env
  TARGET_ENV  default: .env.production
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wipe) WIPE_TARGET=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

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

pick_pg_tool() {
  local name="$1"
  if [[ -x "/opt/homebrew/opt/postgresql@17/bin/$name" ]]; then
    echo "/opt/homebrew/opt/postgresql@17/bin/$name"
    return
  fi
  if [[ -x "/opt/homebrew/opt/postgresql@16/bin/$name" ]]; then
    echo "/opt/homebrew/opt/postgresql@16/bin/$name"
    return
  fi
  command -v "$name"
}

LOCAL_URL="$(database_url_from_file "$LOCAL_ENV")"
TARGET_URL="$(database_url_from_file "$TARGET_ENV")"

if [[ "$LOCAL_URL" == "$TARGET_URL" ]]; then
  echo "Refusing to import: local and target DATABASE_URL are identical." >&2
  exit 1
fi

PG_DUMP="$(pick_pg_tool pg_dump)" || true
PSQL="$(pick_pg_tool psql)" || true
[[ -n "$PG_DUMP" && -x "$PG_DUMP" ]] || { echo "pg_dump not found (install PostgreSQL client tools)." >&2; exit 1; }
[[ -n "$PSQL" && -x "$PSQL" ]] || { echo "psql not found (install PostgreSQL client tools)." >&2; exit 1; }

if [[ "$WIPE_TARGET" == true ]]; then
  echo "Truncating all tables in target database…"
  "$PSQL" "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET search_path TO public;
DO $$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tables
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN ('_prisma_migrations');

  IF tables IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tables || ' CASCADE';
  END IF;
END $$;
SQL
fi

echo "Dumping data from local database and loading into production…"
{
  echo "SET search_path TO public;"
  "$PG_DUMP" \
    --data-only \
    --no-owner \
    --no-acl \
    --schema=public \
    --dbname="$LOCAL_URL"
} | "$PSQL" "$TARGET_URL" -v ON_ERROR_STOP=1 -q

echo "Import finished."

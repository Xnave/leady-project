#!/usr/bin/env bash
# Schema changes on the database in .env.production (e.g. Neon), through Prisma migrations.
#
#   diff      Read-only. Prints the SQL that would bring the database to prisma/schema.prisma.
#             Before `migrate` it must equal the pending migration file(s); after, it must be empty.
#   verify    Read-only. Checks that `diff` is exactly the pending migrations (order aside),
#             i.e. the database matches the last applied migration and nothing else drifted.
#   status    Read-only. Which migrations the database has applied, and which are pending.
#   baseline  One-time. Records 0_init (the schema production already had) as applied, without running it.
#   migrate   Applies the pending migrations (`prisma migrate deploy`).
#   backfill  Runs scripts/crm-backfill.ts against the database.
#
# ENV_FILE overrides the env file (default .env.production), e.g. to rehearse on a copy.
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

cmd="${1:-}"
DATABASE_URL="$(database_url_from_file "$ENV_FILE")"
export DATABASE_URL
cd "$ROOT"
# Show the target (host/db, no credentials) so a wrong env file is obvious.
target="${DATABASE_URL#*@}"
target="${target%%\?*}"
echo "Target database: ${target} (from ${ENV_FILE})" >&2

case "$cmd" in
  diff)
    npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
    ;;
  verify)
    # Pending = what `migrate status` lists; before the baseline, 0_init counts as already there.
    pending=$(npx prisma migrate status 2>/dev/null | awk '/have not yet been applied:/{f=1;next} f&&NF==0{exit} f{print $1}' | grep -v '^0_init$' || true)
    expected=$(for m in $pending; do cat "prisma/migrations/$m/migration.sql"; done | { grep -vE '^\s*(--.*)?$' || true; } | sort)
    actual=$(npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null \
      | { grep -vE '^\s*(--.*)?$' || true; } | sort)
    echo "Pending migrations: ${pending:-none}"
    if [[ "$expected" == "$actual" ]]; then
      echo "OK: the database differs from the schema by exactly the pending migrations."
    else
      echo "MISMATCH: the database has drifted. Do not migrate. Differences (< pending migrations, > database diff):" >&2
      diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") >&2 || true
      exit 1
    fi
    ;;
  status)
    npx prisma migrate status
    ;;
  baseline)
    npx prisma migrate resolve --applied 0_init
    ;;
  migrate)
    npx prisma migrate deploy
    ;;
  backfill)
    npx tsx scripts/crm-backfill.ts
    ;;
  *)
    echo "Usage: db-production.sh diff|verify|status|baseline|migrate|backfill" >&2
    exit 1
    ;;
esac

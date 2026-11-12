#!/usr/bin/env bash
# Schema changes on the database in .env.production (e.g. Neon), through Prisma migrations.
#
#   diff      Read-only. Prints the SQL that would bring the database to prisma/schema.prisma.
#             Before `migrate` it must equal the pending migration file(s); after, it must be empty.
#   check     Read-only. Same as diff, and exits non-zero when that SQL is not empty.
#             CI runs this against staging and production. Only the production result fails the pull request.
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
# CI passes the URL in the environment (DATABASE_URL_FROM_ENV=1) so the secret
# stays out of a file. Local commands keep reading ENV_FILE.
if [[ "${DATABASE_URL_FROM_ENV:-}" == "1" ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is empty." >&2
    exit 1
  fi
  source_label="the environment"
else
  DATABASE_URL="$(database_url_from_file "$ENV_FILE")"
  export DATABASE_URL
  source_label="${ENV_FILE}"
fi
cd "$ROOT"
# Show the target (host/db, no credentials) so a wrong env file is obvious.
target="${DATABASE_URL#*@}"
target="${target%%\?*}"
echo "Target database: ${target} (from ${source_label})" >&2

# Changes need a person at a terminal typing the host back. With no terminal (a script,
# CI, an agent, a stray command substitution) the answer can't be given, so it aborts.
confirm_write() {
  local host="${target%%/*}"
  if [[ ! -r /dev/tty ]] || ! { exec 3</dev/tty; } 2>/dev/null; then
    echo "Refusing to $cmd: no terminal to confirm on." >&2
    exit 1
  fi
  printf 'This will %s the database above. Type its host (%s) to continue: ' "$cmd" "$host" >/dev/tty
  local answer
  read -r answer <&3 || answer=""
  exec 3<&-
  if [[ "$answer" != "$host" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
}
case "$cmd" in
  baseline | migrate | backfill) confirm_write ;;
esac

case "$cmd" in
  diff)
    npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
    ;;
  check)
    # Empty diff exits 0. A real SQL diff exits 2. Anything else is a connection or schema error.
    set +e
    npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script --exit-code
    code=$?
    set -e
    if [[ "$code" -eq 0 ]]; then
      echo "OK: no schema diff."
      exit 0
    fi
    if [[ "$code" -eq 2 ]]; then
      echo "Schema diff is not empty. Apply the migration to this database before merging." >&2
      exit 1
    fi
    exit "$code"
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
    echo "Usage: db-production.sh diff|check|verify|status|baseline|migrate|backfill" >&2
    exit 1
    ;;
esac

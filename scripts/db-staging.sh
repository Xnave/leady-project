#!/usr/bin/env bash
# Same commands as db-production.sh, against the database in .env.staging.
#
#   npm run db:migrate:staging
#
# ENV_FILE overrides the env file (default .env.staging).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ENV_FILE="${ENV_FILE:-$ROOT/.env.staging}"
exec "$ROOT/scripts/db-production.sh" "$@"

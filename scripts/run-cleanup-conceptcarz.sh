#!/usr/bin/env bash
# Run conceptcarz cleanup in batches via psql (long timeout required).
# Each pass runs one batch of each step; run multiple passes until done.
#
# Usage:
#   dotenvx run -- ./scripts/run-cleanup-conceptcarz.sh [passes]
# Default: 200 passes (enough for ~375k discovery_url + 27k model + 7k delete + 108k VIN + dedupe).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PASSES="${1:-200}"

if [ -z "${PGPASSWORD:-}" ] && [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  export PGPASSWORD="$SUPABASE_DB_PASSWORD"
fi
if [ -z "${PGPASSWORD:-}" ]; then
  echo "Set PGPASSWORD or SUPABASE_DB_PASSWORD (or use dotenvx run --)" >&2
  exit 1
fi

PSQL_OPTS=(
  -h "aws-0-us-west-1.pooler.supabase.com"
  -p 6543
  -U "postgres.qkgaybvrernstplzjaam"
  -d postgres
  -v "statement_timeout=300000"
  -f "$ROOT/scripts/cleanup-conceptcarz.sql"
)

echo "Running up to $PASSES passes (statement_timeout=5min per pass)..."
for i in $(seq 1 "$PASSES"); do
  echo "--- Pass $i ---"
  if ! psql "${PSQL_OPTS[@]}" 2>&1; then
    echo "Pass $i failed (e.g. timeout); you can re-run to continue." >&2
    exit 1
  fi
done
echo "Done."

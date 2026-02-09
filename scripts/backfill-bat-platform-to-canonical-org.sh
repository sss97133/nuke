#!/usr/bin/env bash
# Backfill all BAT listings to canonical BAT org (d2bd6370) as auction_platform.
# Run until no more rows. Then refresh org totals.
# Usage: dotenvx run -- bash scripts/backfill-bat-platform-to-canonical-org.sh

set -e
export PGHOST=${PGHOST:-aws-0-us-west-1.pooler.supabase.com}
export PGPORT=${PGPORT:-6543}
export PGUSER=${PGUSER:-postgres.qkgaybvrernstplzjaam}
export PGDATABASE=${PGDATABASE:-postgres}
export PGPASSWORD="${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD in .env}"

BATCH=${BATCH_SIZE:-5000}
LAST_ID=""
TOT=0
N=0

echo "Linking BAT listings to canonical Bring a Trailer org (d2bd6370)..."
while true; do
  if [[ -z "$LAST_ID" ]]; then
    OUT=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted, COALESCE(last_id::text, '') FROM backfill_bat_platform_to_canonical_org($BATCH, NULL);")
  else
    OUT=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted, COALESCE(last_id::text, '') FROM backfill_bat_platform_to_canonical_org($BATCH, '$LAST_ID');")
  fi
  N=$((N + 1))
  INSERTED=$(echo "$OUT" | cut -d'|' -f1)
  LAST_ID=$(echo "$OUT" | cut -d'|' -f2)
  INSERTED=${INSERTED:-0}
  TOT=$((TOT + INSERTED))
  [[ $((N % 5)) -eq 0 ]] && echo "  batch $N: +$INSERTED (total $TOT)"
  [[ "$INSERTED" -eq 0 ]] && break
done

echo "Done. Inserted $TOT auction_platform links for BAT."
echo "Refreshing businesses.total_vehicles..."
psql -c "SET statement_timeout = 0; SELECT refresh_org_total_vehicles();"
echo "BAT org profile should now show vehicle count."

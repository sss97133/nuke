#!/usr/bin/env bash
# Run backfill in batches via psql; each run is a new connection so pooler won't kill us.
# Usage: dotenvx run -- bash scripts/backfill-vehicle-org-claims-psql-loop.sh
set -e
export PGHOST=aws-0-us-west-1.pooler.supabase.com
export PGPORT=6543
export PGUSER=postgres.qkgaybvrernstplzjaam
export PGDATABASE=postgres
export PGPASSWORD="${SUPABASE_DB_PASSWORD:?set SUPABASE_DB_PASSWORD}"

BATCH=1000
LAST_ID=""
TOT=0
BATCH_NUM=0

while true; do
  if [[ -z "$LAST_ID" ]]; then
    OUT=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted_seller, inserted_platform, COALESCE(last_id::text, '') FROM backfill_vehicle_org_claims_from_bat_listings($BATCH, NULL);")
  else
    OUT=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted_seller, inserted_platform, COALESCE(last_id::text, '') FROM backfill_vehicle_org_claims_from_bat_listings($BATCH, '$LAST_ID');")
  fi
  BATCH_NUM=$((BATCH_NUM + 1))
  S=$(echo "$OUT" | cut -d'|' -f1)
  P=$(echo "$OUT" | cut -d'|' -f2)
  LAST_ID=$(echo "$OUT" | cut -d'|' -f3)
  TOT=$((TOT + S + P))
  [[ $((BATCH_NUM % 5)) -eq 0 ]] && echo "  batch $BATCH_NUM: seller=$S platform=$P total=$TOT"
  [[ -z "$LAST_ID" ]] && break
done

echo "Done. Batches=$BATCH_NUM total inserted=$TOT"
psql -c "SELECT refresh_org_total_vehicles();"

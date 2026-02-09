#!/usr/bin/env bash
# Run org-vehicle backfill via psql (no statement timeout). Use when TS script times out.
# Usage: dotenvx run -- bash scripts/backfill-all-org-vehicle-links-psql.sh
# Requires .env with SUPABASE_DB_PASSWORD (and optionally PGHOST/PGPORT/PGUSER/PGDATABASE).

set -e
export PGHOST=${PGHOST:-aws-0-us-west-1.pooler.supabase.com}
export PGPORT=${PGPORT:-6543}
export PGUSER=${PGUSER:-postgres.qkgaybvrernstplzjaam}
export PGDATABASE=${PGDATABASE:-postgres}
export PGPASSWORD="${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD in .env}"

BATCH=${BATCH_SIZE:-2000}

run_until_zero() {
  local name="$1"
  local rpc="$2"
  local total=0
  echo "Running $name..."
  while true; do
    out=$(psql -t -A -c "SET statement_timeout = 0; SELECT * FROM $rpc($BATCH);" 2>/dev/null || true)
    if [[ -z "$out" ]]; then break; fi
    n=$(echo "$out" | head -1 | tr -d ' ' | cut -d'|' -f1)
    n=${n:-0}
    total=$((total + n))
    [[ "$n" -eq 0 ]] && break
    echo "  $name: +$n (total $total)"
  done
  echo "  $name done: $total"
}

run_external_listings() {
  echo "Running external_listings..."
  total_s=0; total_p=0
  while true; do
    out=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted_seller, inserted_platform FROM backfill_org_vehicles_from_external_listings($BATCH);" 2>/dev/null || true)
    [[ -z "$out" ]] && break
    s=$(echo "$out" | cut -d'|' -f1); p=$(echo "$out" | cut -d'|' -f2)
    s=${s:-0}; p=${p:-0}
    total_s=$((total_s + s)); total_p=$((total_p + p))
    [[ "$s" -eq 0 && "$p" -eq 0 ]] && break
    echo "  external_listings: seller +$s platform +$p"
  done
  echo "  external_listings done: seller $total_s platform $total_p"
}

run_bat() {
  echo "Running BAT backfill..."
  total_s=0; total_p=0; last_id=""
  while true; do
    if [[ -z "$last_id" ]]; then
      out=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted_seller, inserted_platform, COALESCE(last_id::text, '') FROM backfill_vehicle_org_claims_from_bat_listings($BATCH, NULL);")
    else
      out=$(psql -t -A -c "SET statement_timeout = 0; SELECT inserted_seller, inserted_platform, COALESCE(last_id::text, '') FROM backfill_vehicle_org_claims_from_bat_listings($BATCH, '$last_id');")
    fi
    s=$(echo "$out" | cut -d'|' -f1); p=$(echo "$out" | cut -d'|' -f2); last_id=$(echo "$out" | cut -d'|' -f3)
    s=${s:-0}; p=${p:-0}
    total_s=$((total_s + s)); total_p=$((total_p + p))
    [[ "$s" -eq 0 && "$p" -eq 0 && -z "$last_id" ]] && break
    echo "  BAT: seller +$s platform +$p"
  done
  echo "  BAT done: seller $total_s platform $total_p"
}

echo "=== Backfill all org-vehicle links (batch $BATCH) via psql ===
"
run_bat
run_until_zero "build_threads" "backfill_org_vehicles_from_build_threads"
run_until_zero "origin_org" "backfill_org_vehicles_from_origin_org"
run_external_listings
run_until_zero "timeline_events" "backfill_org_vehicles_from_timeline_events"

echo ""
echo "Refreshing businesses.total_vehicles..."
psql -c "SET statement_timeout = 0; SELECT refresh_org_total_vehicles();"
echo "=== Done ==="

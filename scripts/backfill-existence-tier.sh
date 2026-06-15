#!/usr/bin/env bash
# ============================================================================
# vehicles.existence_tier backfill — Source Data Reorg campaign, step 4.
# See docs/plans/2026-06-11_source-data-reorg-campaign.md and migration
# 20260611040200_vehicles_existence_tier.sql for the tier definitions.
#
# TWO PHASES, because the vehicles table carries 26 UPDATE triggers:
#
#   PHASE A (default, runs now) — COMPUTE tiers into
#   public.existence_tier_staging via batched read-only INSERT..SELECT.
#   Zero writes to vehicles: no trigger fires, no updated_at /
#   last_activity_at churn, no completion-queue storm. 256 uuid-prefix id
#   ranges (~3.5K rows each; read+insert-elsewhere — db-safety's 1,000-row
#   cap targets UPDATE/DELETE on hot tables), pg_sleep(0.1) between, 110s
#   statement_timeout, lock-cascade tripwire. Idempotent upsert — safe to
#   re-run any time.
#
#   PHASE B (--copy, GATED) — copy staging.tier into vehicles.existence_tier.
#   This is an UPDATE on vehicles and therefore fires the trigger pile.
#   Measured 2026-06-10: with triggers live, ONE 1,000-row batch exceeds the
#   110s statement_timeout (trigger_update_vehicle_status runs
#   calculate_vehicle_data_completeness + upserts vehicle_status_metadata
#   PER ROW), and a full run would corrupt operational signals platform-wide
#   (updated_at + last_activity_at bumped on all 910K rows, 910K
#   completion-recompute enqueues). The integrity triggers (VIN uniqueness,
#   taxonomy, normalize) are all column-scoped (UPDATE OF vin/...) and do
#   NOT fire for an existence_tier-only update — so suspending triggers for
#   the copy session changes nothing for integrity — but per-session trigger
#   suspension (session_replication_role=replica) needs explicit owner
#   sanction. Until then --copy refuses unless NUKE_TIER_COPY_SANCTIONED=1.
#   The durable alternative: scope the churn triggers
#   (trigger_update_vehicle_status, update_vehicle_completion,
#   vehicles_search_vector_trigger, vehicles_update_timestamp) to their
#   relevant columns — the same disease as the 18-trigger vehicle_images
#   write storm in .claude/ISSUES.md — then run --copy with triggers live.
#
# existence_tier is OPERATIONAL classification (recomputable) — no testimony
# value is altered in either phase.
#
# Usage (from repo root):
#   dotenvx run -f .env -f .env.supabase -- bash scripts/backfill-existence-tier.sh           # phase A
#   NUKE_TIER_COPY_SANCTIONED=1 dotenvx run -f .env -f .env.supabase -- \
#     bash scripts/backfill-existence-tier.sh --copy                                          # phase B
# ============================================================================
set -euo pipefail

PGHOST="${NUKE_PGHOST:-aws-0-us-west-1.pooler.supabase.com}"
PGPORT="${NUKE_PGPORT:-5432}"
PGUSER="${NUKE_PGUSER:-postgres.qkgaybvrernstplzjaam}"
PGDB="${NUKE_PGDB:-postgres}"


export PGPASSWORD="${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD required (run under dotenvx)}"
export PGOPTIONS="-c statement_timeout=110s"

PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -X -t -A -v ON_ERROR_STOP=1)

WORKDIR="${NUKE_TIER_WORKDIR:-/tmp/existence-tier-run}"
rm -rf "$WORKDIR" && mkdir -p "$WORKDIR"
BOUNDS="$WORKDIR/bounds.txt"
BATCHSQL="$WORKDIR/batches.sql"
RUNLOG="$WORKDIR/run.log"

TIER_CASE="CASE
      WHEN v.deleted_at IS NOT NULL OR v.merged_into_vehicle_id IS NOT NULL THEN 'dead'
      WHEN v.user_id IS NOT NULL OR v.uploaded_by IS NOT NULL OR v.owner_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions p WHERE p.vehicle_id = v.id AND p.is_active)
           OR (COALESCE(v.image_count, 0) >= 4
               AND (EXISTS (SELECT 1 FROM public.vehicle_events e WHERE e.vehicle_id = v.id)
                    OR EXISTS (SELECT 1 FROM public.vehicle_observations o WHERE o.vehicle_id = v.id))
               AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL)
        THEN 'a'
      WHEN (COALESCE(v.sale_price, 0) > 0 OR COALESCE(v.sold_price, 0) > 0
            OR COALESCE(v.bat_sold_price, 0) > 0 OR COALESCE(v.canonical_sold_price, 0) > 0)
           AND v.year IS NOT NULL AND v.make IS NOT NULL
        THEN 'b'
      ELSE 'c'
    END"

if [ "${1:-}" = "--copy" ]; then
  if [ "${NUKE_TIER_COPY_SANCTIONED:-0}" != "1" ]; then
    echo "REFUSING --copy: phase B updates 910K vehicles rows and either fires the"
    echo "churn-trigger pile (signal corruption + >110s/batch) or needs per-session"
    echo "trigger suspension. Set NUKE_TIER_COPY_SANCTIONED=1 only with owner sanction,"
    echo "or fix the trigger column-scoping first (see header)." >&2
    exit 2
  fi
  echo "phase B: copying staging -> vehicles.existence_tier (1,000/batch, triggers suspended for session)..."
  TOTAL=0
  while :; do
    N=$("${PSQL[@]}" -q -c "
      -- ALLOW_RAW_TESTIMONY_WRITE: vehicles.existence_tier is an operational,
      -- recomputable classification column — no testimony value is altered.
      -- Sanctioned: source-data-reorg campaign step 4 (owner-sanctioned copy phase).
      SET session_replication_role = replica;
      WITH b AS (
        SELECT s.vehicle_id, s.tier FROM public.existence_tier_staging s
        JOIN public.vehicles v ON v.id = s.vehicle_id
        WHERE v.existence_tier IS DISTINCT FROM s.tier
        LIMIT 1000
      ), u AS (
        UPDATE public.vehicles v SET existence_tier = b.tier
        FROM b WHERE v.id = b.vehicle_id RETURNING 1
      ) SELECT count(*) FROM u;" | tail -1)
    [ "${N:-0}" = "0" ] && break
    TOTAL=$((TOTAL + N))
    LOCKS=$("${PSQL[@]}" -q -c "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';")
    if [ "${LOCKS:-0}" -gt 0 ]; then echo "lock cascade — stopping at $TOTAL rows" >&2; exit 1; fi
    sleep 0.1
  done
  echo "phase B done: $TOTAL rows copied."
  exit 0
fi

echo "phase A: computing tiers into public.existence_tier_staging (read-only on vehicles)"

"${PSQL[@]}" -q -c "
  CREATE TABLE IF NOT EXISTS public.existence_tier_staging (
    vehicle_id uuid PRIMARY KEY,
    tier text NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now()
  );"

echo "phase A.1: generating fixed uuid-prefix ranges (uuids are uniform; no boundary precompute needed)..."
# 256 ranges on the first id byte -> ~3.5K rows each on the 910K table.
# (A row_number() boundary precompute over the full PK blows the 110s
# statement_timeout on this table — measured 2026-06-10.)
: > "$BOUNDS"
for i in $(seq 0 255); do printf '%02x\n' "$i" >> "$BOUNDS"; done

echo "phase A.2: generating batch SQL -> $BATCHSQL"
{
  echo "SET statement_timeout = '110s';"
  echo "SET lock_timeout = '15s';"
  awk -v tiercase="$(printf '%s' "$TIER_CASE" | tr '\n' ' ')" '
    function emit(low, high,    cond) {
      cond = "v.id >= '\''" low "000000-0000-0000-0000-000000000000'\''";
      if (high != "") cond = cond " AND v.id < '\''" high "000000-0000-0000-0000-000000000000'\''";
      print "WITH src AS (";
      print "  SELECT v.id, " tiercase " AS tier";
      print "  FROM public.vehicles v WHERE " cond;
      print "), ins AS (";
      print "  INSERT INTO public.existence_tier_staging (vehicle_id, tier)";
      print "  SELECT id, tier FROM src";
      print "  ON CONFLICT (vehicle_id) DO UPDATE SET tier = EXCLUDED.tier, computed_at = now()";
      print "  RETURNING tier)";
      print "SELECT '\''TIER|'\'' || tier || '\''|'\'' || count(*) FROM ins GROUP BY tier;";
      print "SELECT pg_sleep(0.1);";
      nb++;
      if (nb % 20 == 0) {
        # tripwire: abort only if someone is blocked BY THIS session
        # (ambient lock waits from other writers are not ours to trip on)
        print "SELECT CASE WHEN count(*) > 0 THEN 1/0 ELSE 0 END";
        print "FROM pg_stat_activity";
        print "WHERE wait_event_type = '\''Lock'\'' AND pg_blocking_pids(pid) @> ARRAY[pg_backend_pid()];";
        print "SELECT '\''PROGRESS|'\'' || " nb " || '\''|'\'' || now()::time(0);";
      }
    }
    NR > 1 { emit(prev, $0) } { prev = $0 }
    END { emit(prev, "") }
  ' "$BOUNDS"
} > "$BATCHSQL"
echo "  $(grep -c '^WITH src AS' "$BATCHSQL") range statements generated"

echo "phase A.3: executing (single session, autocommit per statement)..."
"${PSQL[@]}" -q -f "$BATCHSQL" > "$RUNLOG"

echo "rows staged this run:"
grep '^TIER|' "$RUNLOG" | awk -F'|' '{s[$2]+=$3; tot+=$3} END {for (k in s) printf "  %s: %d\n", k, s[k]; printf "  total: %d\n", tot}'

echo "staging table tier counts (authoritative):"
"${PSQL[@]}" -q -F' | ' -c "
  SELECT tier, count(*) FROM public.existence_tier_staging GROUP BY tier ORDER BY tier;"

echo "done. (artifacts in $WORKDIR — bounds.txt, batches.sql, run.log)"
echo "next: phase B copy is gated — see header."

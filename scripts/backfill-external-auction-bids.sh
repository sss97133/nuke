#!/usr/bin/env bash
# Backfill external_auction_bids, the cross-platform bid record, through its one writer record_external_auction_bids
# (migration 20261018234500). Every phase is idempotent: a re-run or a resumed slice changes nothing already recorded.
# Phases, in this order (C&B legacy rows last, so a legacy copy of a bid the comments hold is superseded, not keyed):
#   cab-comments  Cars & Bids bid comments, by C&B lot id slice (256 slices)
#   cab-history   Cars & Bids auction_events.bid_history, by lot id slice (256 slices)
#   cab-legacy    legacy external_auction_bids rows with no lot key: keyed to their lot or superseded (16 slices)
#   bat-bids      bat_bids, by heap page range (60 pages, ~1,100 rows a slice)
#   bat-comments  BaT bid comments in auction_comments, by heap page range (150 pages, ~2,000 comments a slice)
# The two BaT phases slice by physical page (TID range scan) because their ids are random UUIDs: an id slice of
# bat_bids read ~1,200 scattered pages for 1,100 rows (9 s cold, 2026-10-17), a 60-page range reads them in order
# (1.4 s cold). Rows a concurrent update moves to another page are caught by a re-run; new bid comments are recorded
# at insert by trg_external_auction_bids_from_comments.
# Each slice is one statement under the server's statement_timeout (10 s for postgres), then a PAUSE (default 2 s) while
# disk IO is contended; db-safety's floor is 0.1 s. Slices run in
# chunks of 32; before each chunk the shared writer gate holds while more than 3 client queries wait on IO, and after it
# lock waits are logged. Output: one line per slice (phase, slice, finished_at, the writer's counts) appended to LOG.
#
# usage: dotenvx run -q -- sh -c 'PGPASSWORD="$SUPABASE_DB_PASSWORD" scripts/backfill-external-auction-bids.sh <phase> [first] [last]'
#   PGHOST/PGPORT/PGUSER/PGDATABASE default to the production pooler; LOG defaults to ./external-auction-bids-backfill.log;
#   PAUSE is the seconds between slices
set -euo pipefail
phase="${1:?usage: $0 <cab-comments|cab-history|cab-legacy|bat-bids|bat-comments> [first-slice] [last-slice]}"
: "${PGHOST:=aws-0-us-west-1.pooler.supabase.com}" "${PGPORT:=6543}" "${PGUSER:=postgres.qkgaybvrernstplzjaam}" "${PGDATABASE:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE
LOG="${LOG:-./external-auction-bids-backfill.log}"
PAUSE="${PAUSE:-2}"
[[ "$PAUSE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "PAUSE must be seconds" >&2; exit 2; }
psql_at() { psql -X -q -At -F $'\t' -v ON_ERROR_STOP=1 "$@"; }

pages=0
case "$phase" in
  cab-comments|cab-history) digits=2 ;;
  cab-legacy) digits=1 ;;
  bat-bids) pages=60; table=bat_bids ;;
  bat-comments) pages=150; table=auction_comments ;;
  *) echo "unknown phase: $phase" >&2; exit 2 ;;
esac
if ((pages > 0)); then
  relpages=$(psql_at -c "SELECT (pg_relation_size('public.$table') / current_setting('block_size')::bigint)")
  slices=$(((relpages + pages - 1) / pages))
else
  slices=$((16 ** digits))
fi
first="${2:-0}"; last="${3:-$((slices - 1))}"

bound() { # id slice index -> lowest uuid of the slice
  local hex; hex=$(printf "%0${digits}x" "$1")
  printf '%s%s-0000-0000-0000-000000000000' "$hex" "$(printf '%0*d' $((8 - digits)) 0)"
}

range_for() { # slice index -> predicate on COL (id slices) or on ctid (page slices)
  local i="$1"
  if ((pages > 0)); then
    if ((i + 1 < slices)); then echo "ctid >= '($((i * pages)),0)' AND ctid < '($(((i + 1) * pages)),0)'"
    else echo "ctid >= '($((i * pages)),0)'"; fi
  elif ((i + 1 < slices)); then echo "COL >= '$(bound "$i")' AND COL < '$(bound $((i + 1)))'"
  else echo "COL >= '$(bound "$i")'"; fi
}

ids_for() { # phase, predicate -> the array expression the writer receives
  local p="$1" range="$2"
  case "$p" in
    cab-comments) echo "ARRAY(SELECT c.id FROM public.auction_events e JOIN public.auction_comments c ON c.auction_event_id = e.id
      WHERE e.source = 'cars_and_bids' AND ${range//COL/e.id} AND c.comment_type = 'bid' AND c.bid_amount > 0)" ;;
    cab-history) echo "ARRAY(SELECT e.id FROM public.auction_events e
      WHERE e.source = 'cars_and_bids' AND ${range//COL/e.id} AND jsonb_typeof(e.bid_history) = 'array')" ;;
    cab-legacy) echo "ARRAY(SELECT b.id FROM public.external_auction_bids b
      WHERE ${range//COL/b.id} AND b.platform = 'cars_and_bids' AND b.auction_event_id IS NULL AND b.superseded_by IS NULL)" ;;
    bat-bids) echo "ARRAY(SELECT bb.id FROM public.bat_bids bb WHERE bb.$range)" ;;
    bat-comments) echo "ARRAY(SELECT c.id FROM public.auction_comments c
      WHERE c.$range AND c.platform = 'bat' AND c.comment_type = 'bid' AND c.bid_amount > 0 AND c.auction_event_id IS NOT NULL)" ;;
  esac
}

source_of() {
  case "$1" in
    cab-comments|bat-comments) echo auction_comments ;;
    cab-history) echo bid_history ;;
    cab-legacy) echo legacy ;;
    bat-bids) echo bat_bids ;;
  esac
}

io_gate() { # the shared writer gate: hold while more than 3 client queries wait on IO
  local waiters
  for (( ; ; )); do
    waiters=$(psql_at -c "SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND state = 'active' AND wait_event_type = 'IO'" || echo unknown)
    [[ "$waiters" =~ ^[0-9]+$ ]] && ((waiters <= 3)) && return
    echo "# $(date -u +%FT%TZ) io-gate: $waiters queries waiting on IO; holding 60 s" | tee -a "$LOG"
    sleep 60
  done
}

echo "# $(date -u +%FT%TZ) $phase slices $first..$last of $slices$( ((pages > 0)) && echo " ($pages pages each)")" | tee -a "$LOG"
for ((chunk = first; chunk <= last; chunk += 32)); do
  io_gate
  {
    echo '\set ON_ERROR_STOP on'
    for ((i = chunk; i <= last && i < chunk + 32; i++)); do
      echo "SELECT '$phase', $i, clock_timestamp(), public.record_external_auction_bids('$(source_of "$phase")', $(ids_for "$phase" "$(range_for "$i")"));"
      echo "SELECT pg_sleep($PAUSE) \\g /dev/null"
    done
    echo "SELECT '$phase', $((i - 1)), clock_timestamp(), json_build_object('lock_waits', count(*)) FROM pg_stat_activity WHERE wait_event_type = 'Lock';"
  } | psql_at -f - | tee -a "$LOG"
done

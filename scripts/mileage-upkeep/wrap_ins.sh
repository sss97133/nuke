#!/usr/bin/env bash
# Mileage upkeep wrapper (run 7e1d0c24-2026-4a10-9e00-0000000a5025, reader in /workspace/odo12):
#   python3 parse.py && python3 mkins.py         -> sql/ins_<n>.sql (new rows only)
#   wrap_ins.sh sql/ins_<n>.sql OUTDIR            -> OUTDIR/odo_test_<n>.sql (rolled back, prints the run's row count)
#                                                    OUTDIR/odo_apply_<n>.sql (commit)
#   run the test, then the apply, with the Supabase SQL runner; then python3 mark.py sql/ins_<n>.sql
#   reconcile: inserted.txt line count and md5 of sorted ids must equal
#     select count(*), md5(string_agg(auction_event_id::text, E'\n' order by auction_event_id::text)||E'\n')
#     from auction_event_listing_mileage where run_id = '7e1d0c24-2026-4a10-9e00-0000000a5025';
set -euo pipefail
f="$1"; out="$2"; n=$(basename "$f" .sql); n=${n#ins_}
mkdir -p "$out"
run="'7e1d0c24-2026-4a10-9e00-0000000a5025'"
h="begin; set local statement_timeout='50s'; set local lock_timeout='5s';"
{ echo "$h"; cat "$f"; echo; echo "select count(*) from public.auction_event_listing_mileage where run_id=$run;"; echo "rollback;"; } > "$out/odo_test_$n.sql"
{ echo "$h"; cat "$f"; echo; echo "commit;"; } > "$out/odo_apply_$n.sql"
echo "$out/odo_test_$n.sql $out/odo_apply_$n.sql"

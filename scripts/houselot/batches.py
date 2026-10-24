#!/usr/bin/env python3
"""Write per-batch SQL for the house-lot matcher (run agg_houselot_v1_20261024 and later runs).
Each batch = event ids whose first hex digit is B. For every batch two files are written:
  test_<step>_<B>.sql  begin; ...; check; rollback;   (run first; the attach guard must accept every row)
  <step>_<B>.sql       begin; ...; commit; check;
Run with the Supabase SQL runner one file at a time; statement_timeout 50s, lock_timeout 5s.
  python3 batches.py apply_agg_houselot.sql RUN_ID OUTDIR
RUN_ID replaces agg_houselot_v1_20261024 in the template (so a re-run gets its own backup table and revert)."""
import sys, os
tmpl, run, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
s = open(tmpl).read().rstrip().rstrip(';').replace('agg_houselot_v1_20261024', run)
# candidate tables keep the v1 names (they are inputs, not run state)
s = s.replace(run + '_cand', 'agg_houselot_v1_20261024_cand')
h = "begin; set local statement_timeout='50s'; set local lock_timeout='5s';\n"
for b in '0123456789abcdef':
    body = s.replace(":'batch'", f"'{b}'")
    chk = (f"select count(*) n, count(*) filter (where from_vehicle_id<>to_vehicle_id) moved, "
           f"count(*) filter (where from_marked) marked, (select count(*) from public.vehicle_events e join public.backup_{run} k on k.event_id=e.id "
           f"where e.vehicle_id=k.to_vehicle_id and public.aggregator_event_attach_basis(e.id,e.vehicle_id,e.source_url,e.source_platform,e.metadata) "
           f"in ('same_lot','vin_match') and left(e.id::text,1)='{b}') guard_ok from public.backup_{run} where left(event_id::text,1)='{b}'")
    open(f'{out}/test_apply_{b}.sql', 'w').write(h + body + ";\n" + chk + ";\nrollback;\n")
    open(f'{out}/apply_{b}.sql', 'w').write(h + body + ";\ncommit;\n" + chk + ";\n")

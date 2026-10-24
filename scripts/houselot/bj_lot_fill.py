#!/usr/bin/env python3
"""Run bj_lot_fill_v1_20261024: fill vehicle_events.lot_number for Barrett-Jackson house events from docket pages already read
by run bj_charity_read_v1_20261023 (/workspace/bjall/out.jsonl: one JSON line per page; id = vehicle_events.id, u = page URL,
lot = lot number parsed from the page, http = status, at = read time). No page is fetched here.
Only rows with http 200 and a lot shaped like 509 or 510.1 are used. A row is filled only when lot_number is null and the
event's source_url is the page that was read (www. and scheme ignored), and each lot cites its page in lot_number_source_url.
Writes OUTDIR/test_fill_<n>.sql (rolled back) and OUTDIR/fill_<n>.sql.  Revert: revert_bj_lot_fill_v1_20261024.sql
  python3 bj_lot_fill.py /workspace/bjall/out.jsonl OUTDIR [rows_per_batch]"""
import sys, os, json, re
src, out = sys.argv[1], sys.argv[2]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 3000
RUN = 'bj_lot_fill_v1_20261024'
os.makedirs(out, exist_ok=True)
rows = {}
for l in open(src):
    try: o = json.loads(l)
    except ValueError: continue
    lot = str(o.get('lot') or '')
    if o.get('http') == '200' and re.fullmatch(r'[0-9]{1,5}(\.[0-9]{1,2})?', lot) and re.fullmatch(r'[0-9a-f-]{36}', o.get('id', '')):
        rows[o['id']] = (lot, o['u'], o['at'])
q = lambda x: "'" + x.replace("'", "''") + "'"
ids = sorted(rows)
h = "begin; set local statement_timeout='50s'; set local lock_timeout='5s';\n"
for n in range(0, len(ids), per):
    vals = ',\n'.join(f"({q(i)}::uuid,{q(rows[i][0])},{q(rows[i][1])},{q(rows[i][2])}::timestamp)" for i in ids[n:n + per])
    body = (f"with r(id, lot, url, at) as (values\n{vals})\n"
            f"update public.vehicle_events e set lot_number = r.lot, lot_number_source_url = r.url, lot_number_run_id = '{RUN}',\n"
            f"  lot_number_read_at = r.at at time zone 'America/Los_Angeles'\n"
            f"from r where e.id = r.id and e.lot_number is null\n"
            f"  and regexp_replace(lower(e.source_url), '^https?://(www\\.)?', '') = regexp_replace(lower(r.url), '^https?://(www\\.)?', '')")
    chk = f"select count(*) filled from public.vehicle_events where lot_number_run_id = '{RUN}'"
    k = n // per
    open(f'{out}/test_fill_{k:02d}.sql', 'w').write(h + body + ";\n" + chk + ";\nrollback;\n")
    open(f'{out}/fill_{k:02d}.sql', 'w').write(h + body + ";\ncommit;\n" + chk + ";\n")
print(len(ids), 'pages with a lot ->', (len(ids) + per - 1) // per, 'batches')

#!/usr/bin/env python3
"""inclusion-pass: the join discovery engine.

For each island table (non-empty, no foreign key in or out, per v_schema_atlas) it samples the
values of every candidate key column and tests them for inclusion in the key columns of the
entity tables. A match rate near 1.0 means the column is a foreign key nobody declared.

  uuid columns   -> the id of the most-referenced entity tables (vehicles, organizations, ...)
  text key-ish   -> vehicles.vin, external_identities.handle, observation_sources.slug
                    (columns named like vin / username / handle / slug / author / seller / buyer / bidder)

Read-only. Samples are at most 1500 distinct values from a block sample, so rates are estimates:
confirm a candidate on the full table (distinct values anti-join) before declaring a key.
Candidates go to --json for registration as veins; nothing here writes to the database.

  python3 scripts/discovery/inclusion-pass.py --islands 40 --json out.json
  python3 scripts/discovery/inclusion-pass.py --tables analysis_events,vehicle_grades
"""
import argparse, json, os, re, subprocess, sys

QSH = os.environ.get("QSH", os.path.expanduser("~/nuke/scripts/data/q.sh"))
SAMPLE = 1500
MIN_VALUES = 30
MIN_RATE = 0.3
TEXT_KEY = re.compile(r"(^|_)(vin|username|user_name|handle|slug|author|seller|buyer|bidder)(_|$)", re.I)
NEVER = re.compile(r"(email|phone|address|password|token|secret|ssn)", re.I)  # private data stays out

def q(sql):
    try:
        out = subprocess.run([QSH, sql], capture_output=True, text=True, timeout=90).stdout
        d = json.loads(out)
        return None if isinstance(d, dict) else d
    except Exception:
        return None

def lit(vals):
    return "array[" + ",".join("'" + v.replace("'", "''") + "'" for v in vals) + "]"

def targets():
    top = q("select table_name from v_schema_atlas where fk_in>=8 and table_name !~ '^(zz_|_)' order by fk_in desc limit 12") or []
    uu = []
    for r in top:
        t = r["table_name"]
        pk = q(f"select 1 x from information_schema.columns where table_schema='public' and table_name='{t}' and column_name='id' and data_type='uuid'")
        if pk: uu.append((t, "id"))
    return uu, [("vehicles", "vin", "upper"), ("external_identities", "handle", "lower"), ("observation_sources", "slug", "lower")]

def run(tables, as_json):
    uu_targets, tx_targets = targets()
    found = []
    for t in tables:
        est = (q(f"select est_rows from v_schema_atlas where table_name='{t}'") or [{"est_rows": 0}])[0]["est_rows"]
        pct = min(100, max(0.001, SAMPLE * 2.0 / max(est, 1) * 100))
        cols = q(f"select column_name, data_type from information_schema.columns where table_schema='public' and table_name='{t}'") or []
        for c in cols:
            cn, dt = c["column_name"], c["data_type"]
            if cn == "id" or NEVER.search(cn): continue
            is_uuid = dt == "uuid"
            is_text = dt in ("text", "character varying") and TEXT_KEY.search(cn)
            if not (is_uuid or is_text): continue
            s = q(f"select distinct {cn}::text v from {t} tablesample system({pct:.4f}) where {cn} is not null limit {SAMPLE}")
            vals = [r["v"] for r in (s or []) if r["v"]]
            if len(vals) < MIN_VALUES: continue
            if is_uuid:
                for tt, tc in uu_targets:
                    m = q(f"select count(*) n from {tt} where {tc}=any({lit(vals)}::uuid[])")
                    if m is not None and m[0]["n"] / len(vals) >= MIN_RATE:
                        found.append(dict(table=t, column=cn, kind="uuid", target=f"{tt}.{tc}", sample=len(vals), matched=m[0]["n"]))
            else:
                for tt, tc, fn in tx_targets:
                    v2 = [getattr(v, fn)() for v in vals]
                    m = q(f"select count(distinct {fn}({tc})) n from {tt} where {fn}({tc})=any({lit(v2)})")
                    if m is not None and m[0]["n"] / len(set(v2)) >= MIN_RATE:
                        found.append(dict(table=t, column=cn, kind="text", target=f"{tt}.{tc}", sample=len(set(v2)), matched=m[0]["n"]))
    for f in found: f["rate"] = round(f["matched"] / f["sample"], 3)
    found.sort(key=lambda f: -f["rate"])
    if as_json: json.dump(found, open(as_json, "w"), indent=1)
    for f in found: print(f)
    print("done", len(found), "candidate edges over", len(tables), "tables")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables"); ap.add_argument("--islands", type=int); ap.add_argument("--json")
    a = ap.parse_args()
    if a.tables: tabs = a.tables.split(",")
    else:
        rows = q(f"select table_name from v_schema_atlas where est_rows>=1000 and fk_in=0 and fk_out=0 order by est_rows desc limit {a.islands or 40}") or []
        tabs = [r["table_name"] for r in rows]
    if not tabs: sys.exit("no tables")
    run(tabs, a.json)

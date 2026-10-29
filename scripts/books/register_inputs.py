#!/usr/bin/env python3
"""Register inputs: land the asset register (cost, in-service year, class, the decisions that claim each year's depreciation),
the business-use groups (decisions, base, percentage) and the credit inputs (residency days, credits, payments, tax) of each
tax year in the books DB, so books_year_gate rules R6, R7 and R8b recompute from stored inputs instead of hand numbers.

Same writer as return_facts.py: public.ingest_financial_evidence (financial_evidence_v1), one register original per owner,
every landing a complete revision that supersedes the current one. Cells: asset:<id>, use:<year>:<key>, credit:<year>.
Every value carries its cite (the cell's "cites"). Amounts and names live in the local inputs file and in the database,
never in this repo.

  dotenvx run -- python3 scripts/books/register_inputs.py land --inputs register-inputs.json [--dry]

inputs file: {"owner_id", "assets": [{"id","name","cost","placed_in_service","cls","business_pct","claims":{"<year>":[decision ids]},"cites"}],
              "uses": [{"year","key","desc","decisions":[ids],"base","pct","cites"}],
              "credits": [{"year","owner_us_days","children","eic","ctc_nonref","actc","ctc_per_child","actc_cap_per_child",
                           "earned_income"?,"payments_other"?,"total_tax"?,"gilti_*"?,"cites"}]}
  cls: 7yr_hy | 15yr_sl_hy | sec179 (the tables are public.books_macrs_pct)
"""
import argparse, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok, upload, current_run, clip  # noqa: E402

METHOD, VERSION = 'books_register_inputs', '2026-10-27'
CLASSES = {'7yr_hy', '15yr_sl_hy', 'sec179'}


def register_original(owner):
    body = b'Books register inputs. The asset register, business-use groups and credit inputs are revisions of this original in financial_evidence_v1.\n'
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename='books-register-inputs.txt',
                      source_kind='upload', byte_size=str(len(body)))


def cell(key, raw, value, cites):
    if not isinstance(cites, dict) or not cites or not all(isinstance(v, str) and v.strip() for v in cites.values()):
        raise SystemExit(f'{key}: every value needs a cite')
    missing = [k for k, v in value.items() if v is not None and k not in cites and k.split('_')[0] not in cites and k not in META]
    if missing:
        raise SystemExit(f'{key}: no cite for {missing}')
    value = dict(value, cites=cites)
    if len(json.dumps(value, ensure_ascii=False).encode()) > 3800:
        raise SystemExit(f'{key}: cell too large')
    return dict(field_key=key, value_raw=clip(raw, 500), value_type='text', value_normalized=value,
                evidence=dict(source=clip('; '.join(f'{k}: {v}' for k, v in cites.items()), 1800), method=METHOD))


META = {'id', 'name', 'desc', 'key', 'year', 'claims', 'decisions', 'caveats', 'cost_parts', 'business_use_cite', 'business_pct', 'children', 'ctc_per_child', 'actc_cap_per_child'}


def build_revision(spec):
    fields, seen = [], set()
    for a in spec['assets']:
        if a['cls'] not in CLASSES or not a.get('claims'):
            raise SystemExit(f"asset {a['id']}: bad class or no claims")
        a = dict(a)
        cites = a.pop('cites')
        if float(a.get('business_pct', 1)) != 1 and 'business_use_cite' not in a:
            raise SystemExit(f"asset {a['id']}: a business percentage under 100% needs its cite")
        fields.append(cell(f"asset:{a['id']}", f"asset {a['id']}", a, cites))
    for u in spec['uses']:
        u = dict(u)
        cites = u.pop('cites')
        if not 0 <= float(u['pct']) <= 1 or not u['decisions']:
            raise SystemExit(f"use {u['year']}:{u['key']}: bad percentage or no decisions")
        fields.append(cell(f"use:{u['year']}:{u['key']}", f"business use {u['year']} {u['key']}", u, cites))
    for c in spec['credits']:
        c = dict(c)
        cites = c.pop('cites')
        fields.append(cell(f"credit:{c['year']}", f"credit inputs {c['year']}", c, cites))
    keys = [f['field_key'] for f in fields]
    if len(keys) != len(set(keys)):
        raise SystemExit('duplicate cell')
    digest = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()[:12]
    return dict(idempotency_key=f'register-inputs-{digest}', method=METHOD, version=VERSION, fields=fields)


def land(path, dry):
    spec = json.load(open(path))
    owner = uuid_ok(spec['owner_id'])
    body, original = register_original(owner)
    rev = build_revision(spec)
    cur = current_run(owner, original['sha256'])
    if cur and cur['key'] == rev['idempotency_key']:
        print(json.dumps(dict(unchanged=True, run_id=cur['run_id'])))
        return
    if cur:
        rev['supersedes_run_id'] = cur['run_id']
        have = {f['field_key'] for f in rev['fields']}
        for k in cur['field_keys'] or []:
            if k not in have:
                rev['fields'].append(dict(field_key=k, value_raw='retired by a later revision', value_type='text',
                                          value_normalized=dict(retired=True), evidence=dict(stage='register_inputs', retired=True)))
    st = 'dry' if dry else upload(body, original['storage_path'])
    sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
           "select set_config('request.jwt.claim.role','service_role',true);\n"
           f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(original))}::jsonb, "
           f"{q(json.dumps(rev, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
           f"{'rollback' if dry else 'commit'};\n")
    out = [l for l in psql(sql).splitlines() if l.strip()]
    rec = json.loads(next(l for l in out if l.startswith('{') and 'extraction_run_id' in l))
    print(json.dumps(dict(dry=dry, upload=st, document_id=rec.get('document_id'), run_id=rec.get('extraction_run_id'),
                          supersedes=rev.get('supersedes_run_id'), cells=len(rev['fields']))))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('land')
    p.add_argument('--inputs', required=True)
    p.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    land(a.inputs, a.dry)

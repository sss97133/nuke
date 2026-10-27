#!/usr/bin/env python3
"""Vehicle facts: land the purchase and sale a books decision records about a vehicle, as cells the linker carries onto the
vehicle's profile (public.link_books_to_vehicles, cron link-books-to-vehicles, every 30 minutes).

Same writer as register_inputs.py: public.ingest_financial_evidence (financial_evidence_v1), one vehicle-facts original per
owner, every landing a complete revision that supersedes the current one. Cell: vehicle_fact_<first 24 of source_key>_<kind>.
A fact names the current books decision it rests on (source_key), the vehicle (vehicle_id, or an exact vin), the kind
(purchase | sale), and the fields it states: price, date, location (purchase), counterparty (purchase: who sold it to the owner).
It fills an empty field on the profile; it replaces a stored value only with "overwrite": true, and the writer then keeps the
old value in the vehicle's provenance_metadata. Every fact carries cites (what proves each field); amounts and names live in
the local inputs file and the database, never in this repo.

  dotenvx run -- python3 scripts/books/vehicle_facts.py land --inputs vehicle-facts.json [--dry]

inputs file: {"owner_id", "facts": [{"source_key","kind","vehicle_id"|"vin","price"?,"date"?,"location"?,"counterparty"?,
              "overwrite"?,"reason"?,"cites":{"<field>":"<cite>"}}]}

Going forward, a landing script that writes a decision citing a vehicle (the make_*.py pattern) also writes the fact here, so
the vehicle link does not depend on prose.
"""
import argparse, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok, upload, current_run, clip  # noqa: E402

METHOD, VERSION = 'books_vehicle_facts', '2026-10-27'
KINDS = {'purchase', 'sale'}


def facts_original(owner):
    body = b'Books vehicle facts. Purchases and sales that books decisions record about vehicles are revisions of this original in financial_evidence_v1.\n'
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename='books-vehicle-facts.txt',
                      source_kind='upload', byte_size=str(len(body)))


def cell(f):
    f = dict(f)
    cites = f.pop('cites', None)
    if not isinstance(cites, dict) or not cites or not all(isinstance(v, str) and v.strip() for v in cites.values()):
        raise SystemExit(f"{f.get('source_key')}: every fact needs cites")
    if f.get('kind') not in KINDS or not re.fullmatch(r'[0-9a-f]{64}', f.get('source_key', '')):
        raise SystemExit(f"bad kind or source_key: {f.get('kind')} {f.get('source_key')}")
    if bool(f.get('vehicle_id')) == bool(f.get('vin')):
        raise SystemExit(f"{f['source_key'][:12]}: give exactly one of vehicle_id or vin")
    if f.get('vehicle_id'):
        uuid_ok(f['vehicle_id'])
    stated = [k for k in ('price', 'date', 'location', 'counterparty') if f.get(k) is not None]
    if not stated:
        raise SystemExit(f"{f['source_key'][:12]}: a fact states at least one field")
    missing = [k for k in stated if k not in cites]
    if missing:
        raise SystemExit(f"{f['source_key'][:12]}: no cite for {missing}")
    if f['kind'] == 'sale' and (f.get('location') is not None or f.get('counterparty') is not None):
        raise SystemExit('a sale states price and date only')
    key = f"vehicle_fact_{f['source_key'][:24]}_{f['kind']}"
    value = dict(f, cites=cites)
    if len(json.dumps(value, ensure_ascii=False).encode()) > 3800:
        raise SystemExit(f'{key}: cell too large')
    return dict(field_key=key, value_raw=clip(f"{f['kind']} fact", 500), value_type='text', value_normalized=value,
                evidence=dict(source=clip('; '.join(f'{k}: {v}' for k, v in cites.items()), 1800), method=METHOD))


def build_revision(spec):
    fields = [cell(f) for f in spec['facts']]
    keys = [f['field_key'] for f in fields]
    if len(keys) != len(set(keys)):
        raise SystemExit('duplicate fact')
    digest = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()[:12]
    return dict(idempotency_key=f'vehicle-facts-{digest}', method=METHOD, version=VERSION, fields=fields)


def land(path, dry):
    spec = json.load(open(path))
    owner = uuid_ok(spec['owner_id'])
    body, original = facts_original(owner)
    rev = build_revision(spec)
    cur = current_run(owner, original['sha256'])
    if cur and cur['key'] == rev['idempotency_key']:
        print(json.dumps(dict(unchanged=True, run_id=cur['run_id'])))
        return
    if cur:
        rev['supersedes_run_id'] = cur['run_id']
        have = {f['field_key'] for f in rev['fields']}
        for k in cur['field_keys'] or []:
            if k not in have:   # a revision is complete: carry every earlier fact forward unless this landing restates it
                raise SystemExit(f'revision would drop {k}: include earlier facts in the inputs file, or retire one explicitly')
    st = 'dry' if dry else upload(body, original['storage_path'])
    sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
           "select set_config('request.jwt.claim.role','service_role',true);\n"
           f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(original))}::jsonb, "
           f"{q(json.dumps(rev, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
           f"{'rollback' if dry else 'commit'};\n")
    out = [l for l in psql(sql).splitlines() if l.strip()]
    rec = json.loads(next(l for l in out if l.startswith('{') and 'extraction_run_id' in l))
    print(json.dumps(dict(dry=dry, upload=st, document_id=rec.get('document_id'), run_id=rec.get('extraction_run_id'),
                          supersedes=rev.get('supersedes_run_id'), facts=len(rev['fields']))))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('land')
    p.add_argument('--inputs', required=True)
    p.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    land(a.inputs, a.dry)

#!/usr/bin/env python3
"""Return facts register: land the settled return-level facts of each tax year (filing status, residency and credits, CFC/GILTI
and Form 5471 status, standing owner rulings, the current return result, open items and what closes each) in the books DB.

The writer is the canonical one, public.ingest_financial_evidence (financial_evidence_v1). One register original per owner (a
small fixed text file); every landing is a complete revision of it and supersedes the current one, so the set of current cells
is always the whole settled state. Facts are cells, not accounting records: they never enter a Schedule C total.
public.books_year_state(owner, year) reads them back with the Schedule C lines, the rulings and the latest return draft.

Amounts, names and evidence live in a local facts file and in the database, never in this repo.

  dotenvx run -- python3 scripts/books/return_facts.py land --facts return-facts.json --line-map line-map.json [--dry]

facts file: {"owner_id", "facts": [{"year", "key", "topic", "status", "decision", "source", "date",
                                     "amount"?, "closes_with"?, "supersedes"?}]}
  topic: filing_status | residency | credits | cfc | gilti | form_5471 | owner_ruling | result | penalty | other
  status: settled | open | superseded
  result facts also carry "result": {"form", "result": "refund"|"owe", "amount", "built_at", "amount_source"}
line map: {"<section>|<category>": "<line>"} for legacy ledger categories, stored as the schedule_c_line_map cell.
"""
import argparse, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok, upload, current_run, clip  # noqa: E402

METHOD, VERSION = 'return_facts_register', '2026-10-26'
TOPICS = {'filing_status', 'residency', 'credits', 'cfc', 'gilti', 'form_5471', 'owner_ruling', 'result', 'penalty', 'other'}
STATUSES = {'settled', 'open', 'superseded'}


def register_original(owner):
    body = b'Return facts register. Each tax year\'s settled return-level facts are revisions of this original in financial_evidence_v1.\n'
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename='return-facts-register.txt',
                      source_kind='upload', byte_size=str(len(body)))


def build_revision(spec, line_map):
    fields, seen = [], set()
    for f in spec['facts']:
        year, key = int(f['year']), f['key']
        if (year, key) in seen:
            raise SystemExit(f'duplicate fact {year}:{key}')
        seen.add((year, key))
        if f['topic'] not in TOPICS or f['status'] not in STATUSES:
            raise SystemExit(f'{year}:{key}: bad topic or status')
        if f['status'] == 'open' and not f.get('closes_with'):
            raise SystemExit(f'{year}:{key}: an open item must say what closes it')
        if f['topic'] == 'result' and not {'form', 'result', 'amount', 'built_at', 'amount_source'} <= set(f.get('result') or {}):
            raise SystemExit(f'{year}:{key}: a result fact needs form, result, amount, built_at, amount_source')
        value = {k: v for k, v in dict(
            local_id=f'{year}-FACT-{key}', year=year, key=key, topic=f['topic'], status=f['status'], date=f['date'],
            decision=clip(f['decision'], 1500), amount=f.get('amount'), closes_with=clip(f['closes_with'], 400) if f.get('closes_with') else None,
            supersedes=f.get('supersedes'), result=f.get('result')).items() if v is not None}
        fields.append(dict(field_key=f'fact:{year}:{key}', value_raw=clip(f['decision'], 2000), value_type='text', value_normalized=value,
                           evidence=dict(source=clip(f['source'], 1800), method=METHOD)))
    lm = json.dumps(line_map, ensure_ascii=False)
    fields.append(dict(field_key='schedule_c_line_map', value_raw=f'{len(line_map)} legacy ledger categories mapped to Schedule C lines',
                       value_type='text', value_normalized=line_map,
                       evidence=dict(source='db-books/line-map.json (the map drift_check.py and schedule_c_rulings.py use)', method=METHOD)))
    if len(lm.encode()) > 3800:
        raise SystemExit('line map too large for one cell')
    digest = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()[:12]
    return dict(idempotency_key=f'return-facts-{digest}', method=METHOD, version=VERSION, fields=fields)


def land(facts_path, line_map_path, dry):
    spec = json.load(open(facts_path))
    owner = uuid_ok(spec['owner_id'])
    body, original = register_original(owner)
    rev = build_revision(spec, json.load(open(line_map_path)))
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
                                          value_normalized=dict(retired=True), evidence=dict(stage='return_facts', retired=True)))
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
    p.add_argument('--facts', required=True)
    p.add_argument('--line-map', required=True)
    p.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    land(a.facts, a.line_map, a.dry)

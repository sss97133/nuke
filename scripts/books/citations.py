#!/usr/bin/env python3
"""Citations register: land explicit citations for Schedule C decisions, on two axes, through ingest_financial_evidence.

Owner rule (2026-10-26): no default stands as a judgment. A decision is cited only with a payment proof and a purpose
proof; public.books_year_citations reads these cells first and derives the rest, and books_year_gate R10 fails a year
while any decision is still searching.

  payment_proof  bank_card_line | cash_withdrawal | cash_receipt | none
  purpose_proof  third_party_document | message | photo | vehicle_record | owner_testimony | inverse_search | none
  citations      [{"type": "positive"|"inverse", "axis": "payment"|"purpose", "ref": "<document/statement/message/photo id>",
                   "searched_sources": [...] (inverse only), "query": "...", "date": "YYYY-MM-DD", "result": "..."}]

One register original per owner; each landing merges the given citations into the current cells (a later citation for the
same decision replaces it) and writes the complete set as a superseding revision.

  dotenvx run -- python3 scripts/books/citations.py land --citations citations.json [--dry]

citations file: {"owner_id", "decisions": {"<local_id>": {"payment_proof", "purpose_proof", "citations": [...]}}}
"""
import argparse, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok, upload, clip  # noqa: E402

METHOD, VERSION = 'citations_register', '2026-10-26'
PAYMENT = {'bank_card_line', 'cash_withdrawal', 'cash_receipt', 'none'}
PURPOSE = {'third_party_document', 'message', 'photo', 'vehicle_record', 'owner_testimony', 'inverse_search', 'none'}


def register_original(owner):
    body = b'Citations register. Payment and purpose citations for ledger decisions are revisions of this original in financial_evidence_v1.\n'
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename='citations-register.txt',
                      source_kind='upload', byte_size=str(len(body)))


def check(lid, c):
    if c.get('payment_proof') not in PAYMENT or c.get('purpose_proof') not in PURPOSE:
        raise SystemExit(f'{lid}: payment_proof or purpose_proof outside the closed lists')
    cites = c.get('citations') or []
    if (c['payment_proof'] != 'none' or c['purpose_proof'] != 'none') and not cites:
        raise SystemExit(f'{lid}: a proof needs at least one citation')
    for x in cites:
        if x.get('type') not in ('positive', 'inverse') or not x.get('ref') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', x.get('date', '')):
            raise SystemExit(f'{lid}: each citation needs type positive|inverse, ref and date')
        if x['type'] == 'inverse' and not x.get('searched_sources'):
            raise SystemExit(f'{lid}: an inverse citation names the sources searched')
    if c['purpose_proof'] == 'inverse_search' and not any(x['type'] == 'inverse' for x in cites):
        raise SystemExit(f'{lid}: inverse_search needs an inverse citation')


def current(owner, sha):
    out = psql(f"""select coalesce(json_agg(json_build_object('run_id', e.extraction_run_id, 'key', e.field_key, 'v', e.value_normalized->'value',
                       'ev', e.value_normalized->'evidence')), '[]')
      from financial_documents d join financial_document_extractions e on e.document_id = d.id and not e.is_superseded
     where d.owner_id = '{owner}' and d.content_sha256 = '{sha}' and d.logical_index = 1;""")
    return json.loads(next(l for l in out.splitlines() if l.startswith('[')))


def land(path, dry):
    spec = json.load(open(path))
    owner = uuid_ok(spec['owner_id'])
    body, original = register_original(owner)
    cur = current(owner, original['sha256'])
    cells = {c['key']: dict(field_key=c['key'], value_raw=clip(json.dumps(c['v'])[:1900], 2000), value_type='text', value_normalized=c['v'],
                            evidence=c['ev'] or dict(method=METHOD)) for c in cur}
    for lid, c in spec['decisions'].items():
        check(lid, c)
        v = dict(local_id=lid, payment_proof=c['payment_proof'], purpose_proof=c['purpose_proof'], citations=c.get('citations') or [])
        if len(json.dumps(v).encode()) > 3800:
            raise SystemExit(f'{lid}: citations too large for one cell')
        cells[f'citation:{lid}'] = dict(field_key=f'citation:{lid}', value_raw=f"{c['payment_proof']} / {c['purpose_proof']}", value_type='text',
                                        value_normalized=v, evidence=dict(method=METHOD, cited=len(v['citations'])))
    fields = sorted(cells.values(), key=lambda f: f['field_key'])
    digest = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()[:12]
    rev = dict(idempotency_key=f'citations-{digest}', method=METHOD, version=VERSION, fields=fields)
    if cur:
        rev['supersedes_run_id'] = cur[0]['run_id']
    st = 'dry' if dry else upload(body, original['storage_path'])
    sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
           "select set_config('request.jwt.claim.role','service_role',true);\n"
           f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(original))}::jsonb, "
           f"{q(json.dumps(rev, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
           f"{'rollback' if dry else 'commit'};\n")
    out = [l for l in psql(sql).splitlines() if l.strip()]
    rec = json.loads(next(l for l in out if l.startswith('{') and 'extraction_run_id' in l))
    print(json.dumps(dict(dry=dry, upload=st, document_id=rec.get('document_id'), run_id=rec.get('extraction_run_id'), cells=len(fields))))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('land')
    p.add_argument('--citations', required=True)
    p.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    land(a.citations, a.dry)

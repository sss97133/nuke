#!/usr/bin/env python3
"""Intuit QuickBooks GL links: land each GL expense transaction as a retained_bank_movement that cites its source row and names the
Schedule C ruling decision it rolls up into (bank_links), so books_year_gate rule R5 (accounting_decision_proof.has_statement) can see
the evidence behind aggregate ruling records.

Writer: public.ingest_financial_evidence (financial_evidence_v1), through the helpers in schedule_c_rulings.py. Never raw SQL on the
testimony tables. A revision holds at most 100 accounting records, so the rows are cut into extract files of <= 90 rows; each extract
is its own original (a JSON copy of those GL rows, private, in the user-documents bucket) and each record cites the full GL file by
name and row number. Amounts, memos and plans stay local and in the database, never in this repo.

  dotenvx run -- python3 scripts/books/intuit_gl_links.py land  --plan plan-2022.json [--dry]
  dotenvx run -- python3 scripts/books/intuit_gl_links.py link  --links links-2023.json [--dry]
  dotenvx run -- python3 scripts/books/intuit_gl_links.py prove --owner <uuid> --year 2022 [--prefix 2022-RULING-]

plan file: {"owner_id", "year", "source_label", "source_file", "source_sha256", "extract_prefix",
            "rows": [{"ref", "date", "account", "amount", "description", "memo_full", "category", "section", "decision", "source_ref", "detail"}]}
  amount is the money movement (negative = out). decision is the 'YYYY-RULING-*' local_id the row rolls up into.
links file: {"owner_id", "links": {"<document_id>": {"<movement local_id>": ["<decision local_id>", ...]}}}
  adds bank_links to movements that are already in the books, as a superseding revision of their document.
"""
import argparse, collections, hashlib, json, re, sys
from decimal import Decimal as D
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schedule_c_rulings as sc

METHOD, VERSION = 'intuit_gl_links', '2026-10-26'
CHUNK = 90
IBANISH = re.compile(r'[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}')


def clean(s):
    """The writer refuses strings that look like IBANs; mask them in record text (the extract file keeps the original)."""
    return IBANISH.sub('[masked]', s or '')


def extract_original(owner, year, prefix, n, rows, plan):
    body = (json.dumps(dict(source_label=plan['source_label'], source_file=plan['source_file'], source_file_sha256=plan['source_sha256'],
                            year=year, extract=n, rows=[dict(ref=r['ref'], date=r['date'], account=r['account'], amount=r['amount'],
                                                             memo=r['memo_full'], detail=r.get('detail', '')) for r in rows]),
                       indent=1, ensure_ascii=False, sort_keys=True) + '\n').encode()
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.json', source_filename=f'{prefix}-{year}-extract-{n:02d}.json',
                      source_kind='upload', byte_size=str(len(body)))


def build_revision(plan, rows, original):
    year, sha = plan['year'], original['sha256']
    records = []
    for i, r in enumerate(rows, 1):
        amt = D(str(r['amount'])).quantize(D('0.01'))
        ref = f"{plan['source_label']} | {plan['source_file']} row {r['ref']} | extract {original['source_filename']} item {i}"
        records.append(dict(
            record_kind='retained_bank_movement', source_key=hashlib.sha256(f"{sha}:{year}:{r['ref']}".encode()).hexdigest(),
            source_sha256=sha, source_row=str(i), local_id=f"intuit:{year}:r{r['ref']}", year=year, date=r['date'], account=r['account'],
            currency='USD', currency_basis='USD as recorded in the QuickBooks bank feed', amount=f'{amt}',
            section=r['section'], category=clean(r['category'])[:300], description=clean(r['description'])[:500],
            decision=clean(f"{plan['source_label']} line, cash basis. Rolls up into {r['decision']} ({r.get('detail', '')}).")[:1900],
            status=f"Linked: part of {r['decision']}", source_reference=clean(ref)[:900], bank_links=[r['decision']],
            recognition_status='not_applicable', payment_status='unresolved', vehicle_status='unresolved',
            reimbursement_status='unresolved', entity_status='retained_scope_unallocated'))
    total = sum((D(x['amount']) for x in records), D(0))
    fields = [dict(field_key='register', value_raw=f"{plan['source_label']} {year}: {len(records)} lines from {plan['source_file']}"[:500], value_type='text',
                   value_normalized=dict(year=year, records=len(records), net=f'{total:.2f}'),
                   evidence=dict(stage='intuit_gl_extract', method=METHOD, source_file_sha256=plan['source_sha256']))]
    digest = hashlib.sha256(json.dumps([fields, records], sort_keys=True).encode()).hexdigest()[:12]
    return dict(idempotency_key=f'intuit-gl-{year}-{digest}', method=METHOD, version=VERSION, fields=fields, accounting_records=records)


def ingest(owner, original, rev, dry):
    sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
           "select set_config('request.jwt.claim.role','service_role',true);\n"
           f"select public.ingest_financial_evidence('{owner}'::uuid, {sc.q(json.dumps(original))}::jsonb, "
           f"{sc.q(json.dumps(rev, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
           f"{'rollback' if dry else 'commit'};\n")
    out = [l for l in sc.psql(sql).splitlines() if l.startswith('{') and 'extraction_run_id' in l]
    return json.loads(out[-1])


def land(path, dry):
    plan = json.load(open(path))
    owner, year = sc.uuid_ok(plan['owner_id']), plan['year']
    rows = plan['rows']
    refs = [r['ref'] for r in rows]
    if len(refs) != len(set(refs)):
        raise SystemExit('rows need unique refs')
    done = 0
    for n, start in enumerate(range(0, len(rows), CHUNK), 1):
        part = rows[start:start + CHUNK]
        body, original = extract_original(owner, year, plan['extract_prefix'], n, part, plan)
        rev = build_revision(plan, part, original)
        cur = sc.current_run(owner, original['sha256'])
        if cur and cur['key'] == rev['idempotency_key']:
            print(json.dumps(dict(extract=n, unchanged=True, records=len(part))))
            done += len(part)
            continue
        if cur:
            raise SystemExit(f'extract {n} already landed with different content; change the plan, not the history')
        st = 'dry' if dry else sc.upload(body, original['storage_path'])
        rec = ingest(owner, original, rev, dry)
        print(json.dumps(dict(extract=n, dry=dry, upload=st, document_id=rec.get('document_id'), run_id=rec.get('extraction_run_id'), records=len(part))))
        done += len(part)
    print(json.dumps(dict(year=year, rows=len(rows), processed=done)))


def link(path, dry):
    """Add bank_links to movements already in the books: a superseding revision of their document, one per document."""
    spec = json.load(open(path))
    owner = sc.uuid_ok(spec['owner_id'])
    for doc_id, moves in sorted(spec['links'].items()):
        st = sc.document_state(owner, doc_id)
        recs, seen = st['records'] or [], set()
        for r in recs:
            want = moves.get(r['local_id'])
            if want is None:
                continue
            if r['record_kind'] != 'retained_bank_movement':
                raise SystemExit(f"{r['local_id']} is not a bank movement")
            seen.add(r['local_id'])
            r['bank_links'] = sorted(set(r.get('bank_links') or []) | set(want))
            if D(r['amount']) < 0 and r['section'] not in ('Expense', 'Owner', 'Transfer', 'Financing', 'Clearing', 'Reference'):
                pass
            note = f"Linked {VERSION} to {', '.join(want)}"
            r['decision'] = sc.clip(f"{r.get('decision') or ''} | {note}".lstrip(' |'), 1990)
        missing = set(moves) - seen
        if missing:
            raise SystemExit(f'{doc_id}: movements not in the current revision: {sorted(missing)[:5]}')
        rev = dict(method=METHOD, version=VERSION, fields=st['fields'], accounting_records=recs, supersedes_run_id=st['run_id'])
        if st['lines']:
            rev['lines'] = st['lines']
        rev['idempotency_key'] = 'intuit-link-' + hashlib.sha256(json.dumps(rev, sort_keys=True).encode()).hexdigest()[:24]
        rec = ingest(owner, st['original'], rev, dry)
        print(json.dumps(dict(document_id=doc_id, dry=dry, linked=len(seen), supersedes=st['run_id'], run_id=rec.get('extraction_run_id'),
                              duplicate=rec.get('duplicate'))))


def prove(owner, year, prefix):
    """Per decision: its ruled amount, the sum of the movements that link to it, and the gap."""
    out = sc.psql(f"""select coalesce(json_agg(t order by t.id), '[]') from (
      select d.record->>'local_id' id, d.record->>'account' acct, d.record->>'category' cat, (d.record->>'amount')::numeric ruled,
             coalesce((select sum(-(m.record->>'amount')::numeric) from accounting_current_records('{owner}') m
                        where m.record->>'record_kind' = 'retained_bank_movement' and m.record->'bank_links' ? (d.record->>'local_id')), 0) linked,
             (select count(*) from accounting_current_records('{owner}') m
               where m.record->>'record_kind' = 'retained_bank_movement' and m.record->'bank_links' ? (d.record->>'local_id')) n
        from accounting_current_records('{owner}') d
       where d.record->>'record_kind' = 'retained_ledger_decision' and d.record->>'year' = '{year}'
         and d.record->>'section' = 'Expense' and d.record->>'local_id' like '{prefix}%') t;""")
    for r in json.loads(out.strip()):
        gap = D(str(r['ruled'])) - D(str(r['linked']))
        print(f"{r['id'][:60]:60} ruled {D(str(r['ruled'])):>11} linked {D(str(r['linked'])):>11} n={r['n']:>3} gap {gap:>10}")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['land', 'link', 'prove'])
    ap.add_argument('--plan'); ap.add_argument('--links'); ap.add_argument('--dry', action='store_true')
    ap.add_argument('--owner', default='0b9f107a-d124-49de-9ded-94698f63c1c4')
    ap.add_argument('--year'); ap.add_argument('--prefix')
    a = ap.parse_args()
    if a.cmd == 'land':
        land(a.plan, a.dry)
    elif a.cmd == 'link':
        link(a.links, a.dry)
    else:
        prove(sc.uuid_ok(a.owner), a.year, a.prefix or f'{a.year}-RULING-')

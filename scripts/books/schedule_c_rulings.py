#!/usr/bin/env python3
"""Schedule C rulings register: land owner rulings in the books DB, read Schedule C lines back, and check returns for drift.

The writer is the canonical one, public.ingest_financial_evidence (financial_evidence_v1). Each year has one register original
(a small fixed text file, so the document identity never changes); every landing is a revision of it, and a later landing
supersedes the current revision (the writer stamps the old cells superseded and v_financial_accounting_records keeps only the
current run). Each ruling becomes one retained_ledger_decision record whose category names its Schedule C line
("Schedule C line 20b: ...") and whose decision text carries the ruling and its evidence reference.

Amounts and evidence live in a local rulings file and in the database, never in this repo.

  dotenvx run -- python3 scripts/books/schedule_c_rulings.py land --rulings rulings-2025.json [--dry]
  dotenvx run -- python3 scripts/books/schedule_c_rulings.py lines --year 2025 --line-map line-map.json
  dotenvx run -- python3 scripts/books/schedule_c_rulings.py drift --line-map line-map.json --return 2025=sc-2025.json ...

rulings file: {"owner_id", "year", "title", "records": [{"key", "line", "label", "amount", "ruling", "evidence", "account", "date"}]}
line map: {"<section>|<category>": "<line>"} for legacy ledger categories (ruling categories carry their line).
return file: {"<account>": {"<line>": amount, ...}} (whole-dollar or cent amounts; compared to the cent after rounding both sides
the way the return does when --whole-dollars is given).
"""
import argparse, collections, hashlib, json, os, subprocess, sys, urllib.error, urllib.request
from decimal import Decimal as D, ROUND_HALF_UP

METHOD, VERSION = 'schedule_c_rulings_register', '2026-10-26'
EXPENSE_LINES = ['8', '9', '10', '11', '12', '13', '14', '15', '16a', '16b', '17', '18', '19', '20a', '20b', '21', '22', '23', '24a', '25', '26', '27a']


def psql(sql):
    cmd = ['bash', '-c', 'PGPASSWORD="$SUPABASE_DB_PASSWORD" PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=5000" psql '
           '"host=aws-0-us-west-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.qkgaybvrernstplzjaam sslmode=require" '
           '-X -v ON_ERROR_STOP=1 -At -f -']
    out = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr[-1500:])
    return out.stdout


def q(s):
    tag = 'R' + hashlib.sha256(s.encode()).hexdigest()[:8]
    assert f'${tag}$' not in s
    return f'${tag}${s}${tag}$'


def uuid_ok(s):
    import uuid
    return str(uuid.UUID(s))


# ---------- land ----------

def register_original(owner, year):
    body = f'Schedule C rulings register, tax year {year}. Records are revisions of this original in financial_evidence_v1.\n'.encode()
    sha = hashlib.sha256(body).hexdigest()
    return body, dict(sha256=sha, storage_path=f'{owner}/financial/{sha}.txt', source_filename=f'schedule-c-rulings-register-{year}.txt',
                      source_kind='upload', byte_size=str(len(body)))


def upload(body, key):
    url = os.environ['SUPABASE_URL'].rstrip('/') + f'/storage/v1/object/user-documents/{key}'
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + os.environ['SUPABASE_SERVICE_ROLE_KEY'], 'apikey': os.environ['SUPABASE_SERVICE_ROLE_KEY'],
        'Content-Type': 'text/plain', 'x-upsert': 'false'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:200]
        if e.code in (400, 409) and ('exists' in msg.lower() or 'duplicate' in msg.lower()):
            return 'exists'
        raise RuntimeError(f'upload failed {e.code}: {msg}')


def current_run(owner, sha):
    out = psql(f"""select json_build_object('run_id', r->>'run_id', 'key', r->>'key',
        'field_keys', (select json_agg(field_key) from financial_document_extractions e
                       where e.document_id = d.id and e.extraction_run_id = (r->>'run_id')::uuid))
      from financial_documents d, jsonb_array_elements(d.attributes->'runs') r
      where d.owner_id = '{owner}' and d.content_sha256 = '{sha}' and d.logical_index = 1
        and not exists (select 1 from jsonb_array_elements(d.attributes->'runs') s where s->>'supersedes_run_id' = r->>'run_id')
      limit 1;""")
    line = next((l for l in out.splitlines() if l.startswith('{')), None)
    return json.loads(line) if line else None


def clip(s, n=1900):
    return s if len(s) <= n else s[:n - 1] + '…'


def build_revision(spec, sha):
    year = spec['year']
    fields, records = [], []
    keys = [r['key'] for r in spec['records']]
    if len(keys) != len(set(keys)) or not 1 <= len(keys) <= 99:
        raise SystemExit('rulings need 1-99 records with unique keys')
    fields.append(dict(field_key='register', value_raw=clip(spec['title'], 500), value_type='text',
                       value_normalized=dict(year=year, records=len(keys)), evidence=dict(stage='owner_rulings', method=METHOD)))
    for i, r in enumerate(spec['records'], 1):
        amt = D(str(r['amount'])).quantize(D('0.01'))
        line = str(r['line'])
        fields.append(dict(field_key=f"ruling:{r['key']}", value_raw=f'{amt}', value_type='currency',
                           value_normalized=dict(line=line, account=r['account'], label=clip(r['label'], 300)),
                           evidence=dict(ruling=clip(r['ruling'], 600), reference=clip(r['evidence'], 1800))))
        records.append(dict(
            record_kind='retained_ledger_decision', source_key=hashlib.sha256(f"{sha}:{year}:{r['key']}".encode()).hexdigest(),
            source_sha256=sha, source_row=str(i), local_id=f"{year}-RULING-{r['key']}"[:200], year=year, date=r['date'],
            account=r['account'], currency='USD', currency_basis='Schedule C amount as ruled (USD)', amount=f'{amt}',
            section='Revenue' if line == '1' else 'Expense', category=clip(f"Schedule C line {line}: {r['label']}", 300),
            description=clip(r['label'], 500), decision=clip(f"{r['ruling']} | Evidence: {r['evidence']}"),
            status='Included: owner ruling on the Schedule C basis', source_reference=f"schedule-c-rulings-register-{year} | {r['key']}",
            bank_links=[], recognition_status='retained_decision', payment_status='unresolved', vehicle_status='unresolved',
            reimbursement_status='unresolved', entity_status='retained_scope_unallocated'))
    digest = hashlib.sha256(json.dumps([fields, records], sort_keys=True).encode()).hexdigest()[:12]
    return dict(idempotency_key=f'sc-rulings-{year}-{digest}', method=METHOD, version=VERSION, fields=fields, accounting_records=records)


def land(path, dry):
    spec = json.load(open(path))
    owner = uuid_ok(spec['owner_id'])
    body, original = register_original(owner, spec['year'])
    rev = build_revision(spec, original['sha256'])
    cur = current_run(owner, original['sha256'])
    if cur and cur['key'] == rev['idempotency_key']:
        print(json.dumps(dict(year=spec['year'], unchanged=True, run_id=cur['run_id'])))
        return
    if cur:
        rev['supersedes_run_id'] = cur['run_id']
        have = {f['field_key'] for f in rev['fields']}
        for k in cur['field_keys'] or []:
            if k not in have:
                rev['fields'].append(dict(field_key=k, value_raw='retired by a later revision', value_type='text',
                                          value_normalized=dict(retired=True), evidence=dict(stage='owner_rulings', retired=True)))
    st = 'dry' if dry else upload(body, original['storage_path'])
    sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
           "select set_config('request.jwt.claim.role','service_role',true);\n"
           f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(original))}::jsonb, "
           f"{q(json.dumps(rev, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
           f"select count(*) from v_financial_accounting_records where owner_id='{owner}' and year='{spec['year']}' and local_id like '{spec['year']}-RULING-%';\n"
           f"{'rollback' if dry else 'commit'};\n")
    out = [l for l in psql(sql).splitlines() if l.strip()]
    rec = json.loads(next(l for l in out if l.startswith('{') and 'extraction_run_id' in l))
    print(json.dumps(dict(year=spec['year'], dry=dry, upload=st, document_id=rec.get('document_id'), run_id=rec.get('extraction_run_id'),
                          supersedes=rev.get('supersedes_run_id'), records=len(rev['accounting_records']), visible_in_view=int([l for l in out if l.isdigit()][-1]))))


# ---------- read ----------

def category_totals(owner, year):
    out = psql(f"""select coalesce(json_agg(t), '[]') from (
        select coalesce(account, '') account, section, category, sum(amount_value)::text amount, count(*) n,
               bool_or(local_id like '{year}-RULING-%') ruling
          from v_financial_accounting_records
         where owner_id = '{owner}' and year = '{year}' and record_kind = 'retained_ledger_decision' and section in ('Revenue', 'Expense')
         group by 1, 2, 3) t;""")
    return json.loads(out.strip())


def lines_by_schedule(owner, year, line_map):
    """{schedule: {line: Decimal}}. Ruling rows group by their account (a 'Schedule C …' name); legacy ledger rows form 'Schedule C'."""
    raw = collections.defaultdict(lambda: collections.defaultdict(lambda: D('0')))
    unmapped = []
    for c in category_totals(owner, year):
        a = D(c['amount'])
        if c['category'].startswith('Schedule C line '):
            ln = c['category'][len('Schedule C line '):].split(':')[0].strip()
            sched = c['account'] if c['account'].startswith('Schedule C') else 'Schedule C'
        else:
            ln = line_map.get(f"{c['section']}|{c['category']}")
            sched = 'Schedule C'
            if ln is None:
                unmapped.append(c['category'])
                continue
        raw[sched][ln] += a
    if unmapped:
        raise SystemExit(f'{year}: categories with no Schedule C line: {sorted(set(unmapped))}')
    out = {}
    for sched, b in raw.items():
        meals = (b['24b'] / 2).quantize(D('0.01'))
        l1, l2, l4, l6 = b['1'], b['2'], b['4'], b['6']
        l3 = l1 - l2; l5 = l3 - l4; l7 = l5 + l6
        l28 = sum((b[k] for k in EXPENSE_LINES), D(0)) + meals
        l29 = l7 - l28; l30 = b['30']; l31 = l29 - l30
        out[sched] = {'1': l1, '2': l2, '3': l3, '4': l4, '5': l5, '6': l6, '7': l7, **{k: b[k] for k in EXPENSE_LINES if b[k]},
                      '24b': meals, '24b_book': b['24b'], '28': l28, '29': l29, '30': l30, '31': l31}
    return out


def drift(owner, line_map, returns, whole):
    bad = 0
    for spec in returns:
        year, path = spec.split('=', 1)
        ret = json.load(open(path))
        db = lines_by_schedule(owner, year, line_map)
        for sched, lines in ret.items():
            got = db.get(sched)
            if got is None:
                print(f'DRIFT {year} {sched}: not in the DB'); bad += 1; continue
            for ln, v in lines.items():
                want = got.get(ln, D(0))
                if whole:
                    want = want.quantize(D('1'), rounding=ROUND_HALF_UP)
                if D(str(v)) != want and abs(D(str(v)) - want) > (D('1') if whole else D('0.005')):
                    print(f'DRIFT {year} {sched} line {ln}: return {v} vs DB {want}'); bad += 1
            print(f'{year} {sched}: {len(lines)} lines checked, line 31 DB {got["31"]}')
    print('drift check:', 'FAIL' if bad else 'PASS', f'({bad} differences)')
    return 1 if bad else 0


# ---------- correct: supersede the specific ledger rows a ruling replaces ----------

def document_state(owner, doc_id):
    """Original, current run, its complete field set, accounting records and staging lines, as the writer needs them back."""
    out = psql(f"""select json_build_object(
      'original', json_build_object('sha256', d.content_sha256, 'storage_path', d.storage_path, 'source_filename', d.source_filename,
                                    'source_kind', d.source_kind, 'byte_size', d.byte_size::text),
      'run_id', r.run_id,
      'fields', (select json_agg(json_strip_nulls(json_build_object('field_key', e.field_key, 'value_raw', e.value_raw, 'value_type', e.value_type,
                   'page_number', e.page_number, 'value_normalized', e.value_normalized->'value', 'evidence', e.value_normalized->'evidence')) order by e.field_key)
                 from financial_document_extractions e where e.document_id = d.id and e.extraction_run_id = r.run_id::uuid),
      'records', (select json_agg(l.attributes->'accounting_record' order by l.line_number) from financial_document_lines l
                  where l.document_id = d.id and l.attributes->>'extraction_run_id' = r.run_id and l.attributes ? 'accounting_record'),
      'lines', (select json_agg(l.attributes->'staging' order by l.line_number) from financial_document_lines l
                  where l.document_id = d.id and l.attributes->>'extraction_run_id' = r.run_id and l.attributes ? 'staging'))
      from financial_documents d,
           lateral (select x->>'run_id' run_id from jsonb_array_elements(d.attributes->'runs') x
                     where not exists (select 1 from jsonb_array_elements(d.attributes->'runs') s where s->>'supersedes_run_id' = x->>'run_id')
                     limit 1) r
     where d.owner_id = '{owner}' and d.id = '{uuid_ok(doc_id)}';""")
    return json.loads(out.strip())


def correct(path, dry):
    """corrections file: {"owner_id", "ruling_register": "...", "rows": {"<local_id>": {"document_id", "section", "category", "amount"?, "note"}}}"""
    spec = json.load(open(path))
    owner = uuid_ok(spec['owner_id'])
    by_doc = collections.defaultdict(dict)
    for lid, c in spec['rows'].items():
        by_doc[c['document_id']][lid] = c
    for doc_id, rows in sorted(by_doc.items()):
        st = document_state(owner, doc_id)
        recs, seen = st['records'] or [], set()
        for r in recs:
            c = rows.get(r['local_id'])
            if not c:
                continue
            seen.add(r['local_id'])
            note = f"Superseded {VERSION} by {c['ruling_id']}: {c['note']}"
            if c.get('amount') is not None and D(c['amount']) != D(r['amount']):
                note += f" (paid amount {r['amount']}; book amount {c['amount']})"
                r['amount'] = f"{D(c['amount']):.2f}"
            r['section'], r['category'] = c['section'], clip(c['category'], 300)
            r['decision'] = clip(f"{r.get('decision') or ''} | {note}".lstrip(' |'), 1990)
        missing = set(rows) - seen
        if missing:
            raise SystemExit(f'{doc_id}: rows not in the current revision: {sorted(missing)}')
        rev = dict(method=METHOD, version=VERSION, fields=st['fields'], accounting_records=recs, supersedes_run_id=st['run_id'])
        if st['lines']:
            rev['lines'] = st['lines']
        rev['idempotency_key'] = 'sc-ruling-correct-' + hashlib.sha256(json.dumps(rev, sort_keys=True).encode()).hexdigest()[:24]
        sql = ("begin;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"
               "select set_config('request.jwt.claim.role','service_role',true);\n"
               f"select public.ingest_financial_evidence('{owner}'::uuid, {q(json.dumps(st['original']))}::jsonb, "
               f"{q(json.dumps(rev, ensure_ascii=False))}::jsonb, '{{\"kind\":\"user\"}}'::jsonb)::text;\n"
               f"{'rollback' if dry else 'commit'};\n")
        out = [l for l in psql(sql).splitlines() if l.startswith('{') and 'extraction_run_id' in l]
        rec = json.loads(out[-1])
        print(json.dumps(dict(document_id=doc_id, dry=dry, rows=sorted(rows), supersedes=st['run_id'], run_id=rec.get('extraction_run_id'),
                              duplicate=rec.get('duplicate'))))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['land', 'lines', 'drift', 'correct'])
    ap.add_argument('--rulings'); ap.add_argument('--corrections'); ap.add_argument('--dry', action='store_true')
    ap.add_argument('--owner', default='0b9f107a-d124-49de-9ded-94698f63c1c4')
    ap.add_argument('--year'); ap.add_argument('--line-map')
    ap.add_argument('--return', dest='returns', action='append', default=[])
    ap.add_argument('--whole-dollars', action='store_true')
    a = ap.parse_args()
    owner = uuid_ok(a.owner)
    lm = json.load(open(a.line_map)) if a.line_map else {}
    if a.cmd == 'land':
        land(a.rulings, a.dry)
    elif a.cmd == 'correct':
        correct(a.corrections, a.dry)
    elif a.cmd == 'lines':
        print(json.dumps({s: {k: str(v) for k, v in l.items()} for s, l in lines_by_schedule(owner, a.year, lm).items()}, indent=1))
    else:
        sys.exit(drift(owner, lm, a.returns, a.whole_dollars))

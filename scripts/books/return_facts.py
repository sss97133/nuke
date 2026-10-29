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
                                     "amount"?, "closes_with"?, "supersedes"?, "actor"?}]}
  topic: filing | filing_status | residency | credits | cfc | gilti | form_5471 | owner_ruling | result | penalty | other
  status: settled | open | superseded
  result facts also carry "result": {"form", "result": "refund"|"owe", "amount", "built_at", "amount_source"}
  filing facts (the paperwork state of a year's return; status settled or superseded, the newest settled one by as_of is the
  state) carry "filing": {"state": draft|prepared|mail_ready|on_hold|mailed|filed, "as_of": "YYYY-MM-DD", "form",
  "packet_pages"?, "packet_pdf"?, "packet_document_id"?, "deadline"?}. mail_ready needs packet_pages (or packet_pdf, counted
  here) and packet_document_id (the stored draft the state is about; the page reads it as "recorded for an earlier draft" when a
  newer draft exists); mailed needs packet_document_id. packet_pdf is a local path, used only to count pages, never stored.
  actor (open items only): owner | cpa | agent, who closes the item; an open item without one counts as unassigned.
  Land the state first and record the gate last (books_year_gate_check.py --record): a landing changes the book's signature and
  marks every stored gate run stale.
line map: {"<section>|<category>": "<line>"} for legacy ledger categories, stored as the schedule_c_line_map cell.
"""
import argparse, hashlib, json, os, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schedule_c_rulings import psql, q, uuid_ok, upload, current_run, clip  # noqa: E402

METHOD, VERSION = 'return_facts_register', '2026-10-26'
TOPICS = {'filing', 'filing_status', 'residency', 'credits', 'cfc', 'gilti', 'form_5471', 'owner_ruling', 'result', 'penalty', 'other'}
STATUSES = {'settled', 'open', 'superseded'}
FILING_STATES = ('draft', 'prepared', 'mail_ready', 'on_hold', 'mailed', 'filed')
ACTORS = ('owner', 'cpa', 'agent')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def pages_from_pdfinfo(text):
    m = re.search(r'^Pages:\s+(\d+)\s*$', text, re.M)
    return int(m.group(1)) if m else None


def pdf_pages(path):
    """Pages of a local PDF (the stored draft's page_count is null on every document): pypdf, else pdfinfo, else mdls."""
    try:
        import pypdf  # noqa: PLC0415
        return len(pypdf.PdfReader(path).pages)
    except Exception:
        pass
    for cmd, parse in ((['pdfinfo', path], pages_from_pdfinfo),
                       (['mdls', '-raw', '-name', 'kMDItemNumberOfPages', path], lambda t: int(t) if t.strip().isdigit() else None)):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            continue
        n = parse(out.stdout) if out.returncode == 0 else None
        if n:
            return n
    raise SystemExit(f'cannot count the pages of {os.path.basename(path)} (install pypdf or poppler, or give packet_pages)')


def check_filing(year, key, f):
    """The structured paperwork state of one year's return. Validated here so the page never has to read prose for it."""
    where = f'{year}:{key}'
    if f['status'] == 'open':
        raise SystemExit(f'{where}: a filing state is settled or superseded, never open (an open step is an open item)')
    filing = f.get('filing')
    if not isinstance(filing, dict):
        raise SystemExit(f'{where}: a filing fact needs a filing object')
    state = filing.get('state')
    if state not in FILING_STATES:
        raise SystemExit(f'{where}: filing.state must be one of {", ".join(FILING_STATES)}')
    if not isinstance(filing.get('as_of'), str) or not DATE_RE.match(filing['as_of']):
        raise SystemExit(f'{where}: filing.as_of must be a YYYY-MM-DD date')
    if not isinstance(filing.get('form'), str) or not filing['form'].strip():
        raise SystemExit(f'{where}: filing.form is required (the form the state is about)')
    if filing.get('deadline') is not None and not (isinstance(filing['deadline'], str) and DATE_RE.match(filing['deadline'])):
        raise SystemExit(f'{where}: filing.deadline must be a YYYY-MM-DD date')
    pages = filing.get('packet_pages')
    if pages is None and filing.get('packet_pdf'):
        pages = pdf_pages(filing['packet_pdf'])
    if pages is not None and (isinstance(pages, bool) or not isinstance(pages, int) or pages < 1):
        raise SystemExit(f'{where}: filing.packet_pages must be a positive whole number')
    doc = filing.get('packet_document_id')
    if doc is not None and not (isinstance(doc, str) and UUID_RE.match(doc)):
        raise SystemExit(f'{where}: filing.packet_document_id must be the stored draft\'s document id (a lowercase uuid)')
    if state == 'mail_ready' and pages is None:
        raise SystemExit(f'{where}: mail_ready needs the packet page count (packet_pages, or packet_pdf to count it)')
    if state in ('mail_ready', 'mailed') and doc is None:
        raise SystemExit(f'{where}: {state} needs packet_document_id, the stored draft the state is about')
    return {k: v for k, v in dict(state=state, as_of=filing['as_of'], form=filing['form'].strip(), packet_pages=pages,
                                  packet_document_id=doc, deadline=filing.get('deadline')).items() if v is not None}


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
        if f.get('actor') is not None and (f['status'] != 'open' or f['actor'] not in ACTORS):
            raise SystemExit(f'{year}:{key}: actor is {" | ".join(ACTORS)} and only on an open item')
        filing = check_filing(year, key, f) if f['topic'] == 'filing' else None
        if f['topic'] != 'filing' and f.get('filing') is not None:
            raise SystemExit(f'{year}:{key}: a filing object belongs to a fact with topic filing')
        if f['topic'] == 'result' and not {'form', 'result', 'amount', 'built_at', 'amount_source'} <= set(f.get('result') or {}):
            raise SystemExit(f'{year}:{key}: a result fact needs form, result, amount, built_at, amount_source')
        value = {k: v for k, v in dict(
            local_id=f'{year}-FACT-{key}', year=year, key=key, topic=f['topic'], status=f['status'], date=f['date'],
            decision=clip(f['decision'], 1500), amount=f.get('amount'), closes_with=clip(f['closes_with'], 400) if f.get('closes_with') else None,
            supersedes=f.get('supersedes'), result=f.get('result'), actor=f.get('actor'), filing=filing).items() if v is not None}
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

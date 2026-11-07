"""Connector-export manifest -> dry-run changeset for the existing private financial_evidence_v1 writer.

The manifest is produced by an authorized read-only mail connector; this adapter never holds mail credentials, never
fetches, and never changes labels. It keeps four clocks apart (sent, document, service period, ingest), keeps the
account-scoped thread/message/RFC ids and the attachment part id, dedups by content hash across forwards and
composite/component documents, and emits one envelope per unique original. Nothing is posted as an expense or payment.

Writer facts this module is built against (supabase/migrations/20261028161800, ingest_financial_evidence):
 - a key already in the document's runs replays only when the whole payload digest matches, else it raises
   'idempotency key payload conflict'; so the key here covers CONTENT, and the apply preflight reads the document first;
 - a second revision of an existing original must name the current run (`supersedes_run_id`) and carry every prior field_key;
   cell keys are therefore stable ids, and lines/concerns are carried explicitly;
 - revision keys are limited to idempotency_key/method/version/fields/concerns/supersedes_run_id/lines/accounting_records.
"""
import os, re
from collections import OrderedDict
from datetime import timedelta
from common import (ContractError, ORIGINAL_EXT, SHA_RE, canon, dec, money, parse_time, privacy_scan, sha256_hex)

SCHEMA = 'client_mail_manifest_v1'
CHANGESET_SCHEMA = 'client_mail_changeset_v2'
BACKUP_SCHEMA = 'client_evidence_backup_v1'
METHOD, VERSION = 'client_mail_manifest_adapter', '2026-11-07b'
CLAIM_KINDS = {  # distinct assertions; none is a posting
    'estimate_quote': 'revenue_candidate', 'invoice_claim': 'revenue_candidate', 'customer_billed': 'revenue_candidate',
    'supplier_cost': 'expense_candidate', 'deposit': 'none', 'balance': 'none',
    'payment_request': 'none', 'payment_assertion': 'none',
    'labor_claim': 'none', 'work_report': 'none', 'completion_report': 'none'}
MAX_FIELDS, MAX_CONCERNS, MAX_LINES = 100, 30, 500
CONCERN_TYPE = 'client_evidence_conflict'   # NOT verified against any financial_review_queue constraint; see docs
ID_RE = re.compile(r'^[A-Za-z0-9_.@<>=+-]{1,200}$')
CLOCK_CELL = 'clock.ingest'


# ---------------------------------------------------------------- validation
def validate(manifest, owner_id):
    errs = privacy_scan(manifest)
    if errs:
        raise ContractError('privacy refusal: ' + '; '.join(errs[:5]))
    if manifest.get('schema') != SCHEMA:
        raise ContractError(f'schema must be {SCHEMA}')
    if not ID_RE.match(str(manifest.get('account_ref', ''))):
        raise ContractError('account_ref (opaque account namespace) required')
    for i, m in enumerate(manifest.get('messages') or []):
        p = f'messages[{i}]'
        for k in ('gmail_message_id', 'gmail_thread_id'):
            if not ID_RE.match(str(m.get(k, ''))):
                raise ContractError(f'{p}.{k} required')
        if m.get('rfc_message_id') is not None and not ID_RE.match(str(m['rfc_message_id'])):
            raise ContractError(f'{p}.rfc_message_id invalid')
        parse_time(m.get('sent_at'), f'{p}.sent_at', tz='required')
        for j, a in enumerate(m.get('attachments') or []):
            q = f'{p}.attachments[{j}]'
            if not ID_RE.match(str(a.get('part_id', ''))):
                raise ContractError(f'{q}.part_id required')
            if not SHA_RE.match(str(a.get('sha256', ''))):
                raise ContractError(f'{q}.sha256 required (64 hex)')
            check_ref(a.get('private_original_ref') or {}, owner_id, f'{q}.private_original_ref')
            if not isinstance(a.get('byte_size'), int) or isinstance(a['byte_size'], bool) or not 1 <= a['byte_size'] <= 10485760:
                raise ContractError(f'{q}.byte_size must be 1..10 MiB')
            for c in a.get('claims') or []:
                _check_claim(c, f'{q}.claims')
    for r in manifest.get('relations') or []:
        if r.get('kind') != 'composite_of' or not SHA_RE.match(str(r.get('composite_sha256', ''))) \
                or not r.get('component_sha256s') or not all(SHA_RE.match(str(s)) for s in r['component_sha256s']):
            raise ContractError('relations: composite_of needs composite_sha256 and component_sha256s')


def check_ref(ref, owner_id, where):
    path = str(ref.get('storage_path', ''))
    if ref.get('bucket') != 'user-documents' or not path.startswith(f'{owner_id}/') or '..' in path or '\\' in path \
            or len(path) > 600 or not ORIGINAL_EXT.search(path):
        raise ContractError(f'{where} must be a private user-documents path under the owner with a whitelisted extension')


def _check_claim(c, p):
    if c.get('kind') not in CLAIM_KINDS:
        raise ContractError(f'{p}.kind must be one of {sorted(CLAIM_KINDS)}')
    cite = c.get('citation') or {}
    if not isinstance(cite.get('page'), int) or isinstance(cite['page'], bool) or cite['page'] < 1:
        raise ContractError(f'{p}: citation.page required')
    if c.get('amount') is not None:
        dec(c['amount'], f'{p}.amount')
    if not c.get('economic_key') or not c.get('document_kind'):
        raise ContractError(f'{p}: economic_key and document_kind required')
    for k in ('document_date', 'service_period_start', 'service_period_end'):
        if c.get(k) is not None:
            parse_time(c[k], f'{p}.{k}')
    for li in c.get('lines') or []:
        if not isinstance(li.get('row'), int) or isinstance(li['row'], bool) or li['row'] < 1:
            raise ContractError(f'{p}.lines: row must be an integer >= 1')
        for k in ('amount', 'quantity'):
            if li.get(k) is not None:
                dec(li[k], f'{p}.lines.{k}')
    if c['kind'] == 'labor_claim':
        lab = c.get('labor') or {}
        if not lab.get('categories'):
            raise ContractError(f'{p}: labor_claim needs labor.categories')
        for cat in lab['categories']:
            dec(cat.get('hours'), f'{p}.labor.hours')
            if cat.get('rate') is not None:
                dec(cat['rate'], f'{p}.labor.rate')
            if not cat.get('name'):
                raise ContractError(f'{p}.labor.categories[].name required')
        for k in ('claimed_total_hours', 'stated_labor_amount'):
            if lab.get(k) is not None:
                dec(lab[k], f'{p}.labor.{k}')


# ---------------------------------------------------------------- origins, claims, items
def origins(manifest):
    """Every (message, part) edge, grouped by content hash: forwards add edges, never documents."""
    acct, groups = manifest['account_ref'], OrderedDict()
    for m in manifest.get('messages') or []:
        for a in m.get('attachments') or []:
            groups.setdefault(a['sha256'], []).append({
                'account_ref': acct, 'gmail_thread_id': m['gmail_thread_id'], 'gmail_message_id': m['gmail_message_id'],
                'rfc_message_id': m.get('rfc_message_id'), 'attachment_part_id': a['part_id'],
                'filename': a.get('filename'), 'sent_at': m['sent_at'],
                'origin_key': f"gmail:{acct}:{m['gmail_message_id']}:{a['part_id']}", 'sha256': a['sha256'],
                'storage_path': a['private_original_ref']['storage_path'], 'byte_size': a['byte_size'],
                'claims': a.get('claims') or []})
    for sha, edges in groups.items():
        edges.sort(key=lambda e: e['origin_key'])
    return groups


def _claim_content(c):
    """Everything a claim asserts, except where it was cited from (so identical claims on forwards collapse)."""
    return {'kind': c['kind'], 'document_kind': c['document_kind'], 'economic_key': c['economic_key'],
            'amount': None if c.get('amount') is None else money(dec(c['amount'])), 'currency': c.get('currency', 'USD'),
            'document_date': c.get('document_date'), 'service_period_start': c.get('service_period_start'),
            'service_period_end': c.get('service_period_end'), 'summary': (c.get('summary') or '')[:200] or None,
            'labor': c.get('labor'),
            'lines': [[li['row'], li.get('description'), li.get('amount'), li.get('quantity')] for li in c.get('lines') or []]}


def collect_claims(edges):
    """-> (records, conflicts). One record per distinct claim content at a (key, kind, page, line) slot, with every citing
    origin. Two different contents at one slot are BOTH kept and flagged; nothing is first-wins."""
    recs, slots = OrderedDict(), {}
    for e in edges:
        for c in e['claims']:
            content = _claim_content(c)
            slot = [c['economic_key'], c['kind'], c['citation']['page'], c['citation'].get('line')]
            cid = sha256_hex(canon([slot, content]))[:16]
            r = recs.setdefault(cid, {'cid': cid, 'claim': c, 'content': content, 'slot': slot, 'citations': []})
            ref = {'origin_key': e['origin_key'], 'page': c['citation']['page'], 'line': c['citation'].get('line')}
            if ref not in r['citations']:
                r['citations'].append(ref)
            slots.setdefault(canon(slot), [])
            if cid not in slots[canon(slot)]:
                slots[canon(slot)].append(cid)
    conflicts = [{'slot': recs[v[0]]['slot'], 'claim_ids': v} for v in slots.values() if len(v) > 1]
    return list(recs.values()), conflicts


def _amt(c):
    return None if c.get('amount') is None else dec(c['amount'])


def economic_items(manifest):
    """One item per (economic_key, kind). Same key from several origins adds origins, never amounts. Declared composite_of
    relations DRIVE grouping: a composite claim whose kind and amount equal a component's claim is aliased to it (origins
    merged); one that equals the sum of the component amounts is a non-additive rollup; anything else is flagged unmatched."""
    items = OrderedDict()
    by_sha = origins(manifest)

    def item_for(c):
        k = (c['economic_key'], c['kind'])
        return items.setdefault(k, {'economic_key': c['economic_key'], 'kind': c['kind'], 'amount': None,
                                    'currency': c.get('currency', 'USD'), 'origins': [], 'conflicts': [], 'aliases': [],
                                    'counts_toward_total': True, 'rollup_of': None})

    def add(it, e, sha, c):
        a = _amt(c)
        if a is not None:
            if it['amount'] is None:
                it['amount'] = str(a)
            elif dec(it['amount']) != a:
                it['conflicts'].append(f"amount {it['amount']} vs {a} at {e['origin_key']} p{c['citation']['page']}")
        ref = {'origin_key': e['origin_key'], 'sha256': sha, 'page': c['citation']['page'], 'line': c['citation'].get('line')}
        if ref not in it['origins']:
            it['origins'].append(ref)

    relations = manifest.get('relations') or []
    composites = {r['composite_sha256']: r for r in relations}
    for sha, edges in by_sha.items():
        if sha in composites:
            continue
        for e in edges:
            for c in e['claims']:
                add(item_for(c), e, sha, c)
    for sha, edges in by_sha.items():
        if sha not in composites:
            continue
        comp = composites[sha]['component_sha256s']
        for e in edges:
            for c in e['claims']:
                a = _amt(c)
                twin = next((i for i in items.values() if i['kind'] == c['kind'] and a is not None and i['amount'] is not None
                             and dec(i['amount']) == a and any(o['sha256'] in comp for o in i['origins'])), None)
                if twin is not None and (twin['economic_key'], twin['kind']) != (c['economic_key'], c['kind']):
                    twin['aliases'].append(c['economic_key'])
                    add(twin, e, sha, c)
                    continue
                parts = [i for i in items.values() if i['kind'] == c['kind'] and i['amount'] is not None and i['counts_toward_total']
                         and all(o['sha256'] in comp for o in i['origins'])]
                it = item_for(c)
                add(it, e, sha, c)
                if (c['economic_key'], c['kind']) in [(p['economic_key'], p['kind']) for p in parts]:
                    continue    # same key as a component item: origins added, amount compared above
                if a is not None and parts and sum((dec(p['amount']) for p in parts), 0) == a:
                    it['counts_toward_total'] = False
                    it['rollup_of'] = [p['economic_key'] for p in parts]
                elif not it['conflicts']:
                    it['conflicts'].append(f"composite claim {c['economic_key']} matches no component claim or component sum")
    return list(items.values())


# ---------------------------------------------------------------- revisions
def _cell(key, raw, norm, page=None):
    cell = {'field_key': key, 'value_raw': raw[:2000], 'value_normalized': norm, 'value_type': 'json', 'evidence': {'locator': key}}
    if page:
        cell['page_number'] = page
    if len(canon(norm)) > 3900:
        raise ContractError(f'{key}: cell exceeds the writer size limit of 4000 bytes')
    return cell


def claim_cell(rec):
    c, ct = rec['claim'], rec['content']
    norm = {'kind': c['kind'], 'direction': CLAIM_KINDS[c['kind']], 'document_kind': c['document_kind'], 'economic_key': c['economic_key'],
            'amount': ct['amount'], 'currency': ct['currency'], 'assertion_status': 'claim_unverified', 'posted': False,
            'clock_document_date': ct['document_date'], 'clock_service_period_start': ct['service_period_start'],
            'clock_service_period_end': ct['service_period_end'], 'citations': rec['citations']}
    if ct['summary']:
        norm['summary'] = ct['summary']
    if c['kind'] == 'labor_claim':
        norm['labor_source_claim'] = ct['labor']
    return _cell(f"claim.{rec['cid']}", f"{c['kind']}:{c['economic_key']}", norm, c['citation']['page'])


def line_rows(sha, rec):
    c, out = rec['claim'], []
    for li in c.get('lines') or []:
        row = int(li['row'])
        out.append({'source_line_key': sha256_hex(canon([sha, c['citation']['page'], row, c['economic_key'], c['kind'], rec['cid']])),
                    'source_row': str(row + 1), 'source_file_sha256': sha, 'source_document_sha256': sha,   # writer needs >= 2
                    'description_raw': str(li.get('description', ''))[:500],
                    **({'amount': money(dec(li['amount']))} if li.get('amount') is not None else {}),
                    **({'quantity': str(dec(li['quantity']))} if li.get('quantity') is not None else {}),
                    'raw_line_sha256': sha256_hex(canon([li.get('description'), li.get('amount'), li.get('quantity')])),
                    'evidence_stage': 'attributed_retained_parse', 'geometry': None,
                    'issues': [f"page={c['citation']['page']}", f"kind={c['kind']}", f"claim={rec['cid']}"]})
    return out


def content_hash(revision):
    """Hash of what the revision SAYS: every cell except the ingest clock, plus lines and concerns."""
    return sha256_hex(canon([[f for f in revision['fields'] if f['field_key'] != CLOCK_CELL],
                             revision.get('lines') or [], revision.get('concerns') or []]))


def idempotency_key(owner_id, account_ref, sha, chash):
    return sha256_hex(canon([owner_id, account_ref, sha, METHOD, VERSION, chash]))[:64]


def concerns_for(sha, edges, recs, claim_conflicts, items, ref_conflicts):
    out = []
    for cf in claim_conflicts:
        out.append(('high', f"forwarded claims disagree at {cf['slot']}: claims {cf['claim_ids']} (all kept, none preferred)"))
    for it in items:
        if any(o['sha256'] == sha for o in it['origins']):
            for x in it['conflicts']:
                out.append(('high', f"{it['kind']} {it['economic_key']}: {x}"))
            if it['aliases'] and not it['rollup_of']:
                out.append(('medium', f"composite repeats component: {it['kind']} {it['economic_key']} also stated as {it['aliases']}; counted once"))
            if it['rollup_of']:
                out.append(('medium', f"{it['kind']} {it['economic_key']} is a rollup of {it['rollup_of']}; not additive"))
    for x in ref_conflicts:
        out.append(('medium', x))
    seen, res = set(), []
    for pr, d in out:
        if d not in seen:
            seen.add(d)
            res.append({'concern_type': CONCERN_TYPE, 'priority': pr, 'detail': d[:1900], 'resolver': 'owner'})
    if len(res) > MAX_CONCERNS:
        res = res[:MAX_CONCERNS - 1] + [{'concern_type': CONCERN_TYPE, 'priority': 'high',
                                         'detail': f'{len(res) - MAX_CONCERNS + 1} further concerns truncated at the writer cap', 'resolver': 'owner'}]
    return res


def build_revision(owner_id, account_ref, sha, edges, relations, run_clock, recs, concerns, extra_cells=()):
    fields = []
    for e in edges:
        norm = {k: e[k] for k in ('account_ref', 'gmail_thread_id', 'gmail_message_id', 'rfc_message_id', 'attachment_part_id',
                                  'origin_key', 'storage_path', 'byte_size')}
        norm['clock_sent_at'] = e['sent_at']                       # one clock: when the mail was sent
        fields.append(_cell(f"origin.{sha256_hex(e['origin_key'])[:16]}", e['origin_key'], norm))
    lines = []
    for r in sorted(recs, key=lambda r: r['cid']):
        fields.append(claim_cell(r))
        lines += line_rows(sha, r)
    fields += list(extra_cells)
    rel = [r for r in relations if sha == r['composite_sha256'] or sha in r['component_sha256s']]
    if rel:
        fields.append(_cell('relation.composite', 'composite_of', {'relations': rel, 'rule': 'overlap_counted_once_via_grouping'}))
    fields.sort(key=lambda f: f['field_key'])
    fields.append(_cell(CLOCK_CELL, run_clock, {'clock_ingest_at': run_clock}))
    if len(fields) > MAX_FIELDS:
        raise ContractError(f'{sha[:12]}: {len(fields)} cells exceed the writer cap of {MAX_FIELDS}; split the manifest')
    if len(lines) > MAX_LINES:
        raise ContractError(f'{sha[:12]}: {len(lines)} lines exceed the writer cap of {MAX_LINES}')
    rev = {'idempotency_key': '', 'method': METHOD, 'version': VERSION, 'fields': fields}
    if lines:
        rev['lines'] = lines
    if concerns:
        rev['concerns'] = concerns
    rev['idempotency_key'] = idempotency_key(owner_id, account_ref, sha, content_hash(rev))
    errs = privacy_scan(rev)
    if errs:
        raise ContractError('privacy refusal in revision: ' + '; '.join(errs[:3]))
    return rev


def plan(manifest, owner_id, run_clock, extras=None):
    """Dry-run changeset. Deterministic given (manifest, owner, run_clock). `extras(sha, edges, recs)` may add cells
    (timeline projection, labor source claims) to a document's revision."""
    validate(manifest, owner_id)
    parse_time(run_clock, 'run_clock', tz='required')
    relations = manifest.get('relations') or []
    items = economic_items(manifest)
    envelopes = []
    for sha, edges in origins(manifest).items():
        sizes = {e['byte_size'] for e in edges}
        if len(sizes) > 1:
            raise ContractError(f'{sha[:12]}: the same bytes are exported with different byte_size {sorted(sizes)}; the export is inconsistent')
        paths = sorted({e['storage_path'] for e in edges})
        ref_conflicts = [f"same bytes held at {len(paths)} private paths: {paths}; the first sorted path is the custody path"] if len(paths) > 1 else []
        recs, conflicts = collect_claims(edges)
        concerns = concerns_for(sha, edges, recs, conflicts, items, ref_conflicts)
        extra = extras(sha, edges, recs) if extras else []
        rev = build_revision(owner_id, manifest['account_ref'], sha, edges, relations, run_clock, recs, concerns, extra)
        envelopes.append({'original': {'sha256': sha, 'storage_path': paths[0], 'source_filename': edges[0].get('filename') or 'attachment',
                                       'source_kind': 'client_mail_attachment', 'byte_size': edges[0]['byte_size']},
                          'revision': rev, 'origin_count': len(edges), 'posting': {'expense_posted': False, 'payment_posted': False}})
    envelopes.sort(key=lambda x: x['original']['sha256'])
    return {'schema': CHANGESET_SCHEMA, 'mode': 'dry_run', 'owner_id': owner_id, 'account_ref': manifest['account_ref'],
            'method': METHOD, 'version': VERSION,
            'writer': 'ingest-observation mode financial_evidence_v1 -> public.ingest_financial_evidence',
            'envelopes': envelopes, 'economic_items': items,
            'prerequisites': ['backup_artifact', 'changeset_review'], 'run_clock': run_clock}


def changeset_hash(cs):
    return sha256_hex(canon(cs))


# ---------------------------------------------------------------- re-validation, backup artifact, apply
def validate_changeset(cs, owner_id):
    """Everything apply relies on is re-checked here, so a hand-edited or foreign changeset gets the same gates as a fresh plan."""
    if cs.get('schema') != CHANGESET_SCHEMA or cs.get('mode') != 'dry_run':
        raise ContractError('not a dry-run client mail changeset')
    if cs.get('owner_id') != owner_id:
        raise ContractError('changeset owner differs from the requested owner')
    if not cs.get('envelopes'):
        raise ContractError('changeset has no envelopes')
    errs = privacy_scan(cs['envelopes'])
    if errs:
        raise ContractError('privacy refusal: ' + '; '.join(errs[:5]))
    seen = set()
    for env in cs['envelopes']:
        o, rev = env['original'], env['revision']
        if not SHA_RE.match(str(o.get('sha256'))) or o['sha256'] in seen:
            raise ContractError('envelope sha256 invalid or repeated')
        seen.add(o['sha256'])
        check_ref({'bucket': 'user-documents', 'storage_path': o.get('storage_path')}, owner_id, f"envelope {o['sha256'][:12]} original")
        if env.get('posting') != {'expense_posted': False, 'payment_posted': False}:
            raise ContractError('envelope may not carry a posting')
        if set(rev) - {'idempotency_key', 'method', 'version', 'fields', 'concerns', 'lines'}:
            raise ContractError('revision carries keys the writer does not accept')
        if not 1 <= len(rev['fields']) <= MAX_FIELDS or len(rev.get('concerns') or []) > MAX_CONCERNS or len(rev.get('lines') or []) > MAX_LINES:
            raise ContractError('revision exceeds writer caps')
        keys = [f['field_key'] for f in rev['fields']]
        if len(set(keys)) != len(keys):
            raise ContractError('duplicate field keys')
        for f in rev['fields']:
            if f['field_key'].startswith('claim.') and (f['value_normalized'].get('assertion_status') != 'claim_unverified'
                                                        or f['value_normalized'].get('posted') is not False):
                raise ContractError('a claim cell may not assert verification or posting')
        if rev['idempotency_key'] != idempotency_key(owner_id, cs.get('account_ref'), o['sha256'], content_hash(rev)):
            raise ContractError(f"{o['sha256'][:12]}: idempotency key does not match the revision content")


def _aware_now(now):
    if now.tzinfo is None:
        raise ContractError('now must be timezone-aware')
    return now


def state_summary(data):
    """Reduce a read_financial_evidence/accounting response to the facts apply needs; None when the original is not held."""
    if data is None:
        return None
    try:
        doc, runs = data['document'], data['document']['attributes']['runs']
        fields = data.get('fields') or []
        superseded = {r['supersedes_run_id'] for r in runs if r.get('supersedes_run_id')}
        current = [r['run_id'] for r in runs if r['run_id'] not in superseded]
        if len(current) > 1:
            raise ContractError('ambiguous current revision')
        return {'document_id': doc.get('id'), 'current_run_id': current[0] if current else None,
                'run_keys': sorted(r['key'] for r in runs),
                'field_keys': sorted(f['field_key'] for f in fields),
                'field_digests': sorted(sha256_hex(canon([f['field_key'], f.get('value_raw')])) for f in fields)}
    except (KeyError, TypeError) as ex:
        raise ContractError(f'unrecognised read response ({type(ex).__name__}); refusing to guess')


def make_backup_artifact(cs, owner_id, read, created_at):
    """Read-only pre-state snapshot of every affected original (hashes and ids, no content). The writer is append-only, so
    rollback is supersession by a new revision; this artifact is what a rollback and the apply revalidation compare against."""
    validate_changeset(cs, owner_id)
    _aware_now(created_at)
    pre = {env['original']['sha256']: state_summary(read(env['original']['sha256'])) for env in cs['envelopes']}
    art = {'schema': BACKUP_SCHEMA, 'owner_id': owner_id, 'changeset_sha256': changeset_hash(cs), 'created_at': created_at.isoformat(),
           'envelope_shas': sorted(pre), 'pre_state': pre, 'documents_existing': sum(1 for v in pre.values() if v),
           'documents_absent': sum(1 for v in pre.values() if not v)}
    art['artifact_sha256'] = sha256_hex(canon(art))
    return art


def write_backup_artifact(art, path, repo_root):
    """Writes outside the repository only (private), 0600, never overwriting."""
    p, root = os.path.realpath(path), os.path.realpath(repo_root)
    if p == root or p.startswith(root + os.sep):
        raise ContractError('the backup artifact must be written outside the repository')
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as fh:
        fh.write(canon(art))
    return {'artifact_path': p, 'artifact_sha256': art['artifact_sha256'], 'bytes': os.path.getsize(p)}


def verify_backup(art, cs, owner_id, now, max_age=timedelta(hours=24)):
    """Offline checks that the artifact is intact, current, for this owner and this exact changeset, and covers every original."""
    now = _aware_now(now)
    if not isinstance(art, dict) or art.get('schema') != BACKUP_SCHEMA:
        raise ContractError('not a backup artifact')
    body = {k: v for k, v in art.items() if k != 'artifact_sha256'}
    if art.get('artifact_sha256') != sha256_hex(canon(body)):
        raise ContractError('backup artifact failed its integrity hash')
    if art['owner_id'] != owner_id or art['changeset_sha256'] != changeset_hash(cs):
        raise ContractError('backup artifact names a different owner or changeset')
    created, aware = parse_time(art['created_at'], 'backup.created_at', tz='required')
    if created > now + timedelta(minutes=5) or now - created > max_age:
        raise ContractError('backup artifact is from the future or older than the allowed age')
    if sorted(env['original']['sha256'] for env in cs['envelopes']) != art['envelope_shas'] or set(art['pre_state']) != set(art['envelope_shas']):
        raise ContractError('backup artifact does not cover exactly this changeset')
    return art


def load_backup(path, expect_sha256, expect_bytes=None):
    """Read the artifact file named by a receipt and check the receipt's hash against the FILE bytes."""
    import json
    raw = open(path, 'rb').read()
    art = json.loads(raw)
    if expect_bytes is not None and len(raw) != expect_bytes:
        raise ContractError('backup artifact size differs from the receipt')
    if art.get('artifact_sha256') != expect_sha256:
        raise ContractError('backup artifact hash differs from the receipt')
    return art


def _decide(env, state, pre):
    key = env['revision']['idempotency_key']
    if state and key in state['run_keys']:
        return 'already_applied', None
    if (state is None) != (pre is None):
        raise ContractError('live state differs from the backup (document appeared or vanished); take a new backup')
    if state is None:
        return 'submit', None
    if state['current_run_id'] != pre['current_run_id'] or state['run_keys'] != pre['run_keys'] or state['field_digests'] != pre['field_digests']:
        raise ContractError('live state differs from the backup (new revision since the snapshot); take a new backup')
    new_keys = {f['field_key'] for f in env['revision']['fields']}
    missing = sorted(set(state['field_keys']) - new_keys)
    if missing:
        raise ContractError(f'revision would drop prior field keys {missing}; the writer requires the complete prior set')
    return 'supersede', state['current_run_id']


def apply(cs, owner_id, art, transport, now, resume=None):
    """The only write path, and only through `transport` (the sanctioned writer). Re-validates the changeset, verifies the
    backup artifact, preflights each original against the live state, submits SEQUENTIALLY, records every outcome, and stops
    at the first refusal. Returns a ledger: done / already_applied / failed / not_attempted, which `resume` consumes."""
    validate_changeset(cs, owner_id)
    verify_backup(art, cs, owner_id, now)
    ledger = {'changeset_sha256': changeset_hash(cs), 'done': [], 'already_applied': [], 'failed': [], 'not_attempted': []}
    prior_done = {d['sha256'] for d in (resume or {}).get('done', []) if resume.get('changeset_sha256') == ledger['changeset_sha256']}
    envs = cs['envelopes']
    for i, env in enumerate(envs):
        sha = env['original']['sha256']
        try:
            state = state_summary(transport.read(sha))
            action, prior_run = _decide(env, state, art['pre_state'][sha])
            if action == 'already_applied':
                ledger['already_applied'].append({'sha256': sha})
                continue
            if sha in prior_done:
                raise ContractError('resume ledger says done but the live document does not hold this revision')
            rev = dict(env['revision'])
            if prior_run:
                rev['supersedes_run_id'] = prior_run
            res = transport.submit({'mode': 'financial_evidence_v1', 'action': 'submit',
                                    'original': {k: v for k, v in env['original'].items() if k != 'byte_size'}, 'revision': rev})
            data = (res or {}).get('data') or {}
            if (res or {}).get('expense_posted') is not False or not data.get('document_id') or not data.get('extraction_run_id'):
                raise ContractError('writer response is not a retained-evidence receipt')
            ledger['done'].append({'sha256': sha, 'document_id': data['document_id'], 'extraction_run_id': data['extraction_run_id'],
                                   'action': action, 'review_ids': len(data.get('review_ids') or [])})
        except Exception as ex:   # any refusal stops the run; nothing after it is attempted
            ledger['failed'].append({'sha256': sha, 'reason': f'{type(ex).__name__}: {str(ex)[:300]}'})
            ledger['not_attempted'] = [e['original']['sha256'] for e in envs[i + 1:]]
            break
    ledger['complete'] = not ledger['failed']
    return ledger

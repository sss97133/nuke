"""Connector-export manifest -> dry-run changeset for the existing private financial_evidence_v1 writer.

The manifest is produced by an authorized read-only mail connector; this adapter never holds mail credentials, never
fetches, and never changes labels. It keeps four clocks apart (sent, document, service period, ingest), keeps the
account-scoped thread/message/RFC ids and the attachment part id, dedups by content hash across forwards and
composite/component documents, and emits one envelope per unique original. Nothing is posted as an expense or payment.
"""
import re
from collections import OrderedDict
from datetime import datetime
from common import ContractError, SHA_RE, canon, dec, money, privacy_scan, sha256_hex

SCHEMA = 'client_mail_manifest_v1'
METHOD, VERSION = 'client_mail_manifest_adapter', '2026-11-07'
CLAIM_KINDS = {  # distinct assertions; none is a posting
    'estimate_quote': 'revenue_candidate', 'invoice_claim': 'revenue_candidate', 'customer_billed': 'revenue_candidate',
    'supplier_cost': 'expense_candidate', 'deposit': 'none', 'balance': 'none',
    'payment_request': 'none', 'payment_assertion': 'none'}
MAX_FIELDS = 100
ID_RE = re.compile(r'^[A-Za-z0-9_.@<>=+-]{1,200}$')


def _iso(value, field, need_tz):
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        raise ContractError(f'{field}: not ISO-8601: {value!r}')
    if need_tz and d.tzinfo is None:
        raise ContractError(f'{field}: timezone required')
    return d


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
        _iso(m.get('sent_at'), f'{p}.sent_at', True)
        for j, a in enumerate(m.get('attachments') or []):
            q = f'{p}.attachments[{j}]'
            if not ID_RE.match(str(a.get('part_id', ''))):
                raise ContractError(f'{q}.part_id required')
            if not SHA_RE.match(str(a.get('sha256', ''))):
                raise ContractError(f'{q}.sha256 required (64 hex)')
            ref = a.get('private_original_ref') or {}
            path = str(ref.get('storage_path', ''))
            if ref.get('bucket') != 'user-documents' or not path.startswith(f'{owner_id}/') or '..' in path or '\\' in path:
                raise ContractError(f'{q}.private_original_ref must be a private user-documents path under the owner')
            if not isinstance(a.get('byte_size'), int) or not 1 <= a['byte_size'] <= 10485760:
                raise ContractError(f'{q}.byte_size must be 1..10 MiB')
            for c in a.get('claims') or []:
                _check_claim(c, f'{q}.claims')
    for r in manifest.get('relations') or []:
        if r.get('kind') != 'composite_of' or not SHA_RE.match(str(r.get('composite_sha256', ''))) \
                or not r.get('component_sha256s') or not all(SHA_RE.match(str(s)) for s in r['component_sha256s']):
            raise ContractError('relations: composite_of needs composite_sha256 and component_sha256s')


def _check_claim(c, p):
    if c.get('kind') not in CLAIM_KINDS:
        raise ContractError(f'{p}.kind must be one of {sorted(CLAIM_KINDS)}')
    cite = c.get('citation') or {}
    if not isinstance(cite.get('page'), int) or cite['page'] < 1:
        raise ContractError(f'{p}: citation.page required')
    if c.get('amount') is not None:
        dec(c['amount'], f'{p}.amount')
    if not c.get('economic_key') or not c.get('document_kind'):
        raise ContractError(f'{p}: economic_key and document_kind required')
    for k in ('document_date', 'service_period_start', 'service_period_end'):
        if c.get(k) is not None:
            _iso(c[k], f'{p}.{k}', False)


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
    return groups


def economic_items(manifest):
    """One item per economic_key+kind; composites and components that repeat a claim add origins, not amounts."""
    items = OrderedDict()
    for sha, edges in origins(manifest).items():
        for e in edges:
            for c in e['claims']:
                key = (c['economic_key'], c['kind'])
                it = items.setdefault(key, {'economic_key': c['economic_key'], 'kind': c['kind'], 'amount': c.get('amount'),
                                            'currency': c.get('currency', 'USD'), 'origins': [], 'conflicts': []})
                if it['amount'] != c.get('amount') and c.get('amount') is not None:
                    if it['amount'] is None:
                        it['amount'] = c['amount']
                    else:
                        it['conflicts'].append(f"amount {it['amount']} vs {c['amount']} at {e['origin_key']} p{c['citation']['page']}")
                ref = {'origin_key': e['origin_key'], 'sha256': sha, 'page': c['citation']['page'], 'line': c['citation'].get('line')}
                if ref not in it['origins']:
                    it['origins'].append(ref)
    return list(items.values())


def _cell(key, raw, norm, page=None):
    cell = {'field_key': key, 'value_raw': raw[:2000], 'value_normalized': norm, 'value_type': 'json',
            'evidence': {'locator': key}}
    if page:
        cell['page_number'] = page
    return cell


def build_revision(sha, edges, relations, run_clock):
    fields = []
    for n, e in enumerate(edges):
        norm = {k: e[k] for k in ('account_ref', 'gmail_thread_id', 'gmail_message_id', 'rfc_message_id',
                                  'attachment_part_id', 'origin_key')}
        norm['clock_sent_at'] = e['sent_at']                       # one clock: when the mail was sent
        fields.append(_cell(f'origin.{n}', e['origin_key'], norm))
    claims, lines, seen = [], [], set()
    for e in edges:
        for c in e['claims']:
            k = (c['economic_key'], c['kind'], c['citation']['page'], c['citation'].get('line'))
            if k in seen:
                continue
            seen.add(k)
            claims.append((e, c))
    for n, (e, c) in enumerate(claims):
        norm = {'kind': c['kind'], 'direction': CLAIM_KINDS[c['kind']], 'document_kind': c['document_kind'],
                'economic_key': c['economic_key'], 'amount': None if c.get('amount') is None else money(dec(c['amount'])),
                'currency': c.get('currency', 'USD'), 'assertion_status': 'claim_unverified', 'posted': False,
                'clock_document_date': c.get('document_date'), 'clock_service_period_start': c.get('service_period_start'),
                'clock_service_period_end': c.get('service_period_end'),
                'citation': {'origin_key': e['origin_key'], 'page': c['citation']['page'], 'line': c['citation'].get('line')}}
        fields.append(_cell(f'claim.{n}', f"{c['kind']}:{c['economic_key']}", norm, c['citation']['page']))
        for li in c.get('lines') or []:
            row = int(li['row'])
            lines.append({'source_line_key': sha256_hex(canon([sha, c['citation']['page'], row, c['economic_key']])),
                          'source_row': str(max(row, 2)), 'source_file_sha256': sha, 'source_document_sha256': sha,
                          'description_raw': str(li.get('description', ''))[:500],
                          **({'amount': money(dec(li['amount']))} if li.get('amount') is not None else {}),
                          **({'quantity': str(dec(li['quantity']))} if li.get('quantity') is not None else {}),
                          'raw_line_sha256': sha256_hex(canon([li.get('description'), li.get('amount'), li.get('quantity')])),
                          'evidence_stage': 'attributed_retained_parse', 'geometry': None,
                          'issues': [f"page={c['citation']['page']}", f"kind={c['kind']}"]})
    rel = [r for r in relations if sha == r['composite_sha256'] or sha in r['component_sha256s']]
    if rel:
        fields.append(_cell('relation.composite', 'composite_of', {'relations': rel, 'rule': 'overlap_counted_once'}))
    fields.append(_cell('clock.ingest', run_clock, {'clock_ingest_at': run_clock}))
    if len(fields) > MAX_FIELDS:
        raise ContractError(f'{sha[:12]}: {len(fields)} cells exceed the writer cap of {MAX_FIELDS}; split the manifest')
    rev = {'idempotency_key': sha256_hex(canon([edges[0]['account_ref'], sha, METHOD, VERSION]))[:64],
           'method': METHOD, 'version': VERSION, 'fields': fields}
    if lines:
        rev['lines'] = lines
    errs = privacy_scan(rev)
    if errs:
        raise ContractError('privacy refusal in revision: ' + '; '.join(errs[:3]))
    return rev


def plan(manifest, owner_id, run_clock):
    """Dry-run changeset. Deterministic given (manifest, run_clock) so a replay produces identical idempotency keys."""
    validate(manifest, owner_id)
    relations = manifest.get('relations') or []
    envelopes = []
    for sha, edges in origins(manifest).items():
        e0 = edges[0]
        envelopes.append({'original': {'sha256': sha, 'storage_path': e0['storage_path'], 'source_filename': e0.get('filename') or 'attachment',
                                       'source_kind': 'client_mail_attachment', 'byte_size': e0['byte_size']},
                          'revision': build_revision(sha, edges, relations, run_clock),
                          'origin_count': len(edges), 'posting': {'expense_posted': False, 'payment_posted': False}})
    return {'schema': 'client_mail_changeset_v1', 'mode': 'dry_run', 'owner_id': owner_id, 'method': METHOD, 'version': VERSION,
            'writer': 'ingest-observation mode financial_evidence_v1 -> public.ingest_financial_evidence',
            'envelopes': envelopes, 'economic_items': economic_items(manifest),
            'prerequisites': ['backup_receipt', 'changeset_review'], 'run_clock': run_clock}


def apply(changeset, backup_receipt, submit):
    """Write path: only through the sanctioned writer (`submit`) and only with a backup receipt for this changeset."""
    if changeset.get('mode') != 'dry_run' or not backup_receipt or backup_receipt.get('changeset_sha256') != sha256_hex(canon(changeset)):
        raise ContractError('apply needs a backup receipt naming this exact changeset')
    return [submit({'mode': 'financial_evidence_v1', 'action': 'submit', 'original': {k: v for k, v in env['original'].items() if k != 'byte_size'},
                    'revision': env['revision']}) for env in changeset['envelopes']]

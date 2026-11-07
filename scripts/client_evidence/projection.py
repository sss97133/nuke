"""Owner-private projections of image-derived timeline observations and invoice-vs-photo labor reconciliation.

Target: public.private_work_projections (migration 20261107210025), written only by ingest_private_work_projection through the
ingest-observation `financial_evidence_v1` actions `projection_submit` / `projection_read`. Account scope, not vehicle
ownership: the account is the caller's own credential, never a field here. Nothing is written to the public timeline_events /
work_sessions tables, and photo evidence never becomes billable hours, verified work, payment or ownership.

Plan (offline) -> backup (read-only pre-state of every projection head) -> apply (dry-run unless --execute). Never run by tests
against a service."""
import re
from datetime import timedelta
from common import ContractError, SHA_RE, canon, parse_time, privacy_scan, sha256_hex
import labor, mail_manifest as mm

PRODUCER, METHOD, VERSION = 'client_evidence_projector', 'image_labor_projection', '2026-11-07a'
SCHEMA = 'client_private_projection_changeset_v1'
BACKUP_SCHEMA = 'client_projection_backup_v1'
KINDS = ('image_timeline_event', 'labor_reconciliation')
KEY_RE = re.compile(r'^[a-f0-9]{16,64}$')
BATCH = 50                       # the writer's per-revision cap
MAX_REFS = 200
PRIVACY_ORIGINS = {'privacy_hold', 'protected', 'person', 'personal'}
HELD_ORIGINS = labor.EXCLUDED_ORIGINS
IMAGE_KEYS = {'event_key', 'stance', 'time', 'capture', 'identity', 'origin_class', 'intent', 'assertion_status',
              'completed_work_asserted', 'subject_vehicle_ref'}
LABOR_KEYS = {'reconciliation_key', 'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive',
              'billable_hours', 'hours_verified'}
# keys the database refuses anywhere in a payload (mirrors private_work_payload_problem)
FORBIDDEN = {'ocr_text', 'raw_text', 'full_text', 'full_ocr', 'body', 'body_text', 'html', 'snippet', 'iban', 'bank_iban', 'full_iban',
             'email', 'phone', 'person_name', 'image_bytes', 'photo', 'face', 'verified_hours', 'billable_hours_verified',
             'total_hours', 'combined_hours', 'sum_hours', 'payment_verified', 'ownership_verified', 'owner_verified',
             'vehicle_owner', 'co_owner', 'coowner'}
FORBIDDEN_RE = re.compile(r'(token|password|secret|authorization|cookie|credential|api_?key)')


def _walk_keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _walk_keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk_keys(v)


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


# ------------------------------------------------------------------ image-derived observations
def _identity_state(im):
    ident = im.get('identity')
    if ident == 'confirmed':
        return 'context_only' if im.get('identity_basis') == 'context' else 'confirmed'
    return 'unknown' if ident in (None, 'unknown') else 'unconfirmed'


def image_item(im, vehicle_id):
    """One private observation per retained image, keyed by its exact bytes. Returns (item | None, reason).
    An unknown, contextual, excluded or privacy-held frame is recorded as HELD with no capture time and no vehicle link."""
    sha = im.get('sha256')
    if not isinstance(sha, str) or not SHA_RE.match(sha):
        return None, 'image sha256 missing or malformed: not persistable'
    state = _identity_state(im)
    origin = im.get('origin') or 'unknown'
    privacy = bool(im.get('privacy_hold')) or origin in PRIVACY_ORIGINS
    held = state != 'confirmed' or privacy or origin in HELD_ORIGINS or im.get('vehicle_id') != vehicle_id
    holds = []
    if state != 'confirmed':
        holds.append({'context_only': 'identity_context_only', 'unknown': 'identity_unknown'}.get(state, 'identity_not_confirmed'))
    if privacy:
        holds.append('privacy_hold')
    if origin in HELD_ORIGINS:
        holds.append('excluded_origin')
    if im.get('vehicle_id') != vehicle_id:
        holds.append('other_or_unassigned_vehicle')
    if im.get('intent') is None:
        holds.append('intent_unclassified')
    capture = {'source': 'withheld', 'offset_state': 'unknown'}
    time = {'kind': 'unknown', 'basis': 'withheld_while_held' if (privacy or held) else 'no_trusted_capture_time'}
    cap = im.get('capture')
    if not (privacy or held):
        if cap and cap.get('source') in labor.PHOTO_CONFIG['trusted_time_sources'] and cap.get('at'):
            ck = labor.capture_clock(cap)
            if ck['local'].year <= labor.PHOTO_CONFIG['earliest_plausible_year']:
                holds.append('implausible_clock')
                capture = {'source': cap['source'], 'offset_state': 'unknown'}
                time = {'kind': 'unknown', 'basis': 'implausible_clock'}
            elif ck['offset'] == 'known':
                capture = {'source': cap['source'], 'offset_state': 'known', 'camera_local': ck['local'].isoformat(),
                           'utc': ck['utc'].isoformat()}
                time = {'kind': 'instant', 'basis': 'trusted_capture_time', 'camera_local': ck['local'].isoformat(),
                        'utc': ck['utc'].isoformat()}
            else:   # the offset is unknown: no UTC is invented and the value is never normalized
                holds.append('clock_offset_unknown')
                capture = {'source': cap['source'], 'offset_state': 'unknown', 'camera_local': ck['local'].isoformat()}
                time = {'kind': 'instant', 'basis': 'camera_local_unknown_offset', 'camera_local': ck['local'].isoformat()}
        else:
            holds.append('no_trusted_capture_time')
            capture = {'source': 'none', 'offset_state': 'unknown'}
    key = sha256_hex(canon(['image_timeline_event', sha]))[:32]
    payload = {'event_key': key, 'stance': 'visual_observed', 'time': time, 'capture': capture,
               'identity': {'state': state, 'basis': 'context' if im.get('identity_basis') == 'context' else (im.get('identity_basis') or 'cited_identity')},
               'origin_class': origin if re.match(r'^[a-z_]{1,40}$', origin) else 'unknown',
               'intent': im.get('intent') or 'unclassified',
               'assertion_status': 'held' if held else 'observation_unverified', 'completed_work_asserted': False}
    if not held and vehicle_id:
        payload['subject_vehicle_ref'] = str(vehicle_id)
    refs = [{'kind': 'image', 'sha256': sha}]
    src = im.get('source') or {}
    if src.get('attachment_sha256'):
        refs.append({'kind': 'attachment', 'sha256': src['attachment_sha256']})
    if src.get('origin_key'):
        refs.append({'kind': 'source_message', 'origin_key': src['origin_key']})
    return {'kind': 'image_timeline_event', 'projection_key': key, 'source_privacy_hold': privacy, 'holds': sorted(set(holds)),
            'evidence_refs': refs, 'payload': payload}, None


# ------------------------------------------------------------------ labor reconciliation
def labor_item(cid, rec, res, photos, recon, doc_sha, revision_key, image_sha, origin_keys):
    """Claim, observation, holds, rate provenance and conflicts side by side. Never summed; never verified; no billable hours."""
    ids = photos.get('frames_in_scope_ids') or []
    missing = [i for i in ids if i not in image_sha]
    if missing:
        return None, f'{len(missing)} in-scope frame(s) have no image sha256: not persistable'
    held = dict(photos.get('held') or {})
    holds = {'unknown_clock': photos.get('offset_unknown_frames', 0), **held}
    clusters = [{'start': s['start'], 'end': s['end'], 'frames': len(s['images']), 'capped': s['capped'], 'single_frame': s['single_frame']}
                for s in photos.get('sessions') or []]
    observed = {'status': photos.get('status', 'not_supplied'), 'window': photos.get('window'),
                'observed_days': photos.get('observed_days') or [], 'observed_day_count': photos.get('observed_day_count', 0),
                'frames_in_scope': photos.get('frames_in_scope', 0), 'clusters': clusters,
                'camera_local_review': photos.get('camera_local_review'),
                'hours_lower': photos.get('hours_lower'), 'hours_lower_exact_seconds': photos.get('hours_lower_exact_seconds'),
                'note': photos.get('note')}
    flags = list(res['flags']) + [f for f in (recon or {}).get('flags', []) if f not in res['flags']]
    key = sha256_hex(canon(['labor_reconciliation', doc_sha, rec['claim']['economic_key']]))[:32]
    payload = {'reconciliation_key': key,
               'claim': {'claimed_hours': res['claimed_hours'], 'computed_labor': res['computed_labor'], 'source_claim': True,
                         'verified': False, 'service_period': res.get('service_period'), 'categories': res['rows']},
               'observed': observed, 'holds': holds,
               'rate_provenance': [{'category': r['category'], 'rate': r['rate'], 'rate_source': r['rate_source']} for r in res['rows']],
               'conflicts': flags, 'relation': (recon or {}).get('relation', 'not_assessable'),
               'additive': False, 'billable_hours': None, 'hours_verified': False}
    refs = [{'kind': 'attachment', 'sha256': doc_sha}] + [{'kind': 'source_message', 'origin_key': o} for o in sorted(origin_keys)] \
        + [{'kind': 'image', 'sha256': image_sha[i]} for i in ids]
    return {'kind': 'labor_reconciliation', 'projection_key': key, 'source_privacy_hold': False, 'holds': [],
            'evidence_refs': refs, 'payload': payload,
            'document_binding': {'original_sha256': doc_sha, 'revision_idempotency_key': revision_key}}, None


# ------------------------------------------------------------------ contract (mirrors the database; fails before any call)
def check_item(it):
    p = it.get('payload')
    if it.get('kind') not in KINDS or not KEY_RE.match(str(it.get('projection_key'))) or not isinstance(p, dict):
        raise ContractError('projection item has an unknown kind, key or payload')
    if set(it) - {'kind', 'projection_key', 'source_privacy_hold', 'holds', 'evidence_refs', 'payload', 'document_binding',
                  'financial_document_id'}:
        raise ContractError('projection item carries keys the writer does not accept')
    if not isinstance(it.get('source_privacy_hold'), bool) or not isinstance(it.get('holds'), list) or len(it['holds']) > 40 \
            or any(not isinstance(h, str) or len(h) > 80 for h in it['holds']):
        raise ContractError('invalid hold fields')
    refs = it.get('evidence_refs')
    if not isinstance(refs, list) or not 1 <= len(refs) <= MAX_REFS:
        raise ContractError('evidence refs must number 1..%d' % MAX_REFS)
    for r in refs:
        if r.get('kind') in ('image', 'attachment') and SHA_RE.match(str(r.get('sha256'))) and set(r) <= {'kind', 'sha256', 'origin_key'}:
            continue
        if r.get('kind') == 'source_message' and 0 < len(str(r.get('origin_key') or '')) <= 300 and set(r) <= {'kind', 'origin_key', 'rfc_message_id'}:
            continue
        if r.get('kind') == 'financial_document_revision':
            continue                      # resolved at apply from the live document; the database verifies scope
        raise ContractError('evidence ref is not an exact hash or message citation')
    bad = [k for k in _walk_keys(p) if k.lower() in FORBIDDEN or FORBIDDEN_RE.search(k.lower())]
    if bad or privacy_scan(p):
        raise ContractError(f'projection content refused: {bad or privacy_scan(p)[:3]}')
    if it['kind'] == 'image_timeline_event':
        if set(p) - IMAGE_KEYS or p.get('stance') != 'visual_observed' or p.get('completed_work_asserted') is not False \
                or p.get('assertion_status') not in ('observation_unverified', 'held') \
                or (p.get('capture') or {}).get('offset_state') not in ('known', 'unknown') \
                or (p.get('identity') or {}).get('state') not in ('confirmed', 'unconfirmed', 'context_only', 'unknown'):
            raise ContractError('image observation breaks the observation contract')
        if p['capture']['offset_state'] == 'unknown' and ('utc' in p['capture'] or 'utc' in (p.get('time') or {})):
            raise ContractError('an unknown camera offset cannot carry a UTC time')
        if (p['identity']['state'] != 'confirmed' or it['source_privacy_hold']) and p['assertion_status'] != 'held':
            raise ContractError('unconfirmed identity or privacy-held frames must stay held')
    else:
        if set(p) - LABOR_KEYS or not {'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive', 'hours_verified'} <= set(p) \
                or p['additive'] is not False or p['hours_verified'] is not False or p.get('billable_hours') is not None \
                or p['claim'].get('source_claim') is not True or p['claim'].get('verified') is not False \
                or not isinstance(p['holds'], dict) or not isinstance(p['observed'], dict):
            raise ContractError('labor projection breaks the claim-versus-observation contract')
        if not it.get('document_binding') and not it.get('financial_document_id'):
            raise ContractError('labor projection must bind to a financial document revision')


def item_hash(it):
    return sha256_hex(canon({k: v for k, v in it.items() if k != 'financial_document_id'}))


def plan(owner_id, run_clock, items, unpersistable, financial_changeset=None):
    parse_time(run_clock, 'run_clock', tz='required')
    seen = {}
    for it in items:
        check_item(it)
        if it['projection_key'] in seen:
            raise ContractError('duplicate projection key in one changeset')
        seen[it['projection_key']] = it
    items = sorted(items, key=lambda x: x['projection_key'])
    return {'schema': SCHEMA, 'mode': 'dry_run', 'owner_id': owner_id, 'producer': PRODUCER, 'method': METHOD, 'version': VERSION,
            'run_clock': run_clock, 'items': items, 'unpersistable': sorted(unpersistable, key=canon),
            'financial_changeset_sha256': mm.changeset_hash(financial_changeset) if financial_changeset else None,
            'writer': 'ingest-observation financial_evidence_v1 projection_submit -> public.ingest_private_work_projection',
            'posting': {'expense_posted': False, 'payment_posted': False, 'public_timeline_written': False},
            'prerequisites': ['financial_changeset_applied_first', 'backup_artifact', 'changeset_review']}


def validate_changeset(pcs, owner_id):
    if pcs.get('schema') != SCHEMA or pcs.get('mode') != 'dry_run':
        raise ContractError('not a dry-run private projection changeset')
    if pcs.get('owner_id') != owner_id:
        raise ContractError('projection changeset owner differs from the requested owner')
    if pcs.get('posting') != {'expense_posted': False, 'payment_posted': False, 'public_timeline_written': False}:
        raise ContractError('projection changeset may not carry a posting or a public write')
    if not pcs.get('items'):
        raise ContractError('projection changeset has no items')
    if (pcs.get('producer'), pcs.get('method'), pcs.get('version')) != (PRODUCER, METHOD, VERSION):
        raise ContractError('projection changeset is from a different producer/method/version')
    keys = [i['projection_key'] for i in pcs['items']]
    if len(set(keys)) != len(keys) or keys != sorted(keys):
        raise ContractError('projection keys repeated or unordered')
    for it in pcs['items']:
        check_item(it)


def batches(pcs):
    its = pcs['items']
    return [its[i:i + BATCH] for i in range(0, len(its), BATCH)]


def batch_key(pcs, batch):
    return 'pwp:' + sha256_hex(canon([pcs['owner_id'], PRODUCER, METHOD, VERSION, [item_hash(i) for i in batch]]))[:48]


# ------------------------------------------------------------------ backup / apply
def read_heads(transport, keys):
    heads = {}
    for i in range(0, len(keys), 100):
        for row in transport.projection_read(keys[i:i + 100]) or []:
            if row.get('superseded'):
                continue
            if row['projection_key'] in heads:
                raise ContractError('ambiguous projection head')
            heads[row['projection_key']] = row
    return heads


def head_summary(row):
    return None if row is None else {'id': row['id'], 'revision_no': row['revision_no'], 'content_digest': row['content_digest'],
                                     'source_privacy_hold': row['source_privacy_hold'], 'run_label': row['run_label']}


def make_backup(pcs, owner_id, transport, created_at):
    validate_changeset(pcs, owner_id)
    mm._aware_now(created_at)
    heads = read_heads(transport, [i['projection_key'] for i in pcs['items']])
    pre = {i['projection_key']: head_summary(heads.get(i['projection_key'])) for i in pcs['items']}
    art = {'schema': BACKUP_SCHEMA, 'owner_id': owner_id, 'changeset_sha256': mm.changeset_hash(pcs), 'created_at': created_at.isoformat(),
           'pre_state': pre, 'projections_existing': sum(1 for v in pre.values() if v), 'projections_absent': sum(1 for v in pre.values() if not v)}
    art['artifact_sha256'] = sha256_hex(canon(art))
    return art


def verify_backup(art, pcs, owner_id, now, max_age=timedelta(hours=24)):
    now = mm._aware_now(now)
    if not isinstance(art, dict) or art.get('schema') != BACKUP_SCHEMA:
        raise ContractError('not a projection backup artifact')
    if art.get('artifact_sha256') != sha256_hex(canon({k: v for k, v in art.items() if k != 'artifact_sha256'})):
        raise ContractError('backup artifact failed its integrity hash')
    if art['owner_id'] != owner_id or art['changeset_sha256'] != mm.changeset_hash(pcs):
        raise ContractError('backup artifact names a different owner or changeset')
    created, _ = parse_time(art['created_at'], 'backup.created_at', tz='required')
    if created > now + timedelta(minutes=5) or now - created > max_age:
        raise ContractError('backup artifact is from the future or older than the allowed age')
    if set(art['pre_state']) != {i['projection_key'] for i in pcs['items']}:
        raise ContractError('backup artifact does not cover exactly this changeset')


def resolve_binding(transport, binding, cache):
    sha, key = binding['original_sha256'], binding['revision_idempotency_key']
    if sha not in cache:
        cache[sha] = transport.read(sha)
    data = cache[sha]
    if not data:
        raise ContractError('the financial document is not held in this account; apply the financial changeset first')
    try:
        doc, runs = data['document'], data['document']['attributes']['runs']
    except (KeyError, TypeError):
        raise ContractError('unrecognised financial read response; refusing to guess')
    run = next((r for r in runs if r.get('key') == key), None)
    if not run or not doc.get('id'):
        raise ContractError('the financial revision this projection cites is not applied in this account')
    return {'kind': 'financial_document_revision', 'document_id': doc['id'], 'extraction_run_id': run['run_id'],
            'original_sha256': sha, 'revision_idempotency_key': key}, doc['id']


def _resolve(it, transport, cache):
    wire = {k: v for k, v in it.items() if k != 'document_binding'}
    if it.get('document_binding'):
        ref, doc_id = resolve_binding(transport, it['document_binding'], cache)
        wire['evidence_refs'] = list(it['evidence_refs']) + [ref]
        wire['financial_document_id'] = doc_id
    return wire


def apply(pcs, owner_id, art, transport, now):
    """Sequential, one batch per writer call; stops at the first refusal. Ledger: done / already_applied / failed / not_attempted."""
    validate_changeset(pcs, owner_id)
    verify_backup(art, pcs, owner_id, now)
    ledger = {'changeset_sha256': mm.changeset_hash(pcs), 'done': [], 'already_applied': [], 'failed': [], 'not_attempted': []}
    cache, bs = {}, batches(pcs)
    for n, batch in enumerate(bs):
        bkey = batch_key(pcs, batch)
        label = bkey[:20]
        try:
            heads = read_heads(transport, [i['projection_key'] for i in batch])
            if all(h and h['run_label'] == label for h in (heads.get(i['projection_key']) for i in batch)):
                ledger['already_applied'].append({'batch': bkey})
                continue
            wire_items = []
            for it in batch:
                head, pre = heads.get(it['projection_key']), art['pre_state'][it['projection_key']]
                if head_summary(head) != pre and not (head and head['run_label'] == label):
                    raise ContractError('live projection state differs from the backup; take a new backup')
                w = _resolve(it, transport, cache)
                if head:
                    w['supersedes_id'] = head['id']
                wire_items.append(w)
            rev = {'idempotency_key': bkey, 'producer': PRODUCER, 'method': METHOD, 'version': VERSION, 'run_label': label,
                   'projections': wire_items}
            res = transport.projection_submit({'mode': 'financial_evidence_v1', 'action': 'projection_submit', 'revision': rev})
            data = (res or {}).get('data') or {}
            if (res or {}).get('public_timeline_written') is not False or (res or {}).get('expense_posted') is not False \
                    or data.get('public_timeline_written') is not False or len(data.get('results') or []) != len(batch):
                raise ContractError('writer response is not a private projection receipt')
            ledger['done'].append({'batch': bkey, 'results': [{k: r[k] for k in ('projection_key', 'revision_no', 'status')} for r in data['results']]})
        except Exception as ex:   # any refusal stops the run
            ledger['failed'].append({'batch': bkey, 'reason': f'{type(ex).__name__}: {str(ex)[:300]}'})
            ledger['not_attempted'] = [batch_key(pcs, b) for b in bs[n + 1:]]
            break
    ledger['complete'] = not ledger['failed']
    return ledger

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
# Closed key sets per payload object. Mirrors public.private_work_allowed_keys (parity is tested against the migration).
ALLOWED_KEYS = {
    'image': {'event_key', 'stance', 'time', 'capture', 'identity', 'origin_class', 'intent', 'assertion_status',
              'completed_work_asserted', 'subject_vehicle_ref'},
    'image_time': {'kind', 'basis', 'camera_local', 'utc'},
    'image_capture': {'source', 'offset_state', 'camera_local', 'utc'},
    'image_identity': {'state', 'basis'},
    'labor': {'reconciliation_key', 'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive',
              'billable_hours', 'hours_verified'},
    'labor_claim': {'claimed_hours', 'computed_labor', 'source_claim', 'verified', 'service_period', 'categories'},
    'labor_category': {'category', 'hours', 'rate', 'amount', 'rate_source'},
    'labor_period': {'start', 'end'},
    'labor_observed': {'status', 'window', 'observed_days', 'observed_day_count', 'frames_in_scope', 'clusters',
                       'camera_local_review', 'hours_lower', 'hours_lower_exact_seconds', 'note'},
    'labor_cluster': {'start', 'end', 'frames', 'capped', 'single_frame'},
    'labor_local_review': {'clock_offset', 'days'},
    'labor_local_day': {'camera_local_day', 'frames', 'first_local', 'last_local'},
    'labor_holds': {'unknown_clock', 'other_vehicle', 'identity_not_confirmed', 'identity_context_only', 'excluded_origin',
                    'no_trusted_capture_time', 'implausible_clock', 'before_service_window', 'after_service_window',
                    'outside_vehicle_date_range', 'non_install_intent', 'intent_unclassified', 'intent_not_billable'},
    'labor_rate': {'category', 'rate', 'rate_source'},
}
# Keys whose value may be a nested object or array; every other value must be a JSON scalar (mirrors public.private_work_container_keys).
CONTAINER_KEYS = {
    'image': {'time', 'capture', 'identity'},
    'labor': {'claim', 'observed', 'holds', 'rate_provenance', 'conflicts'},
    'labor_claim': {'service_period', 'categories'},
    'labor_observed': {'window', 'observed_days', 'clusters', 'camera_local_review'},
    'labor_local_review': {'days'},
}
IBAN_SQL = re.compile(r'[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}')   # the database's private_work_payload_problem bank-identifier scan, exactly
IMAGE_KEYS, LABOR_KEYS = ALLOWED_KEYS['image'], ALLOWED_KEYS['labor']
REGISTERED_PRODUCERS = {(PRODUCER, METHOD, VERSION)}       # mirrors public.private_work_producer_registered
LABOR_STATUS = {'not_supplied', 'not_assessable', 'no_evidence', 'presence_only', 'review_camera_local_only', 'estimated_from_photos'}
LABOR_RELATION = {'not_assessable', 'no_hours', 'photo_lower_bound_exceeds_claim', 'photo_lower_bound_within_claim_not_corroboration_of_total'}
IMAGE_REQUIRED = ('event_key', 'stance', 'time', 'capture', 'identity', 'origin_class', 'intent', 'assertion_status', 'completed_work_asserted')
LABOR_REQUIRED = ('reconciliation_key', 'claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive', 'hours_verified')
VEHICLE_REF_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')   # an opaque, unverified pointer; never ownership
EMAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}')
# keys the database refuses anywhere in a payload (mirrors private_work_payload_problem)
FORBIDDEN = {'ocr_text', 'raw_text', 'full_text', 'full_ocr', 'body', 'body_text', 'html', 'snippet', 'iban', 'bank_iban', 'full_iban',
             'email', 'phone', 'person_name', 'image_bytes', 'photo', 'face', 'verified_hours', 'billable_hours_verified',
             'total_hours', 'combined_hours', 'sum_hours', 'payment_verified', 'ownership_verified', 'owner_verified',
             'vehicle_owner', 'co_owner', 'coowner'}
FORBIDDEN_RE = re.compile(r'(token|password|secret|authorization|cookie|credential|api_?key)')
CLAIM_AS_WORK_RE = re.compile(r'(actual|worked|paid|payment|billable|photo_hours)')   # no key may present a claim as hours worked or paid


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
def _review(r):
    """The camera-local review carries no hours of any kind: its null billable_hours marker is dropped, not stored."""
    return None if r is None else {k: v for k, v in r.items() if k != 'billable_hours'}


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
                'camera_local_review': _review(photos.get('camera_local_review')),
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
    scanned = {k: v for k, v in p.items() if k != 'billable_hours'}      # top-level billable_hours is contract-checked (null only) below
    bad = [k for k in _walk_keys(scanned) if k.lower() in FORBIDDEN or FORBIDDEN_RE.search(k.lower()) or CLAIM_AS_WORK_RE.search(k.lower())]
    if bad or privacy_scan(p):
        raise ContractError(f'projection content refused: {bad or privacy_scan(p)[:3]}')
    if privacy_scan(it['holds']) or _sql_text_problem(it['holds']):
        raise ContractError('projection content refused: a hold looks like a bank identifier, e-mail address or raw text')
    for r in refs:
        if r.get('kind') == 'source_message' and EMAIL_RE.search(str(r.get('origin_key'))):
            raise ContractError('a source message origin key looks like an e-mail address; account_ref must be an opaque namespace without "@"')
    for r in refs:
        # same scan as the database: every ref string for bank shape; an RFC Message-ID looks like an address and is exempt from e-mail only
        if any(_sql_text_problem([v], email=(k != 'rfc_message_id')) for k, v in r.items() if isinstance(v, str)):
            raise ContractError('projection content refused: an evidence ref looks like a bank identifier or e-mail address')
    if it['kind'] == 'image_timeline_event':
        _check_image(it, p)
    else:
        _check_labor(it, p)


def _within(o, name):
    """Closed key set AND scalar leaves: only the named containers may be objects or lists (mirrors private_work_closed_scalar)."""
    return isinstance(o, dict) and set(o) <= ALLOWED_KEYS[name] \
        and all(isinstance(v, (str, int, float, bool, type(None))) for k, v in o.items() if k not in CONTAINER_KEYS.get(name, ()))


def _sql_text_problem(strings, email=True):
    """The database's string scan (bank identifier, e-mail address, oversized text), run at plan time so a dry run cannot pass
    what apply would refuse."""
    for t in strings:
        if len(t) > 500 or IBAN_SQL.search(t) or (email and EMAIL_RE.search(t)):
            return True
    return False


def _is(o, key, value):
    return key in o and o[key] is value if isinstance(value, bool) else (key in o and o[key] == value)


def _check_image(it, p):
    bad = ContractError('image observation breaks the observation contract')
    if not _within(p, 'image'):
        raise ContractError('image timeline payload has unknown keys')
    cap, ident, tm = p.get('capture'), p.get('identity'), p.get('time')
    if not all(k in p for k in IMAGE_REQUIRED) or p['stance'] != 'visual_observed' or p['completed_work_asserted'] is not False \
            or not all(isinstance(p[k], str) for k in ('event_key', 'origin_class', 'intent', 'assertion_status')) \
            or p['assertion_status'] not in ('observation_unverified', 'held') \
            or not _within(ident, 'image_identity') or ident.get('state') not in ('confirmed', 'unconfirmed', 'context_only', 'unknown') \
            or not _within(cap, 'image_capture') or 'source' not in cap or cap.get('offset_state') not in ('known', 'unknown') \
            or not _within(tm, 'image_time') or tm.get('kind') not in ('instant', 'unknown'):
        raise bad
    off = cap['offset_state']
    if off == 'unknown' and ('utc' in cap or 'utc' in tm):
        raise ContractError('an unknown camera offset cannot carry a UTC time')
    if off == 'known' and not ('camera_local' in cap and isinstance(cap.get('utc'), str)):
        raise bad
    if 'utc' in tm and off != 'known':
        raise ContractError('an unknown camera offset cannot carry a UTC time')
    if (ident['state'] != 'confirmed' or it['source_privacy_hold'] is not False) and p['assertion_status'] != 'held':
        raise ContractError('unconfirmed identity or privacy-held frames must stay held')
    if 'subject_vehicle_ref' in p and not (isinstance(p['subject_vehicle_ref'], str) and VEHICLE_REF_RE.match(p['subject_vehicle_ref'])
                                          and p['assertion_status'] == 'observation_unverified'):
        raise bad


def _check_labor(it, p):
    bad = ContractError('labor projection breaks the claim-versus-observation contract')
    if not _within(p, 'labor'):
        raise ContractError('labor payload has unknown keys')
    claim, obs, holds = p.get('claim'), p.get('observed'), p.get('holds')
    if not all(k in p for k in LABOR_REQUIRED) or not isinstance(p['reconciliation_key'], str) \
            or p['additive'] is not False or p['hours_verified'] is not False \
            or ('billable_hours' in p and p['billable_hours'] is not None) \
            or not _within(claim, 'labor_claim') or claim.get('source_claim') is not True or claim.get('verified') is not False \
            or not isinstance(claim.get('claimed_hours'), str) \
            or not _within(obs, 'labor_observed') or obs.get('status') not in LABOR_STATUS \
            or not _within(holds, 'labor_holds') or not all(type(v) in (int, float) for v in holds.values()) \
            or not isinstance(p['rate_provenance'], list) or not isinstance(p['conflicts'], list) or p['relation'] not in LABOR_RELATION:
        raise bad
    if claim.get('service_period') is not None and not _within(claim['service_period'], 'labor_period'):
        raise bad
    cats = claim.get('categories', [])
    if not isinstance(cats, list) or len(cats) > 60 or not all(_within(c, 'labor_category') for c in cats):
        raise bad
    if len(p['rate_provenance']) > 60 or len(p['conflicts']) > 100 or not all(_within(r, 'labor_rate') for r in p['rate_provenance']) \
            or not all(isinstance(c, str) for c in p['conflicts']):
        raise bad
    if obs.get('window') is not None and not _within(obs['window'], 'labor_period'):
        raise bad
    days = obs.get('observed_days', [])
    if not isinstance(days, list) or len(days) > 400 or not all(isinstance(d, str) for d in days):
        raise bad
    clusters = obs.get('clusters', [])
    if not isinstance(clusters, list) or len(clusters) > 400 or not all(_within(c, 'labor_cluster') for c in clusters):
        raise bad
    rev = obs.get('camera_local_review')
    if rev is not None and not (_within(rev, 'labor_local_review') and isinstance(rev.get('days'), list) and len(rev['days']) <= 400
                                and all(_within(d, 'labor_local_day') for d in rev['days'])):
        raise bad
    if (obs.get('hours_lower') is not None or obs.get('hours_lower_exact_seconds') is not None) and obs['status'] != 'estimated_from_photos':
        raise bad
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

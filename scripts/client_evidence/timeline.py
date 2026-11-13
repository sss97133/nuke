"""Timeline projection from cited source claims and retained images.

Events are PRIVATE derived cells (they ride on the source document's financial_evidence_v1 revision, private tier). They are
never published to the public vehicle timeline_events / work_sessions tables: `publish()` always refuses (see docs).
Identity is stable across edits (citation + stance, never the title), so a changed projection supersedes the old one with a
real `supersedes` pointer and the old row is kept. Time is only what a source says; unknown stays unknown."""
from common import ContractError, canon, parse_time, sha256_hex

PRODUCER, VERSION = 'client_timeline_projector', '2026-11-07b'
STANCES = {'plan', 'quote', 'promise', 'reported_work', 'reported_completion', 'status_inquiry', 'payment_request',
           'payment_assertion', 'document_issued', 'visual_observed'}
CLOCKS = ('sent_at', 'document_date', 'service_period_start', 'service_period_end', 'capture_time')
TRUSTED_CAPTURE = ('exif_original', 'trusted_capture_claim')
EXCLUDED_ORIGINS = {'personal', 'misattributed', 'unresolved', 'review_needed', 'privacy_hold', 'protected', 'person'}
# claim kind -> stance. A quote, request or report is never completed work or verified payment.
KIND_STANCE = {'estimate_quote': 'quote', 'invoice_claim': 'document_issued', 'customer_billed': 'document_issued',
               'supplier_cost': 'document_issued', 'balance': 'document_issued', 'deposit': 'payment_assertion',
               'payment_request': 'payment_request', 'payment_assertion': 'payment_assertion',
               'labor_claim': 'reported_work', 'work_report': 'reported_work', 'completion_report': 'reported_completion'}
MAX_CELL_BYTES = 3500


def publish(*_a, **_k):
    """Refused by design: the public timeline/work_sessions rows are readable with the vehicle; client invoice and
    messaging facts need an owner-private store with its own writer (not minted here)."""
    raise ContractError('publication refused: public timeline_events/work_sessions cannot protect client invoice or '
                        'messaging facts; use the private revision cells or a sanctioned owner-private projection store')


def _date_ok(v, field):
    parse_time(v, field)      # raises on anything that is not ISO-8601 (dates or datetimes)
    return v


def _time(src):
    """Event time from the source's own work/document clock. sent_at and ingest/import clocks never stand in for it."""
    s, e = src.get('service_period_start'), src.get('service_period_end')
    if s and e:
        ds, de = parse_time(s, 'service_period_start')[0], parse_time(e, 'service_period_end')[0]
        if ds.tzinfo is None and de.tzinfo is None or ds.tzinfo and de.tzinfo:
            if ds > de:
                raise ContractError('service period ends before it starts')
        return {'kind': 'interval', 'start': s, 'end': e, 'basis': 'service_period'}
    if src.get('capture_time'):
        cap = src.get('capture_source')
        if cap not in TRUSTED_CAPTURE:
            raise ContractError(f'capture_time needs capture_source in {TRUSTED_CAPTURE}')
        _, aware = parse_time(src['capture_time'], 'capture_time')
        return {'kind': 'instant', 'start': src['capture_time'], 'end': src['capture_time'], 'basis': 'trusted_capture_time',
                'clock_offset': 'known' if aware else 'unknown', 'utc_known': aware}
    if src.get('document_date') and src['stance'] in ('document_issued', 'payment_request', 'quote', 'plan'):
        _date_ok(src['document_date'], 'document_date')
        return {'kind': 'instant', 'start': src['document_date'], 'end': src['document_date'], 'basis': 'document_date'}
    if src.get('not_before') or src.get('not_after'):
        for k in ('not_before', 'not_after'):
            if src.get(k):
                _date_ok(src[k], k)
        return {'kind': 'interval', 'start': src.get('not_before'), 'end': src.get('not_after'), 'basis': 'bounded_by_source'}
    return {'kind': 'unknown', 'start': None, 'end': None, 'basis': 'no_work_date_in_source'}


def event_from_source(src, run_id):
    if src.get('stance') not in STANCES:
        raise ContractError(f"stance must be one of {sorted(STANCES)}")
    cite = src.get('citation') or {}
    exact_doc = bool(cite.get('origin_key')) and (isinstance(cite.get('page'), int) or bool(cite.get('locator')))
    if not (exact_doc or cite.get('image_id')):
        raise ContractError('every event cites an exact message/attachment page (or locator) or an image identity')
    for k in ('sent_at', 'document_date', 'service_period_start', 'service_period_end'):
        if src.get(k):
            _date_ok(src[k], k)
    ev = {'stance': src['stance'], 'title': str(src['title'])[:200], 'time': _time(src), 'citation': cite,
          'clocks': {k: src.get(k) for k in CLOCKS if src.get(k)},      # kept side by side, none promoted
          'producer': {'name': PRODUCER, 'version': VERSION, 'run_id': run_id}, 'completed_work_asserted': False,
          'assertion_status': 'source_claim_unverified'}
    # identity = where it is cited + stance. A title/time edit is a new revision of the same event, not a new event.
    ident = [cite.get('sha256') or cite.get('origin_key'), cite.get('page'), cite.get('line'), cite.get('locator'), cite.get('image_id'),
             src.get('claim_key'), src['stance']]
    ev['event_key'] = sha256_hex(canon(ident))[:32]
    ev['content_hash'] = sha256_hex(canon([ev['title'], ev['time'], ev['clocks'], ev['stance'], cite]))[:32]
    if len(canon(ev)) > MAX_CELL_BYTES:
        raise ContractError('timeline event exceeds the private cell size')
    return ev


def events_from_claims(sha, origins, claim_recs, run_id):
    """Cited timeline events straight from a document's claim records (no hand-built dicts). Identity is the bytes + page +
    line + claim + stance, so a forward adds citations to the same event instead of minting a second one.
    origins: [{origin_key, sent_at}] sorted; claim_recs: [{claim, citations}]."""
    out = []
    for rec in claim_recs:
        c = rec['claim']
        stance = KIND_STANCE.get(c['kind'])
        if not stance:
            continue
        first = rec['citations'][0]
        src = {'stance': stance, 'title': c.get('summary') or f"{c['kind']} {c['economic_key']}",
               'claim_key': f"{c['kind']}:{c['economic_key']}",
               'citation': {'sha256': sha, 'origin_key': first['origin_key'], 'origins': [x['origin_key'] for x in rec['citations']],
                            'page': c['citation']['page'], 'line': c['citation'].get('line')},
               'sent_at': min(o['sent_at'] for o in origins if o['origin_key'] in {x['origin_key'] for x in rec['citations']}),
               **{k: c.get(k) for k in ('document_date', 'service_period_start', 'service_period_end') if c.get(k)}}
        out.append(event_from_source(src, run_id))
    return out


def event_from_image(im, run_id):
    """A retained image yields a visual observation only with confirmed (non-contextual) identity and an in-scope origin.
    Its time is its trusted capture time with the offset state explicit, or unknown."""
    if im.get('identity') != 'confirmed' or im.get('identity_basis') == 'context' \
            or im.get('origin') in EXCLUDED_ORIGINS or im.get('privacy_hold'):
        return None
    cap = im.get('capture') if (im.get('capture') or {}).get('source') in TRUSTED_CAPTURE else None
    return event_from_source({'stance': 'visual_observed', 'title': f"retained image {im['image_id']}",
                              'capture_time': cap and cap['at'], 'capture_source': cap and cap['source'],
                              'citation': {'image_id': im['image_id'], 'image_sha256': im.get('sha256')}}, run_id)


def project(events, run_id, prior=()):
    """events: already-built event dicts. Returns {events, supersessions}. A prior row with the same stable key and a
    different content hash is superseded (kept) and the new event carries `supersedes`; identical ones are left alone
    (replay is idempotent); prior rows no longer derived are marked superseded with no replacement. Nothing is deleted."""
    cur = {}
    for e in events:
        cur[e['event_key']] = e
    prior_by_key = {p['event_key']: p for p in prior if not p.get('superseded_by')}
    new, sup = [], []
    for k, e in cur.items():
        p = prior_by_key.get(k)
        if p and p['content_hash'] == e['content_hash']:
            continue
        if p:
            e = {**e, 'supersedes': {'event_key': k, 'content_hash': p['content_hash'], 'run_id': p['producer']['run_id']}}
            sup.append({'event_key': k, 'superseded_content_hash': p['content_hash'], 'superseded_by_run': run_id,
                        'action': 'mark_superseded_keep_row'})
        new.append(e)
    for k, p in prior_by_key.items():
        if k not in cur:
            sup.append({'event_key': k, 'superseded_content_hash': p['content_hash'], 'superseded_by_run': run_id,
                        'action': 'mark_superseded_keep_row', 'replacement': None})
    return {'mode': 'dry_run', 'events': new, 'supersessions': sup, 'deletions': []}

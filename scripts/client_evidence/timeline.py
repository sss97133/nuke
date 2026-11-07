"""Timeline projection from cited source claims and retained images. Derived rows are append-only: a changed projection
supersedes the old one (kept, marked) and is never deleted. Time is only what a source says; unknown stays unknown."""
from common import ContractError, canon, sha256_hex

PRODUCER, VERSION = 'client_timeline_projector', '2026-11-07'
# Stance keeps a plan, quote, promise or report from reading as completed work.
STANCES = {'plan', 'quote', 'promise', 'reported_work', 'reported_completion', 'status_inquiry', 'payment_request',
           'payment_assertion', 'document_issued', 'visual_observed'}
CLOCKS = ('sent_at', 'document_date', 'service_period_start', 'service_period_end', 'capture_time')


def _time(src):
    """Event time from the source's own work/document clock. sent_at and ingest/import clocks never stand in for it."""
    s, e = src.get('service_period_start'), src.get('service_period_end')
    if s and e:
        return {'kind': 'interval', 'start': s, 'end': e, 'basis': 'service_period'}
    if src.get('capture_time'):
        return {'kind': 'instant', 'start': src['capture_time'], 'end': src['capture_time'], 'basis': 'trusted_capture_time'}
    if src.get('document_date') and src['stance'] in ('document_issued', 'payment_request', 'quote', 'plan'):
        return {'kind': 'instant', 'start': src['document_date'], 'end': src['document_date'], 'basis': 'document_date'}
    if src.get('not_before') or src.get('not_after'):
        return {'kind': 'interval', 'start': src.get('not_before'), 'end': src.get('not_after'), 'basis': 'bounded_by_source'}
    return {'kind': 'unknown', 'start': None, 'end': None, 'basis': 'no_work_date_in_source'}


def event_from_source(src, run_id):
    if src.get('stance') not in STANCES:
        raise ContractError(f"stance must be one of {sorted(STANCES)}")
    cite = src.get('citation') or {}
    exact_doc = bool(cite.get('origin_key')) and (isinstance(cite.get('page'), int) or bool(cite.get('locator')))
    if not (exact_doc or cite.get('image_id')):
        raise ContractError('every event cites an exact message/attachment page (or locator) or an image identity')
    ev = {'stance': src['stance'], 'title': src['title'][:200], 'time': _time(src), 'citation': cite,
          'clocks': {k: src.get(k) for k in CLOCKS if src.get(k)},      # kept side by side, none promoted
          'producer': {'name': PRODUCER, 'version': VERSION, 'run_id': run_id}, 'completed_work_asserted': False}
    ev['event_key'] = sha256_hex(canon([cite, src['stance'], src['title']]))[:32]
    ev['content_hash'] = sha256_hex(canon([ev['time'], ev['clocks'], ev['stance']]))[:32]
    return ev


def event_from_image(im, run_id):
    """A retained image yields a visual observation, only with confirmed identity; its time is its trusted capture time or unknown."""
    if im.get('identity') != 'confirmed' or im.get('origin') in {'personal', 'misattributed', 'unresolved', 'privacy_hold', 'protected'}:
        return None
    cap = im.get('capture') if (im.get('capture') or {}).get('source') in ('exif_original', 'trusted_capture_claim') else None
    return event_from_source({'stance': 'visual_observed', 'title': f"retained image {im['image_id']}",
                              'capture_time': cap and cap['at'], 'citation': {'image_id': im['image_id'], 'image_sha256': im.get('sha256')}}, run_id)


def project(sources, images, run_id, prior=()):
    """Return {events, supersessions}. Prior events with the same key and a different content hash, or no longer derived,
    are superseded (kept); identical ones are left alone, so a replay is idempotent."""
    events = {}
    for s in sources:
        e = event_from_source(s, run_id)
        events[e['event_key']] = e
    for im in images:
        e = event_from_image(im, run_id)
        if e:
            events[e['event_key']] = e
    prior_by_key = {p['event_key']: p for p in prior if not p.get('superseded_by')}
    new, sup = [], []
    for k, e in events.items():
        p = prior_by_key.get(k)
        if p and p['content_hash'] == e['content_hash']:
            continue
        new.append(e)
        if p:
            sup.append({'event_key': k, 'superseded_run': p['producer']['run_id'], 'superseded_by_run': run_id, 'action': 'mark_superseded_keep_row'})
    for k, p in prior_by_key.items():
        if k not in events:
            sup.append({'event_key': k, 'superseded_run': p['producer']['run_id'], 'superseded_by_run': run_id, 'action': 'mark_superseded_keep_row'})
    return {'mode': 'dry_run', 'events': new, 'supersessions': sup, 'deletions': []}

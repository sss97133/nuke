"""Connector manifest -> financial envelopes -> cited timeline cells -> invoice/labor reconciliation, in one dry-run.

Persisted (only through the private financial_evidence_v1 revision of the SOURCE document): origins, claims, lines, concerns,
timeline events derived from that document's claims, and labor source-claim arithmetic. Local only (printed, never written):
image-derived events, camera-clock review and invoice-vs-photo reconciliation in the printed fields below. The SAME content is
also planned as a separate owner-private projection changeset (projection.py -> public.private_work_projections) when every
frame carries an exact sha256; the public timeline/work_sessions tables are never written."""
from common import ContractError, canon, dec, sha256_hex
import mail_manifest as mm, timeline, labor, projection


def _cell_event(ev):
    norm = {**ev, 'producer': {k: v for k, v in ev['producer'].items() if k != 'run_id'}}   # run id is not content
    return mm._cell(f"timeline.{ev['event_key'][:16]}", f"{ev['stance']}:{ev['event_key']}", norm)


def labor_input(rec):
    c, lab = rec['claim'], rec['claim'].get('labor') or {}
    start, end = c.get('service_period_start'), c.get('service_period_end')
    on = start or c.get('document_date')
    return {'categories': [{'name': x['name'], 'hours': x['hours'], **({'rate': x['rate']} if x.get('rate') is not None else {})}
                           for x in lab['categories']],
            'claimed_total_hours': lab.get('claimed_total_hours'), 'stated_labor_amount': lab.get('stated_labor_amount'),
            'as_of': on[:10] if on else None, 'service_period': {'start': start, 'end': end} if start and end else None}


def build(manifest, owner_id, run_clock, rates=(), images=(), vehicle_id=None, current_rate=None, vehicle_range=None):
    run_id = 'run:' + sha256_hex(canon([owner_id, run_clock]))[:16]
    labor_results = {}

    def extras(sha, edges, recs):
        origins = [{'origin_key': e['origin_key'], 'sent_at': e['sent_at']} for e in edges]
        cells = [_cell_event(ev) for ev in timeline.events_from_claims(sha, origins, recs, run_id)]
        for r in recs:
            if r['claim']['kind'] == 'labor_claim':
                res = labor.invoice_labor(labor_input(r), list(rates), current_rate)
                labor_results[r['cid']] = (r, res, sha, [e['origin_key'] for e in edges])
                cells.append(mm._cell(f"labor.{r['cid']}", f"labor_claim:{r['claim']['economic_key']}",
                                      {**res, 'citations': r['citations'], 'assertion_status': 'claim_unverified'}))
        return cells

    cs = mm.plan(manifest, owner_id, run_clock, extras)
    recon = []
    for cid, (r, res, _sha, _origins) in sorted(labor_results.items()):
        inp = labor_input(r)
        entry = {'claim_id': cid, 'economic_key': r['claim']['economic_key'], 'invoice': res}
        if not images:
            entry['photos'] = {'status': 'not_supplied'}
        elif not inp['service_period'] or not vehicle_id:
            entry['photos'] = {'status': 'not_assessable', 'reason': 'service period or vehicle id missing; photos are never windowed by guess'}
        else:
            ph = labor.photo_sessions(list(images), vehicle_id, {'start': inp['service_period']['start'], 'end': inp['service_period']['end']},
                                      vehicle_range=vehicle_range)
            entry['photos'] = ph
            entry['reconciliation'] = labor.reconcile(res, ph, (r['claim'].get('labor') or {}).get('claimed_days'))
        recon.append(entry)
    img_events = [e for e in (timeline.event_from_image(i, run_id) for i in images) if e]
    pcs, unpersistable = _projection(cs, owner_id, run_clock, images, vehicle_id, labor_results, recon)
    return {'changeset': cs, 'labor_reconciliation': recon, 'local_image_events': img_events,
            'private_projection_changeset': pcs, 'private_projection_unpersistable': unpersistable,
            'publication': 'refused: public timeline_events/work_sessions are not written; image and labor projections go only to the private store',
            'persisted_only_via': 'private financial_evidence_v1 revision cells (source claims) and, after the financial changeset is applied, '
                                  'the owner-private projection store (image observations, labor reconciliation)'}


def _projection(cs, owner_id, run_clock, images, vehicle_id, labor_results, recon):
    """Private projection items for every retained image and every reconciled labor claim. A frame without an exact sha256 is
    reported, never guessed."""
    if not images:
        return None, [{'reason': 'no images supplied: nothing observed to project'}]
    items, skipped = [], []
    image_sha = {str(i['image_id']): i['sha256'] for i in images if isinstance(i.get('sha256'), str)}
    for im in images:
        it, why = projection.image_item(im, vehicle_id)
        if it:
            items.append(it)
        else:
            skipped.append({'kind': 'image_timeline_event', 'image_id': str(im.get('image_id')), 'reason': why})
    revkeys = {e['original']['sha256']: e['revision']['idempotency_key'] for e in cs['envelopes']}
    by_cid = {e['claim_id']: e for e in recon}
    for cid, (r, res, sha, origins) in sorted(labor_results.items()):
        e = by_cid[cid]
        if 'reconciliation' not in e and e['photos'].get('status') in ('not_supplied', 'not_assessable'):
            skipped.append({'kind': 'labor_reconciliation', 'claim_id': cid, 'reason': e['photos'].get('reason') or 'photos not supplied'})
            continue
        it, why = projection.labor_item(cid, r, res, e['photos'], e.get('reconciliation'), sha, revkeys[sha], image_sha, origins)
        if it:
            items.append(it)
        else:
            skipped.append({'kind': 'labor_reconciliation', 'claim_id': cid, 'reason': why})
    if not items:
        return None, skipped
    return projection.plan(owner_id, run_clock, items, skipped, cs), skipped

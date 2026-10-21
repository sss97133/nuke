"""Custody bounds (pass custody_bounds): an upper bound on the acquisition of a vehicle that no source dates, so its
reads say "acquired by" instead of nothing (v3, ET2-6; v4, ET3-3; v5).

For each vehicle the case lists (default: the case vehicle) with no acquisition claim from another pass on its
identity (the writer writes nothing where a sourced, not rejected acquisition exists): one acquisition claim with
occurred_to = its first own-photo day, no occurred_from and confidence at most 0.5, with the first day's photos as
date support. The first own photo can be a pre-purchase visit, so it is never the acquisition date: custody then
reads 'unknown' with acquired_by, and work_days 'unknown'. Days whose photos carry a pre-acquisition flag (a yard
visit, a seller's camera) or a third-party class do not count. It never proposes a sale (a truck he still owns is not
sold); sale windows come only from sources (a listing end, a sold message, a deal document).
"""
import common
import passlib
import payloads

PASSES = ['custody_bounds']
MAX_CONFIDENCE = 0.5


def first_own_day(built, vehicle, skip_flags):
    best = {}
    for p in ('combined', 'photos_album'):
        for ln in built.candidates(p):
            r = ln['row']
            if r.get('vehicle_id') != vehicle or r.get('verdict') != 'is_vehicle' or \
                    r.get('image_class', 'own') != 'own' or r.get('frame_role', 'subject') != 'subject':
                continue
            if any(e.get('kind') == 'flag' and e.get('ref') in skip_flags for e in r.get('evidence') or []):
                continue
            d = r.get('pass_captured_on')
            if d:
                best.setdefault(d, []).append(ln)
    if not best:
        return None, []
    d = min(best)
    return d, best[d]


def identity_of(built, vehicle):
    """The vehicle and every vehicle a same_vehicle_as claim built this run pairs it with (proposed or not: the
    writer checks the stored identity set; a sourced acquisition on either profile keeps this pass out)."""
    ids, grew = {vehicle}, True
    while grew:
        grew = False
        for c in built.claims():
            p = c['p_claim']
            if p['kind'] == 'same_vehicle_as' and ({p.get('vehicle_id'), p.get('related_vehicle_id')} & ids) and \
                    not {p.get('vehicle_id'), p.get('related_vehicle_id')} <= ids:
                ids |= {p.get('vehicle_id'), p.get('related_vehicle_id')}
                grew = True
    return ids


def build(ctx, built):
    cfg = ctx.pass_cfg('custody_bounds')
    if cfg is None or cfg == {} and not ctx.case.get('vehicle'):
        return {}
    if cfg.get('claims'):
        raise common.EvidenceError('custody_bounds proposes only acquisition upper bounds from photos; declare dated '
                                   'acquisition and sale claims under the pass whose source dates them (deal_document)')
    vehicles = [ctx.vid(v) for v in cfg.get('vehicles') or [ctx.case.get('vehicle')] if v]
    skip = set(cfg.get('skip_flags') or ['pre_acquisition_yard_visit', 'seller_camera_pre_acquisition'])
    conf = min(cfg.get('confidence', 0.3), MAX_CONFIDENCE)
    n, held = 0, []
    for v in vehicles:
        ident = identity_of(built, v)
        has_acq = any(c['p_claim'].get('vehicle_id') in ident and c['p_claim']['kind'] == 'acquisition'
                      and c.get('p_run_id') != '@run:custody_bounds' for c in built.claims())
        if has_acq:
            held.append('%s: a sourced acquisition claim exists; nothing proposed' % v[:8])
            continue
        day, lines = first_own_day(built, v, skip)
        if not day:
            held.append('%s: no own photo day; custody stays unknown' % v[:8])
            continue
        lines.sort(key=lambda ln: ln['row']['image_id'])
        picks = passlib._pick(lines, 'first_middle_last')
        sup = [payloads.support('image_candidate', payloads.key_ref(ln['key']), 'supports', 'date',
                                'first own photo day: acquired by then') for ln in picks]
        key = passlib.claim_key(built, 'acquisition', v)
        built.add('change_claims.jsonl', payloads.claim_line(key, 'custody_bounds', payloads.change_claim(
            v, 'custody', 'acquisition', 'acquired by the first own photo day (upper bound)', conf,
            occurred_to=day), sup))
        n += 1
    for h in held:
        ctx.note('custody_bounds: ' + h)
    return {'custody_bounds': {'emitted': n, 'config': {
        'rule': 'acquisition upper bound = first own-photo day (occurred_to only, confidence <= 0.5) for a vehicle '
                'with no sourced acquisition; never a sale', 'skip_flags': sorted(skip)},
        'counts': {'claims': n, 'held': held}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)

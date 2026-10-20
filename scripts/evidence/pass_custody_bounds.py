"""Custody bounds (pass custody_bounds): an acquisition window for a vehicle that has none, so work_days can be
computed (proposed) instead of reading "unknown" (v3, ET2-6).

For each vehicle the case lists (default: the case vehicle) with no acquisition claim built this run: one acquisition
claim on its first own-photo day (from..to = that day; a NULL start would leave every day 'custody unknown'), with the
first day's photos as date support, at low confidence. Days whose photos carry a pre-acquisition flag (a yard visit,
a seller's camera) or a third-party class do not count. It never proposes a sale from a last photo (a truck he still
owns is not sold); sale windows come only as declared claims with their support (a listing end, a sold message).
"""
import passlib
import payloads

PASSES = ['custody_bounds']


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


def build(ctx, built):
    cfg = ctx.pass_cfg('custody_bounds')
    if cfg is None or cfg == {} and not ctx.case.get('vehicle'):
        return {}
    vehicles = [ctx.vid(v) for v in cfg.get('vehicles') or [ctx.case.get('vehicle')] if v]
    skip = set(cfg.get('skip_flags') or ['pre_acquisition_yard_visit', 'seller_camera_pre_acquisition'])
    n, held = 0, []
    for v in vehicles:
        has_acq = any(c['p_claim']['vehicle_id'] == v and c['p_claim']['kind'] == 'acquisition' for c in built.claims())
        if has_acq:
            held.append('%s: acquisition claim present; nothing proposed' % v[:8])
            continue
        day, lines = first_own_day(built, v, skip)
        if not day:
            held.append('%s: no own photo day; custody stays unknown' % v[:8])
            continue
        lines.sort(key=lambda ln: ln['row']['image_id'])
        picks = passlib._pick(lines, 'first_middle_last')
        sup = [payloads.support('image_candidate', payloads.key_ref(ln['key']), 'supports', 'date',
                                'first own photo day') for ln in picks]
        key = passlib.claim_key(built, 'acquisition', v)
        built.add('change_claims.jsonl', payloads.claim_line(key, 'custody_bounds', payloads.change_claim(
            v, 'custody', 'acquisition', 'in custody by the first own photo day', cfg.get('confidence', 0.3),
            occurred_from=day, occurred_to=day), sup))
        n += 1
    for c in cfg.get('claims') or []:
        n += passlib.declared_claims(ctx, built, 'custody_bounds', [c])
    for h in held:
        ctx.note('custody_bounds: ' + h)
    return {'custody_bounds': {'emitted': n, 'config': {
        'rule': 'acquisition window = first own-photo day for a vehicle with no acquisition claim; no sale from photos',
        'skip_flags': sorted(skip)}, 'counts': {'claims': n, 'held': held}}}


if __name__ == '__main__':
    passlib.pass_main(PASSES, __doc__)

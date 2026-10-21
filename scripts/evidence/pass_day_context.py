"""Pass 6 (day_context): the floor set per (owner, local day, place cluster, vehicle): which truck the owner was with.

From the vehicle's Photos album items inside its custody window: one row per day and place cluster (a day with
located items ignores its unlocated ones). Basis: album_items_that_day and custody_window, plus open_change_claim
when an acquisition or sale claim's window covers the day and work_session when a session exists that day. The
custody window is the case's, else the vehicle's best acquisition and sale claims built this run.
Extra days come from the case (yard visits before acquisition: basis proposed_photo_that_day when a photo of the
vehicle was proposed that day, gps_place_match when only the place matches; v3 FM-9).
Place clusters are labels; coordinates stay in the local case.
"""
import collections

import inputs
import payloads

PASSES = ['day_context']


def custody_from_claims(built, vehicle):
    best = {}
    for ln in built.claims():
        c = ln['p_claim']
        if c['vehicle_id'] == vehicle and c['kind'] in ('acquisition', 'sale'):
            if c['kind'] not in best or c['confidence'] > best[c['kind']]['confidence']:
                best[c['kind']] = c
    a, s = best.get('acquisition'), best.get('sale')
    return {'from': a.get('occurred_from') if a else None,
            'to': (s.get('occurred_to') or s.get('occurred_from')) if s else None}


def build(ctx, built):
    cfg = ctx.pass_cfg('day_context')
    if not cfg:
        return {}
    vehicle = ctx.vid(cfg['vehicle'])
    custody = cfg.get('custody') or custody_from_claims(built, vehicle)
    windows = [(c['p_claim'].get('occurred_from'), c['p_claim'].get('occurred_to') or c['p_claim'].get('occurred_from'))
               for c in built.claims() if c['p_claim']['vehicle_id'] == vehicle
               and c['p_claim']['kind'] in ('acquisition', 'sale') and c['p_claim'].get('occurred_from')]
    sessions = inputs.session_by_day(ctx)
    days = collections.defaultdict(collections.Counter)
    for it in inputs.album_items(ctx):
        days[it['date'][:10]][inputs.place_cluster(ctx, it.get('lat'), it.get('lon'))] += 1
    lo, hi = custody.get('from'), custody.get('to') or '9999-12-31'
    n = 0
    for d in sorted(days):
        if not lo or not (lo <= d <= hi):
            continue
        for cl, _k in sorted(days[d].items()):
            if cl == 'no_gps' and len(days[d]) > 1:
                continue
            basis = ['album_items_that_day', 'custody_window']
            if any(a <= d <= b for a, b in windows):
                basis.append('open_change_claim')
            if d in sessions:
                basis.append('work_session')
            built.add('day_context.jsonl', payloads.line(
                'day:%s:%s@%s' % (d, cl, vehicle[:8]), 'record_day_context', 'day_context',
                payloads.day_context(d, cl, vehicle, cfg.get('first_day_confidence', 0.95) if d == lo
                                     else cfg.get('confidence', 0.9), basis)))
            n += 1
    for x in cfg.get('extra') or []:
        v = ctx.vid(x.get('vehicle', cfg['vehicle']))
        built.add('day_context.jsonl', payloads.line(
            'day:%s:%s@%s' % (x['day'], x['place_cluster'], v[:8]), 'record_day_context', 'day_context',
            payloads.day_context(x['day'], x['place_cluster'], v, x['confidence'], x['basis'])))
        n += 1
    return {'day_context': {'emitted': n, 'config': {
        'days': 'album days inside the custody window, per place cluster; plus the case extra days',
        'custody': custody, 'clusters': 'labels from the local case (radius per cluster)'},
        'counts': {'rows': n, 'album_days_in_custody': len([d for d in days if lo and lo <= d <= hi])}}}


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)

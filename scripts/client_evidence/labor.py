"""Labor: documented claim vs photo-session evidence. The two are ALTERNATIVE evidence and are never added."""
from datetime import datetime, timedelta
from decimal import Decimal
from common import ContractError, dec, money

PHOTO_CONFIG = {'version': 'photo_sessions_v1', 'gap_minutes': 45, 'max_session_minutes': 480,
                'trusted_time_sources': ['exif_original', 'trusted_capture_claim'],
                'billable_intents': ['labor']}
EXCLUDED_ORIGINS = {'personal', 'misattributed', 'unresolved', 'review_needed', 'privacy_hold', 'protected'}
NON_INSTALL_INTENTS = {'inspection', 'documentation', 'parts_sourcing', 'parts_shopping'}


def rate_for(category, on, sources):
    """Historical rate effective on `on` (YYYY-MM-DD) for the category, from documentary sources only. None when absent."""
    hits = [x for x in sources if x.get('category') in (category, '*')
            and (not x.get('effective_from') or x['effective_from'] <= on) and (not x.get('effective_to') or on <= x['effective_to'])]
    pool = [x for x in hits if x['category'] == category] or hits   # a specific category outranks '*'
    if len({str(x['rate']) for x in pool}) > 1:
        raise ContractError(f'ambiguous rate sources for {category}')
    return pool[0] if pool else None


def invoice_labor(claim, rate_sources, current_rate=None):
    """claim: {claimed_total_hours, stated_labor_amount, as_of, categories:[{name,hours,rate?}], discounted_balance?, pre_discount_balance?,
    category_reduction?:{category,rate}}. Returns exact computations and flags; asserts nothing beyond the source claim."""
    flags, rows, total = [], [], Decimal(0)
    labor = Decimal(0)
    for c in claim['categories']:
        h = dec(c['hours'], 'hours')
        src = rate_for(c['name'], claim['as_of'], rate_sources)
        r = dec(c['rate']) if c.get('rate') is not None else (dec(src['rate']) if src else None)
        if r is None:
            flags.append(f"rate missing for {c['name']}")
        else:
            if current_rate is not None and dec(current_rate) != r:
                flags.append(f"{c['name']}: historical rate {money(r)} differs from current {money(dec(current_rate))}; historical used")
            labor += h * r
        rows.append({'category': c['name'], 'hours': str(h), 'rate': None if r is None else money(r),
                     'amount': None if r is None else money(h * r), 'rate_source': (src or {}).get('source_ref')})
        total += h
    if claim.get('claimed_total_hours') is not None and dec(claim['claimed_total_hours']) != total:
        flags.append(f"claimed total {claim['claimed_total_hours']}h != category sum {total}h")
    if claim.get('stated_labor_amount') is not None and not any('rate missing' in f for f in flags) \
            and dec(claim['stated_labor_amount']) != labor:
        flags.append(f"stated labor {money(dec(claim['stated_labor_amount']))} != computed {money(labor)}")
    out = {'status': 'source_claim', 'claimed_hours': str(total), 'rows': rows, 'computed_labor': money(labor) if not any('rate missing' in f for f in flags) else None,
           'verified': False, 'flags': flags}
    red = claim.get('category_reduction')
    if red and claim.get('pre_discount_balance') is not None and claim.get('discounted_balance') is not None:
        row = next(r for r in rows if r['category'] == red['category'])
        if row['rate'] is not None:
            expected = dec(claim['pre_discount_balance']) - dec(row['hours']) * (dec(row['rate']) - dec(red['rate']))
            gap = dec(claim['discounted_balance']) - expected
            out['discount_check'] = {'expected': money(expected), 'stated': money(dec(claim['discounted_balance'])), 'difference': money(gap)}
            if gap != 0:
                flags.append(f"stated discounted balance differs from the stated reduction by {money(gap)}; unresolved, not corrected")
    return out


def dedupe_claims(claims, relations=()):
    """Parent/sub-document double counting: one labor claim per economic_key; composite/component repeats add origins only."""
    kept, dropped = {}, []
    for c in claims:
        if c['economic_key'] in kept:
            kept[c['economic_key']]['origins'] += c.get('origins', [])
            dropped.append(c['economic_key'])
        else:
            kept[c['economic_key']] = {**c, 'origins': list(c.get('origins', []))}
    return list(kept.values()), dropped


def _t(s):
    return datetime.fromisoformat(s)


def photo_sessions(images, target_vehicle_id, cfg=None):
    """images: [{image_id, vehicle_id, identity ('confirmed'|...), origin, intent, capture:{source,at}|None, technician?}].
    Only trusted capture times and confirmed identity count. No fallback duration: a lone frame has a zero lower bound and
    an unknown upper bound. Missing times yield 'no_evidence' (not zero)."""
    cfg = cfg or PHOTO_CONFIG
    held = {'identity_not_confirmed': 0, 'excluded_origin': 0, 'non_install_intent': 0, 'no_trusted_capture_time': 0, 'other_vehicle': 0}
    eligible = []
    for im in images:
        if im.get('vehicle_id') != target_vehicle_id:
            held['other_vehicle'] += 1
        elif im.get('identity') != 'confirmed':
            held['identity_not_confirmed'] += 1
        elif im.get('origin') in EXCLUDED_ORIGINS:
            held['excluded_origin'] += 1
        elif im.get('intent') in NON_INSTALL_INTENTS or im.get('intent') not in cfg['billable_intents']:
            held['non_install_intent'] += 1
        elif not im.get('capture') or im['capture'].get('source') not in cfg['trusted_time_sources'] or not im['capture'].get('at'):
            held['no_trusted_capture_time'] += 1
        else:
            eligible.append(im)
    base = {'config': {k: cfg[k] for k in ('version', 'gap_minutes', 'max_session_minutes')}, 'held': held, 'images_total': len(images)}
    if not eligible:
        return {**base, 'status': 'no_evidence', 'hours_lower': None, 'hours_upper': None, 'sessions': [],
                'note': 'no eligible frames; absence of evidence, not zero labor'}
    eligible.sort(key=lambda i: _t(i['capture']['at']))
    clusters, gap = [[eligible[0]]], timedelta(minutes=cfg['gap_minutes'])
    for im in eligible[1:]:
        if _t(im['capture']['at']) - _t(clusters[-1][-1]['capture']['at']) > gap:
            clusters.append([])
        clusters[-1].append(im)
    cap = timedelta(minutes=cfg['max_session_minutes'])
    spans = []
    for cl in clusters:
        a, b = _t(cl[0]['capture']['at']), _t(cl[-1]['capture']['at'])
        spans.append({'start': a, 'end': min(b, a + cap), 'capped': b - a > cap, 'images': [i['image_id'] for i in cl],
                      'clock_sources': sorted({i['capture']['source'] for i in cl}), 'single_frame': len(cl) == 1})
    spans.sort(key=lambda s: s['start'])
    merged = []   # overlapping wall-clock windows (e.g. two technicians) count once
    overlap = timedelta(0)
    for s in spans:
        if merged and s['start'] < merged[-1]['end']:
            overlap += min(s['end'], merged[-1]['end']) - s['start']
            merged[-1]['end'] = max(merged[-1]['end'], s['end'])
            merged[-1]['images'] += s['images']
            merged[-1]['single_frame'] = False
        else:
            merged.append(dict(s))
    lower = sum((m['end'] - m['start'] for m in merged), timedelta(0))
    return {**base, 'status': 'estimated_from_photos', 'hours_lower': str(Decimal(lower.total_seconds()) / Decimal(3600)),
            'hours_upper': None,
            'overlap_minutes_merged': str(Decimal(overlap.total_seconds()) / Decimal(60)),
            'sessions': [{'start': m['start'].isoformat(), 'end': m['end'].isoformat(), 'images': m['images'], 'capped': m['capped'],
                          'single_frame': m['single_frame'], 'clock_sources': m['clock_sources']} for m in merged],
            'note': 'lower bound = first-to-last trusted frame; photos show activity, not total time worked'}


def reconcile(invoice, photos):
    """Side by side, never summed. Photo evidence is a lower bound of observed activity, so it cannot refute an invoice upward."""
    out = {'additive': False, 'invoice_claim_hours': invoice['claimed_hours'], 'photo_status': photos['status'],
           'photo_lower_hours': photos['hours_lower'], 'flags': list(invoice['flags'])}
    if photos['status'] == 'no_evidence':
        out['relation'] = 'not_assessable'
    elif Decimal(photos['hours_lower']) > Decimal(invoice['claimed_hours']):
        out['relation'] = 'photo_lower_bound_exceeds_claim'
        out['flags'].append('photo evidence exceeds invoiced hours; conflict for review')
    else:
        out['relation'] = 'photo_lower_bound_within_claim_not_corroboration_of_total'
    return out


def default_hold(images):
    """Default posture: with no trusted capture times, labor estimation is held; import timestamps are never a fallback."""
    n = sum(1 for i in images if i.get('capture') and i['capture'].get('source') in PHOTO_CONFIG['trusted_time_sources'] and i['capture'].get('at'))
    return {'hold': n == 0, 'frames': len(images), 'frames_with_trusted_capture_time': n,
            'reason': 'no trusted capture times; created_at/import time is not evidence of work time' if n == 0 else None}

"""Labor: documented claim vs photo-session evidence. The two are ALTERNATIVE evidence and are never added.

Clock policy: a capture time is one of (a) aware (carries an offset) or (b) camera-local with the offset UNKNOWN. Naive and
aware values are never clustered together and no UTC is ever invented for (b): camera-local clusters are review evidence
only and yield no hours. Hours come only from aware, in-window, confirmed-identity, labor-intent frames and are a lower
bound of observed activity; the primary signal is observed days and frame counts."""
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from common import ContractError, dec, money, parse_time

PHOTO_CONFIG = {'version': 'photo_sessions_v2', 'gap_minutes': 45, 'max_session_minutes': 480,
                'trusted_time_sources': ['exif_original', 'trusted_capture_claim'],
                'billable_intents': ['labor'], 'earliest_plausible_year': 1999}
EXCLUDED_ORIGINS = {'personal', 'misattributed', 'unresolved', 'review_needed', 'privacy_hold', 'protected', 'person'}
NON_INSTALL_INTENTS = {'inspection', 'documentation', 'parts_sourcing', 'parts_shopping', 'reference'}


def rate_for(category, on, sources):
    """Historical rate effective on `on` (YYYY-MM-DD) for the category, from documentary sources only. None when absent."""
    hits = [x for x in sources if x.get('category') in (category, '*')
            and (not x.get('effective_from') or x['effective_from'] <= on) and (not x.get('effective_to') or on <= x['effective_to'])]
    pool = [x for x in hits if x['category'] == category] or hits   # a specific category outranks '*'
    if len({str(dec(x['rate'])) for x in pool}) > 1:
        raise ContractError(f'ambiguous rate sources for {category}')
    return pool[0] if pool else None


def invoice_labor(claim, rate_sources, current_rate=None):
    """claim: {claimed_total_hours, stated_labor_amount, as_of (rate date), categories:[{name,hours,rate?}], service_period?,
    discounted_balance?, pre_discount_balance?, category_reduction?:{category,rate}}. Exact computations and flags only."""
    flags, rows, total, labor = [], [], Decimal(0), Decimal(0)
    if not claim.get('as_of'):
        flags.append('rate date missing (no service period or document date); documented rates not applied')
    for c in claim['categories']:
        h = dec(c['hours'], 'hours')
        src = rate_for(c['name'], claim['as_of'], rate_sources) if claim.get('as_of') else None
        stated = dec(c['rate']) if c.get('rate') is not None else None
        r = stated if stated is not None else (dec(src['rate']) if src else None)
        if stated is not None and src and dec(src['rate']) != stated:
            flags.append(f"{c['name']}: stated rate {money(stated)} conflicts with documented effective rate {money(dec(src['rate']))}")
        if r is None:
            flags.append(f"rate missing for {c['name']}")
        else:
            if current_rate is not None and dec(current_rate) != r:
                flags.append(f"{c['name']}: historical rate {money(r)} differs from current {money(dec(current_rate))}; historical used")
            labor += h * r
        rows.append({'category': c['name'], 'hours': str(h), 'rate': None if r is None else money(r),
                     'amount': None if r is None else money(h * r),
                     'rate_source': 'stated_on_document' if stated is not None else (src or {}).get('source_ref')})
        total += h
    if claim.get('claimed_total_hours') is not None and dec(claim['claimed_total_hours']) != total:
        flags.append(f"claimed total {claim['claimed_total_hours']}h != category sum {total}h")
    missing = any('rate missing' in f for f in flags)
    if claim.get('stated_labor_amount') is not None and not missing and dec(claim['stated_labor_amount']) != labor:
        flags.append(f"stated labor {money(dec(claim['stated_labor_amount']))} != computed {money(labor)}")
    out = {'status': 'source_claim', 'claimed_hours': str(total), 'rows': rows, 'computed_labor': None if missing else money(labor),
           'service_period': claim.get('service_period'), 'verified': False, 'flags': flags}
    red = claim.get('category_reduction')
    if red and claim.get('pre_discount_balance') is not None and claim.get('discounted_balance') is not None:
        row = next((r for r in rows if r['category'] == red['category']), None)
        if row is None:
            raise ContractError(f"category_reduction names unknown category {red['category']}")
        if row['rate'] is not None:
            expected = dec(claim['pre_discount_balance']) - dec(row['hours']) * (dec(row['rate']) - dec(red['rate']))
            gap = dec(claim['discounted_balance']) - expected
            out['discount_check'] = {'expected': money(expected), 'stated': money(dec(claim['discounted_balance'])), 'difference': money(gap)}
            if gap != 0:
                flags.append(f"stated discounted balance differs from the stated reduction by {money(gap)}; unresolved, not corrected")
    return out


def capture_clock(cap):
    """-> {'local': naive datetime of the wall-clock reading, 'utc': aware UTC datetime | None, 'offset': 'known'|'unknown'}.
    An offset that is absent stays unknown; nothing is assumed."""
    d, aware = parse_time(cap.get('at'), 'capture.at')
    off = cap.get('offset')
    if not aware and off:
        sign, hh, mm = off[0], off[1:3], off[4:6]
        if len(off) != 6 or sign not in '+-' or off[3] != ':' or not (hh + mm).isdigit():
            raise ContractError(f'capture.offset must look like +01:00: {off!r}')
        delta = timedelta(hours=int(hh), minutes=int(mm)) * (1 if sign == '+' else -1)
        d, aware = d.replace(tzinfo=timezone(delta)), True
    if aware:
        return {'local': d.replace(tzinfo=None), 'utc': d.astimezone(timezone.utc), 'offset': 'known'}
    return {'local': d, 'utc': None, 'offset': 'unknown'}


def _day(s):
    return parse_time(s, 'window')[0].date()


def photo_sessions(images, target_vehicle_id, window=None, cfg=None, vehicle_range=None):
    """images: [{image_id, vehicle_id, identity, identity_basis?, origin, intent?, capture:{source,at,offset?}|None}].
    window: {start,end} dates (the claim's service period) - frames outside it are held, not used. Intent comes from a reviewed
    label supplied with the image; a missing label is `intent_unclassified`, never silently non-install."""
    cfg = cfg or PHOTO_CONFIG
    held = Counter()
    scoped = []     # in scope for presence (days/counts), any intent
    for im in images:
        if im.get('vehicle_id') != target_vehicle_id:
            held['other_vehicle'] += 1
        elif im.get('identity') != 'confirmed':
            held['identity_not_confirmed'] += 1
        elif im.get('identity_basis') == 'context':
            held['identity_context_only'] += 1
        elif im.get('origin') in EXCLUDED_ORIGINS or im.get('privacy_hold'):
            held['excluded_origin'] += 1
        elif not im.get('capture') or im['capture'].get('source') not in cfg['trusted_time_sources'] or not im['capture'].get('at'):
            held['no_trusted_capture_time'] += 1
        else:
            ck = capture_clock(im['capture'])
            day = ck['local'].date()
            if day.year <= cfg['earliest_plausible_year']:
                held['implausible_clock'] += 1
            elif window and day < _day(window['start']):
                held['before_service_window'] += 1
            elif window and day > _day(window['end']):
                held['after_service_window'] += 1
            elif vehicle_range and not (_day(vehicle_range['start']) <= day <= _day(vehicle_range['end'])):
                held['outside_vehicle_date_range'] += 1
            else:
                scoped.append((im, ck))
    base = {'config': {k: cfg[k] for k in ('version', 'gap_minutes', 'max_session_minutes')}, 'window': window,
            'held': dict(held), 'images_total': len(images)}
    days = sorted({ck['local'].date().isoformat() for _, ck in scoped})
    base['observed_days'] = days
    base['observed_day_count'] = len(days)
    base['frames_in_scope'] = len(scoped)
    base['frames_in_scope_ids'] = sorted(str(im['image_id']) for im, _ in scoped)   # exact frames behind the counts (evidence refs)
    base['offset_unknown_frames'] = sum(1 for _, ck in scoped if ck['offset'] == 'unknown')
    labor = []
    for im, ck in scoped:
        intent = im.get('intent')
        if intent in cfg['billable_intents']:
            labor.append((im, ck))
        elif intent in NON_INSTALL_INTENTS:
            held['non_install_intent'] += 1
        elif intent is None:
            held['intent_unclassified'] += 1
        else:
            held['intent_not_billable'] += 1
    base['held'] = dict(held)
    aware = [(i, c) for i, c in labor if c['offset'] == 'known']
    naive = [(i, c) for i, c in labor if c['offset'] == 'unknown']
    out = {**base, 'camera_local_review': _local_review(naive), 'sessions': [], 'hours_lower': None, 'hours_lower_exact_seconds': None,
           'hours_upper': None, 'overlap_minutes_merged': None}
    if not aware:
        out['status'] = 'review_camera_local_only' if naive else ('presence_only' if scoped else 'no_evidence')
        out['note'] = ('no frame has a known offset or labor intent: no billable hours are computed' if scoped
                       else 'no eligible frames; absence of evidence, not zero labor')
        return out
    seq = sorted(aware, key=lambda t: t[1]['utc'])
    gap, cap = timedelta(minutes=cfg['gap_minutes']), timedelta(minutes=cfg['max_session_minutes'])
    clusters = [[seq[0]]]
    for t in seq[1:]:
        if t[1]['utc'] - clusters[-1][-1][1]['utc'] > gap:
            clusters.append([])
        clusters[-1].append(t)
    spans = []
    for cl in clusters:
        a, b = cl[0][1]['utc'], cl[-1][1]['utc']
        spans.append({'start': a, 'end': min(b, a + cap), 'capped': b - a > cap, 'images': [i['image_id'] for i, _ in cl],
                      'single_frame': len(cl) == 1})
    merged, overlap = [], timedelta(0)
    for s in sorted(spans, key=lambda s: s['start']):
        if merged and s['start'] < merged[-1]['end']:
            overlap += min(s['end'], merged[-1]['end']) - s['start']
            merged[-1].update(end=max(merged[-1]['end'], s['end']), images=merged[-1]['images'] + s['images'], single_frame=False)
        else:
            merged.append(dict(s))
    lower = sum((m['end'] - m['start'] for m in merged), timedelta(0))
    secs = int(lower.total_seconds())
    out.update(status='estimated_from_photos', hours_lower=money(Decimal(secs) / Decimal(3600)), hours_lower_exact_seconds=secs,
               overlap_minutes_merged=str(Decimal(int(overlap.total_seconds())) / Decimal(60)),
               sessions=[{'start': m['start'].isoformat(), 'end': m['end'].isoformat(), 'images': m['images'],
                          'capped': m['capped'], 'single_frame': m['single_frame']} for m in merged],
               note='lower bound of observed activity from aware frames; not total time worked')
    return out


def _local_review(naive):
    """Camera-local clustering as review evidence. No UTC, no hours."""
    if not naive:
        return None
    by_day = {}
    for im, ck in naive:
        by_day.setdefault(ck['local'].date().isoformat(), []).append(ck['local'])
    return {'clock_offset': 'unknown', 'billable_hours': None, 'days': [
        {'camera_local_day': d, 'frames': len(v), 'first_local': min(v).time().isoformat(), 'last_local': max(v).time().isoformat()}
        for d, v in sorted(by_day.items())]}


def reconcile(invoice, photos, claimed_days=None):
    """Side by side, never summed. Photo evidence is observed presence / a lower bound, so it cannot refute an invoice upward
    except where it exceeds it; `within_claim` is not corroboration of the total."""
    out = {'additive': False, 'invoice_claim_hours': invoice['claimed_hours'], 'photo_status': photos['status'],
           'photo_lower_hours': photos['hours_lower'], 'photo_observed_days': photos['observed_day_count'],
           'photo_frames_in_scope': photos['frames_in_scope'], 'flags': list(invoice['flags']),
           'invoice_hours_verified': False}
    if claimed_days is not None:
        out['claimed_days'] = int(claimed_days)
        out['days_relation'] = ('observed_days_exceed_claimed' if photos['observed_day_count'] > int(claimed_days)
                                else 'observed_days_within_claimed_not_corroboration')
        if photos['observed_day_count'] > int(claimed_days):
            out['flags'].append('photo days exceed claimed days; conflict for review')
    if photos['hours_lower'] is None:
        out['relation'] = 'not_assessable' if photos['status'] in ('no_evidence', 'presence_only', 'review_camera_local_only') else 'no_hours'
    elif Decimal(photos['hours_lower_exact_seconds']) / Decimal(3600) > Decimal(invoice['claimed_hours']):
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

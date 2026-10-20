"""Pass 1 (time_offset): one capture-time claim per image; vehicle_images.taken_at is never touched.

  photos_exif_join  the row joined ONE Photos item (photos_join.py): corrected = that item's instant as Photos keeps it
                    (milliseconds). The writer confirms it when stored - corrected is a whole number of allowed hours
                    with a residual under 1 s and the stem match is unique within +-12 h (v3, FM-1).
  batch_offset_v1   no Photos match: the offset its upload batch agrees on. The batch key is 'source|created day|tz',
                    pooled to 'source|pool|<year><tz>' when the day has fewer than 50 joined rows (ET2-6). The gate run
                    (time_rule_gate) carries per-batch agreement; confirm_capture_times_by_rule confirms a batch only
                    at 50 joined rows and 0.99 agreement (and every contributing day at 0.99 for a pooled key).
Rows the dedupe marked is_duplicate or that are superseded get no claim (the writer would skip them).
"""
import collections
import datetime as dt

import common
import inputs
import payloads
import photos_join

PASSES = ['time_offset', 'time_rule_gate']
POOL_BELOW = 50


def tzstr(sec):
    sign = '-' if sec < 0 else '+'
    sec = abs(int(sec))
    return '%s%02d%02d' % (sign, sec // 3600, (sec % 3600) // 60)


def build(ctx, built):
    cfg = ctx.pass_cfg('time_offset')
    allowed = cfg.get('allowed_offset_hours', payloads.C['allowed_offset_hours'])
    rows = [r for r in inputs.image_rows(ctx) if not r.get('sup') and not r.get('dup')
            and (r.get('source') or '') not in photos_join.LISTING_SOURCES]
    join = inputs.photos_join_records(ctx)
    by_stem = inputs.photos_index(ctx)[1] if (ctx.case.get('inputs') or {}).get('photos_index') else None
    joined, unjoined = [], []
    for r in rows:
        j = join.get(r['id'])
        (joined if j and j.get('match_kind') not in (None, '', 'none') and j.get('capture_utc_true') else unjoined
         ).append((r, j))

    batches = collections.defaultdict(list)            # (source, created day, tz) -> [offset seconds]
    lines, would_confirm = [], 0
    for r, j in sorted(joined, key=lambda x: (common.parse_ts(x[1]['capture_utc_true']), x[0]['id'])):
        stored = common.parse_ts(r['taken_at'])
        true = common.parse_ts(j['capture_utc_true'])
        tz = int(j['photos_tz_offset_seconds'] or 0)
        near = photos_join.same_stem_near(dict(j, taken_at_stored=r['taken_at']), by_stem) if by_stem else None
        unique = (near in (None, 1)) and str(j.get('time_candidates')) == '1' and not j.get('flags')
        off, resid = payloads.whole_hour_offset(stored, true)
        created_day = (r.get('created_at') or j.get('created_at') or '')[:10]
        key = '%s|%s|%s' % (r['source'], created_day, tzstr(tz))
        batches[(r['source'], created_day, tzstr(tz))].append(off)
        witness = {'photos_uuid': j['photos_uuid'],
                   'stem': (j.get('filename_used') or '').split('.')[0].upper() or None,
                   'unique_match': unique, 'match_kind': j['match_kind'], 'offset_rule': j.get('offset_rule') or None}
        if near is not None:
            witness['same_stem_items_within_12h'] = near
        lines.append(payloads.line('time:' + r['id'], 'propose_capture_time_claims', 'time_offset',
                                   payloads.capture_time_claim(
                                       r['id'], stored, true, j['photos_date_local'][:10], 'photos_exif_join',
                                       {k: v for k, v in witness.items() if v is not None}, 0.99 if unique else 0.6,
                                       local_offset_minutes=tz // 60, batch_key=key, offset_seconds=off)))
        if unique and off % 3600 == 0 and abs(off) // 3600 in allowed:
            would_confirm += 1

    # batch_offset_v1 for rows with no Photos match, from what their upload batch (or pool) agrees on
    gate = {}
    by_day = collections.defaultdict(list)
    for (src, day, tz), offs in batches.items():
        by_day[(src, day)].append((tz, offs))

    def agreement(offs):
        c = collections.Counter(offs)
        o, n = c.most_common(1)[0]
        return o, n / len(offs)

    batch_lines = []
    for r, _j in sorted(unjoined, key=lambda x: x[0]['id']):
        if not r.get('taken_at'):
            continue
        src, day = r['source'], (r.get('created_at') or '')[:10]
        tzs = by_day.get((src, day)) or []
        if len(tzs) != 1:
            continue                                   # no joined rows that day, or two time zones: stays unverified
        tz, offs = tzs[0]
        if len(offs) >= POOL_BELOW:
            key, pool_offs, worst = '%s|%s|%s' % (src, day, tz), offs, None
        else:
            year = day[:4]
            members = [(d, o2) for (s2, d, t2), o2 in batches.items() if s2 == src and t2 == tz and d[:4] == year]
            pool_offs = [o for _d, os_ in members for o in os_]
            key = '%s|pool|%s%s' % (src, year, tz)
            worst = min(agreement(os_)[1] for _d, os_ in members)
        off, agr = agreement(pool_offs)
        gate[key] = {'joined': len(pool_offs), 'agreement': round(agr, 4), 'offset_seconds': off}
        if worst is not None:
            gate[key]['worst_day_agreement'] = round(worst, 4)
        stored = common.parse_ts(r['taken_at'])
        corrected = stored - dt.timedelta(seconds=off)
        tz_sec = (-1 if tz[0] == '-' else 1) * (int(tz[1:3]) * 3600 + int(tz[3:5]) * 60)
        local_day = (corrected + dt.timedelta(seconds=tz_sec)).date().isoformat()
        batch_lines.append(payloads.line('time:' + r['id'], 'propose_capture_time_claims', 'time_offset',
                                         payloads.capture_time_claim(
                                             r['id'], stored, corrected, local_day, 'batch_offset_v1',
                                             {'batch_key': key, 'joined': len(pool_offs), 'agreement': round(agr, 4)},
                                             min(agr, 0.99), local_offset_minutes=tz_sec // 60, batch_key=key,
                                             offset_seconds=off)))
    for ln in lines + batch_lines:
        built.add('time_claims.jsonl', ln)
    unverified = len(rows) - len(lines) - len(batch_lines)
    res = {'time_offset': {'emitted': len(lines) + len(batch_lines), 'config': {
        'rules': ['photos_exif_join for every joined row (exact sources too)',
                  'batch_offset_v1 by upload batch, pooled under %d joined rows a day' % POOL_BELOW],
        'allowed_offset_hours': allowed,
        'corrected': 'the Photos instant as stored (milliseconds); the writer allows a residual under 1 s',
        'unique_match': 'one same-stem Photos item within +-12 h of the stored instant and one time candidate'},
        'counts': {'photos_exif_join': len(lines), 'batch_offset_v1': len(batch_lines),
                   'writer_would_confirm': would_confirm, 'time_unverified': unverified}}}
    if gate:
        res['time_rule_gate'] = {'emitted': 0, 'always': True, 'config': {'rule': 'batch_offset_v1 gate'},
                                 'close': {'status': 'done', 'counts': {'batches': gate}},
                                 'counts': {'batches': len(gate)}}
    return res


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)

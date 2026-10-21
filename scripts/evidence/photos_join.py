"""Photos.app join for the time and album passes: match vehicle_images rows to Photos items by metadata only.

Port of the join-index build (join.py, 2026-10-20). Inputs are a Photos index (CSV rows with photos_uuid, stem,
date_local, date_utc, tz_offset_seconds, latitude, longitude, albums, album_uuids, ...: metadata, never pixels) and
vehicle_images rows (id, source, taken_at, filename / file_name / ex_fname / sp_base, ex_uuid, created_at).

Rules, in order:
  1. a Photos uuid in exif (ex_uuid) or embedded in a stored file name;
  2. the file name stem (or a camera token such as IMG_1234 inside a longer name) plus a capture time within 2 s
     after a whole-hour offset: strict offsets first (user_upload +3 h, +4 h, 0; other sources 0, +3, +4);
  3. other whole-hour offsets within +-14 h under the same tolerance, labelled wall_plus_4h, wall_as_utc or
     other_whole_hour. A stem never matches without a time match.
The output record carries the fields pass_time and pass_photos_album read (the NUKE-PHOTOS-JOIN.csv columns).
"""
import collections
import csv
import os
import re

import common

LISTING_SOURCES = {'bat_import', 'bat_import_mirrored', 'bat', 'bat_listing'}
EXACT_SOURCES = {'iphoto', 'capture_relay_ios', 'ssd_blast'}
TOL = 2.0
UUID_RX = re.compile(r'([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})', re.I)
CAM_RX = re.compile(r'(IMG_E?\d{4}|DSC_?\d{4,5}|DSCN\d{4}|DSCF\d{4}|_DSC\d{4}|PXL_\d{8}_\d{6,9}|MVI_\d{4}|GOPR\d{4}|DJI_\d{4})')


def strict_offsets(source):
    return [3, 4, 0] if source == 'user_upload' else [0, 3, 4]


def tz_h(p):
    v = p.get('tz_offset_seconds')
    return round(int(v) / 3600) if v not in ('', None) else None


def classify(delta, p, strict):
    """-> (offset_h, residual_s, offset_rule, priority) for the best whole-hour fit within TOL, or None."""
    for i, o in enumerate(strict):
        if abs(delta - o * 3600) <= TOL:
            return o, delta - o * 3600, 'strict', i
    h = round(delta / 3600)
    if abs(h) > 14 or abs(delta - h * 3600) > TOL:
        return None
    z = tz_h(p)
    if z is not None and h == -z - 4:
        return h, delta - h * 3600, 'wall_plus_4h', 10
    if z is not None and h == -z:
        return h, delta - h * 3600, 'wall_as_utc', 11
    return h, delta - h * 3600, 'other_whole_hour', 12


def load_index(paths):
    """Photos index CSVs -> (by_uuid, by_stem). Each item gets 'utc' (aware datetime)."""
    by_uuid, by_stem = {}, collections.defaultdict(list)
    for path in paths:
        with open(path, newline='', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                r['utc'] = common.parse_ts(r['date_utc']) if r.get('date_utc') else None
                by_uuid[r['photos_uuid'].upper()] = r
                by_stem[(r.get('stem') or '').upper()].append(r)
    return by_uuid, by_stem


def names_of(r):
    out = []
    for k in ('filename', 'file_name', 'ex_fname', 'sp_base'):
        x = r.get(k)
        if x and x not in [n for n, _ in out]:
            out.append((x, k))
    return out


def stems_of(name):
    base = os.path.basename(name).upper()
    st = os.path.splitext(base)[0]
    res = [(st, 'stem')]
    for m in CAM_RX.findall(base):
        if m != st and (m, 'embedded_camera_token') not in res:
            res.append((m, 'embedded_camera_token'))
    return res


def match_row(r, by_uuid, by_stem):
    """One vehicle_images row -> a join record (match_kind 'none' when nothing fits)."""
    src = r.get('source') or ''
    strict = strict_offsets(src)
    t = common.parse_ts(r['taken_at']) if r.get('taken_at') else None
    nm = names_of(r)
    rec = dict(image_id=r['id'], source=src, filename_used='', taken_at_stored=t.isoformat() if t else '',
               offset_hours_applied='', capture_utc_true='', photos_uuid='', match_kind='none', residual_seconds='',
               albums='', album_uuids='', photos_lat='', photos_lon='', offset_rule='', time_candidates='',
               photos_date_local='', photos_tz_offset_seconds='', created_at=r.get('created_at') or '', flags='')
    flags, hit = [], None
    for u, n in ([(r['ex_uuid'].split('/')[0].upper(), r['ex_uuid'])] if r.get('ex_uuid') else []) + \
            [(u.upper(), n) for n, _ in nm for u in UUID_RX.findall(n)]:
        if u in by_uuid:
            p = by_uuid[u]
            o = res = rule = None
            if t and p['utc']:
                c = classify((p['utc'] - t).total_seconds(), p, strict)
                if c:
                    o, res, rule, _ = c
                else:
                    res = (p['utc'] - t).total_seconds()
                    flags.append('uuid_time_mismatch')
            hit = dict(p=p, kind='uuid', o=o, res=res, rule=rule or '', name=n, ntc=1)
            break
    hits = []
    if t:
        seen = set()
        for n, _ in nm:
            for s, _b in stems_of(n):
                if s in seen or s not in by_stem:
                    continue
                seen.add(s)
                for p in by_stem[s]:
                    if p['utc'] is None:
                        continue
                    c = classify((p['utc'] - t).total_seconds(), p, strict)
                    if c:
                        hits.append((c[3], abs(c[1]), p['photos_uuid'], p, c, n))
    if hits:
        hits.sort(key=lambda h: (h[0], h[1], h[2]))
        prio, _, _, p, c, n = hits[0]
        ntc = len({h[2] for h in hits if h[0] == prio})
        if hit is None:
            hit = dict(p=p, kind='stem_time' if c[0] == 0 else 'stem_time_corrected', o=c[0], res=c[1], rule=c[2],
                       name=n, ntc=ntc)
        elif hit['p']['photos_uuid'] != p['photos_uuid']:
            flags.append('uuid_stem_conflict')
    if hit:
        p = hit['p']
        rec.update(filename_used=hit['name'], offset_hours_applied='' if hit['o'] is None else hit['o'],
                   photos_uuid=p['photos_uuid'], match_kind=hit['kind'],
                   residual_seconds='' if hit['res'] is None else round(hit['res'], 3), albums=p.get('albums') or '',
                   album_uuids=p.get('album_uuids') or '', photos_lat=p.get('latitude') or '',
                   photos_lon=p.get('longitude') or '', offset_rule=hit['rule'], time_candidates=hit['ntc'],
                   photos_date_local=p.get('date_local') or '',
                   photos_tz_offset_seconds=p.get('tz_offset_seconds') or '',
                   capture_utc_true=p['utc'].isoformat() if p['utc'] else '')
        if hit['ntc'] > 1:
            flags.append('ambiguous_time_match')
        if str(p.get('tz_offset_seconds')) == '0':
            flags.append('photos_tz_0')
    else:
        cam = [n for n, _ in nm if CAM_RX.search(os.path.basename(n).upper())]
        rec['filename_used'] = (cam or [n for n, _ in nm] or [''])[0]
    rec['flags'] = ';'.join(flags)
    return rec


def join_rows(rows, by_uuid, by_stem):
    """Join rows (listing galleries excluded). Unmatched rows of an exact source keep their stored time only when
    every matched row of the same source and upload day matched at offset 0 (capture_utc_basis)."""
    out = [match_row(r, by_uuid, by_stem) for r in rows if (r.get('source') or '') not in LISTING_SOURCES]
    batch = collections.defaultdict(set)
    for rec in out:
        if rec['match_kind'] != 'none' and rec['offset_hours_applied'] != '':
            batch[(rec['source'], rec['created_at'][:10])].add(rec['offset_hours_applied'])
    for rec in out:
        rec['capture_utc_basis'] = 'photos' if rec['match_kind'] != 'none' else ''
        if rec['match_kind'] == 'none' and rec['taken_at_stored'] and rec['source'] in EXACT_SOURCES:
            offs = batch.get((rec['source'], rec['created_at'][:10]))
            rec['capture_utc_basis'] = 'stored_exact_batch' if offs == {0} else (
                'unknown_batch_has_offsets' if offs else 'unknown_no_matched_batch')
    return out


def read_join_csv(path, image_ids=None):
    """A precomputed join (NUKE-PHOTOS-JOIN.csv) -> {image_id: record}."""
    out = {}
    with open(path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if image_ids is None or r['image_id'] in image_ids:
                out[r['image_id']] = r
    return out


def same_stem_near(rec, by_stem, hours=12):
    """Photos items with the record's stem within +-hours of the stored instant (the unique-match witness)."""
    if not rec.get('filename_used') or not rec.get('taken_at_stored'):
        return 0
    stem = os.path.basename(rec['filename_used']).split('.')[0].upper()
    t = common.parse_ts(rec['taken_at_stored'])
    return sum(1 for p in by_stem.get(stem, []) if p['utc'] and abs((p['utc'] - t).total_seconds()) <= hours * 3600)

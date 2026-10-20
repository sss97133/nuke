"""Pass 3 (photos_album): the owner's Photos albums as evidence of which truck a photo shows.

One `photos_album` link per album and vehicle (role context, never a filing), and one candidate per joined image in
the album, pointing at that link (album_link_id). The owner confirms the album map once (decide_evidence album_map)
and every candidate of it reads confirmed_by_album_map; an album map never moves a filed photo.

Albums come from the case (declared, with the vehicle the evidence names) or, with "from_map": true, from the album
map (photos_albums.map_albums output: candidates, map_confidence, match_basis). An album that maps to two profiles and
names no single vehicle gets one link per profile and its candidates share an ambiguity_group (v3, FM-14).
Confidence when the case does not state it (join-index candidates.py): the map confidence, x0.9 for a title with no
series or model word and 2+ candidates, divided by the number of vehicle albums an image sits in when their
candidate sets differ.
"""
import csv

import common
import inputs
import payloads

PASSES = ['photos_album']


def _albums(ctx, cfg):
    out = []
    for a in cfg.get('albums') or []:
        out.append(dict(a, candidates=[ctx.vid(v) for v in a.get('candidate_set') or [a.get('vehicle')] if v],
                        chosen=ctx.vid(a.get('vehicle'))))
    if cfg.get('from_map'):
        declared = {a['album_uuid'] for a in out}
        with open(ctx.input_path('album_map'), newline='', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                if r['album_uuid'] in declared or float(r['map_confidence'] or 0) <= 0:
                    continue
                cands = [x for x in r['candidate_vehicle_ids'].split(';') if x]
                out.append({'album_uuid': r['album_uuid'], 'title': r['album'], 'candidates': cands,
                            'chosen': cands[0] if len(cands) == 1 else None,
                            'map': {'ref': 'album map', 'map_confidence': float(r['map_confidence']),
                                    'match_basis': r['match_basis']},
                            'items_all_dates': int(r.get('items_all_dates') or 0)})
    return out


def build(ctx, built):
    cfg = ctx.pass_cfg('photos_album')
    albums = _albums(ctx, cfg)
    if not albums:
        return {}
    join = inputs.photos_join_records(ctx)
    vehicle_albums = {a['album_uuid']: a for a in albums}
    links, cands = 0, 0
    link_of = {}
    for a in albums:
        targets = [a['chosen']] if a.get('chosen') else a['candidates']
        group = common.uuid5('ambiguity', 'photos_album', a['album_uuid']) if len(targets) > 1 else None
        a['_group'] = group
        mp = a.get('map') or {}
        for v in targets:
            key = payloads.link_key('photos_album:' + a['album_uuid'], v)
            ev = [{'kind': 'photos_album', 'ref': a['album_uuid'], 'title': a['title'],
                   'items_all_dates': a.get('items_all_dates'), 'items_in_window': a.get('items_in_window')},
                  {'kind': 'album_vehicle_map', 'ref': mp.get('ref', 'album map'),
                   'map_confidence': mp.get('map_confidence'), 'candidates': a['candidates'],
                   'chosen': a.get('chosen'), 'why': mp.get('why')}]
            built.add('links.album.jsonl', payloads.line(key, 'propose_evidence_links', 'photos_album',
                      payloads.evidence_link(
                          v, 'photos_album', 'context', a.get('join_key', 'album title -> vehicle'),
                          a.get('link_confidence', a.get('confidence', mp.get('map_confidence', 0.6))),
                          [{k: x for k, x in e.items() if x is not None} for e in ev],
                          external_ref='photos_album:' + a['album_uuid'],
                          summary='Photos album %s, %s items' % (a['title'], a.get('items_all_dates', '?')))))
            link_of[(a['album_uuid'], v)] = key
            links += 1
    order = sorted(join.values(), key=lambda j: (j.get('capture_utc_true') or '', j['image_id']))
    for j in order:
        if j.get('match_kind') in (None, '', 'none'):
            continue
        _titles, uuids = inputs.albums_of(j)
        mine = [u for u in uuids if u in vehicle_albums]
        if not mine:
            continue
        cand_sets = {tuple(sorted(vehicle_albums[u]['candidates'])) for u in mine}
        split = len(mine) if len(cand_sets) > 1 else 1
        for u in mine:
            a = vehicle_albums[u]
            targets = [a['chosen']] if a.get('chosen') else a['candidates']
            mp = a.get('map') or {}
            base = a.get('confidence')
            if base is None:
                base = mp.get('map_confidence', 0.6)
                if len(a['candidates']) >= 2 and mp.get('match_basis') == 'year_make_only':
                    base *= 0.9
            for v in targets:
                key = payloads.cand_key('photos_album', j['image_id'], v if len(targets) > 1 or split > 1 else None)
                ev = [{'kind': 'photos_item', 'ref': j['photos_uuid'], 'match_kind': j['match_kind'],
                       'offset_hours': int(j['offset_hours_applied']) if str(j.get('offset_hours_applied')) not in ('', 'None') else None},
                      {'kind': 'photos_album', 'ref': u}]
                if split > 1:
                    ev.append({'kind': 'note', 'ref': 'item in %d vehicle albums with different candidates' % split})
                built.add('candidates.photos_album.jsonl', payloads.line(key, 'propose_image_candidates', 'photos_album',
                          payloads.candidate(
                              j['image_id'], v, 'is_vehicle', 'photos_album:%s|%s' % (u, j['match_kind']),
                              base / split, [{k: x for k, x in e.items() if x is not None} for e in ev],
                              candidate_set=a['candidates'], ambiguity_group=a.get('_group'),
                              album_link_id=payloads.key_ref(link_of[(u, v)]),
                              pass_captured_on=(j.get('photos_date_local') or '')[:10] or None)))
                cands += 1
    return {'photos_album': {'emitted': links + cands, 'config': {
        'albums': [{'album': a['album_uuid'], 'title': a['title'], 'vehicles': [a['chosen']] if a.get('chosen')
                    else a['candidates']} for a in albums],
        'rule': cfg.get('rule', 'joined image in a vehicle album -> is_vehicle candidate on the album link')},
        'counts': {'links': links, 'candidates': cands}}}


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)

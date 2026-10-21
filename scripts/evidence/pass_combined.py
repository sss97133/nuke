"""Combine (pass `combined`): one candidate per image for the vehicle, from album membership, the Photos join, the
capture day, the vision gate and the work-session record. The readers count photo days from these rows.

Rules come from the case, in order; the first whose `when` fits the image decides verdict, confidence, image_class
and the extra evidence:
  when      {"in_album": true|false, "day": "YYYY-MM-DD", "album_title": "<exact title>"} (all given keys must fit)
  evidence  extra items; "@album", "@cluster" and "@session" in a ref are replaced by the vehicle album uuid, the place
            cluster label and the work session of that day (an item whose @session has no session is dropped)
An image no rule fits stops the pass: every image gets an explicit answer or the case is wrong.
image_class: own (the owner's photo in custody), third_party (a seller's camera), listing, document (a photo of a
document about the truck: a dated trace, never a work day; v3 FM-10), unknown.
"""
import common
import inputs
import payloads

PASSES = ['combined']


def _fits(when, in_album, day, titles):
    if 'in_album' in when and bool(when['in_album']) != in_album:
        return False
    if 'day' in when and when['day'] != day:
        return False
    if 'album_title' in when and when['album_title'] not in titles:
        return False
    return True


def _expand(items, album, cluster, session, ctx):
    out = []
    for it in items or []:
        it = dict(it)
        drop = False
        for k, v in list(it.items()):
            if isinstance(v, str) and v.startswith('@'):
                if v == '@album':
                    it[k] = album
                elif v == '@cluster':
                    it[k] = cluster
                elif v == '@session':
                    if not session:
                        drop = True
                    it[k] = session
                elif v.startswith('@vehicle:'):
                    it[k] = ctx.vid(v[len('@vehicle:'):])
        if not drop:
            out.append(it)
    return out


def build(ctx, built):
    cfg = ctx.pass_cfg('combined')
    if not cfg:
        return {}
    vehicle = ctx.vid(cfg['vehicle'])
    album = cfg.get('album')
    album_set = [ctx.vid(v) for v in cfg.get('candidate_set_album') or [cfg['vehicle']]]
    join = inputs.photos_join_records(ctx)
    gate = {r['id']: r.get('gate') for r in inputs.image_rows(ctx)}
    sessions = inputs.session_by_day(ctx)
    flags, n, unmatched = {}, 0, 0
    rows = [r for r in inputs.image_rows(ctx) if not r.get('sup') and not r.get('dup')]
    order = sorted(rows, key=lambda r: ((join.get(r['id']) or {}).get('capture_utc_true') or '9999', r['id']))
    for r in order:
        j = join.get(r['id'])
        if not j or j.get('match_kind') in (None, '', 'none'):
            unmatched += 1
            continue
        titles, uuids = inputs.albums_of(j)
        in_album = bool(album) and album in uuids
        day = (j.get('photos_date_local') or '')[:10]
        rule = next((ru for ru in cfg['rules'] if _fits(ru.get('when') or {}, in_album, day, titles)), None)
        if rule is None:
            raise common.EvidenceError('combined: no rule fits image %s (day %s); add one to the case' % (r['id'], day))
        cluster = inputs.place_cluster(ctx, j.get('photos_lat'), j.get('photos_lon'))
        ev = [{'kind': 'photos_item', 'ref': j['photos_uuid'], 'match_kind': j['match_kind']},
              {'kind': 'capture_day', 'day': day, 'basis': 'Photos EXIF instant, local'},
              {'kind': 'vision_gate_status', 'value': gate.get(r['id'])}]
        ev += _expand(rule.get('evidence'), album, cluster, sessions.get(day), ctx)
        if rule.get('flag'):
            flags[rule['flag']] = flags.get(rule['flag'], 0) + 1
            if not any(e.get('kind') == 'flag' and e.get('ref') == rule['flag'] for e in ev):
                ev.append({'kind': 'flag', 'ref': rule['flag']})
        built.add('candidates.combined.jsonl', payloads.line(
            payloads.cand_key('combined', r['id']), 'propose_image_candidates', 'combined',
            payloads.candidate(r['id'], vehicle, rule['verdict'], cfg.get('join_key', 'combined:album+photos_join+day'),
                               rule['confidence'], ev, image_class=rule.get('image_class', 'own'),
                               candidate_set=album_set if in_album else [vehicle], pass_captured_on=day or None)))
        n += 1
    if unmatched:
        ctx.note('combined: %d image(s) without a Photos match got no combined row (time unverified)' % unmatched)
    return {'combined': {'emitted': n, 'config': {
        'inputs': ['photos_album', 'time_offset', 'photos_join', 'vision_gate_status', 'work_sessions'],
        'rules': [{'when': ru.get('when'), 'verdict': ru['verdict'], 'confidence': ru['confidence'],
                   'image_class': ru.get('image_class', 'own'), 'flag': ru.get('flag')} for ru in cfg['rules']]},
        'counts': {'candidates': n, 'flags': flags, 'no_photos_match': unmatched}}}


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)

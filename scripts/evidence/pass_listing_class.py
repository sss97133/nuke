"""Pass 0 (listing_class): listing-gallery rows (source bat_import) as listing evidence of the vehicle they sit on.

One candidate per distinct image_url, on the row the dedupe keeps (image-url-dupes: partition a vehicle's rows by
image_url, order by is_primary desc, created_at, id; the rest are marked is_duplicate through mark_as_duplicate).
The other copies are listed in the candidate's evidence and get no candidate: the writer refuses is_duplicate rows
(v3, FM-12). The loader sends these rows only after the dedupe lists the vehicle (its done list) and re-checks
is_duplicate per image id right before each call.

Which listing a gallery belongs to comes from the case: listings[] in order, the first whose match fits the keeper
row ({"ex_src": true}, {"url_contains": "..."} or {} for any).
"""
import collections

import common
import inputs
import payloads

PASSES = ['listing_class']


def _matches(m, row):
    if 'ex_src' in m and bool(row.get('ex_src')) != bool(m['ex_src']):
        return False
    if m.get('url_contains') and m['url_contains'] not in (row.get('image_url') or ''):
        return False
    return True


def dedupe_done(ctx, vehicle_id):
    p = ctx.input_path('dedupe_done')
    if not p or not p.exists():
        return False
    return vehicle_id in {ln.strip() for ln in p.read_text().splitlines()}


def build(ctx, built):
    cfg = ctx.pass_cfg('listing_class')
    rows = inputs.listing_rows(ctx)
    if not rows or not cfg:
        return {}
    vehicle = ctx.vid(cfg['vehicle'])
    primary = inputs.primary_ids(ctx)
    groups = collections.defaultdict(list)
    for r in rows:
        if r.get('vehicle_id') == vehicle and not r.get('sup'):
            groups[r['image_url']].append(r)
    done = dedupe_done(ctx, vehicle)
    status = 'done' if done else 'pending (%s not in the dedupe done list on %s)' % (vehicle[:8], common.today(ctx.now))
    out, copies, skipped = 0, 0, 0
    order = sorted(groups.items(), key=lambda kv: min(common.parse_ts(x['created_at']) for x in kv[1]))
    for url, rs in order:
        rs.sort(key=lambda x: (x['id'] not in primary, common.parse_ts(x['created_at']), x['id']))
        live = [x for x in rs if not x.get('dup')]
        if not live:
            skipped += 1
            continue
        keep = live[0]
        dups = [x['id'] for x in rs if x['id'] != keep['id']]
        listing = next((ls for ls in cfg.get('listings') or [] if _matches(ls.get('match') or {}, keep)), None)
        if listing is None:
            skipped += 1
            continue
        ev = [{'kind': 'vehicle_image_source', 'source': keep.get('source', 'bat_import'), 'image_url': url},
              {'kind': 'listing', 'ref': listing['ref'], 'basis': listing.get('basis')},
              {'kind': 'url_copies_on_vehicle', 'n': len(rs),
               'keeper_rule': 'image-url-dupes: partition by image_url order by is_primary desc, created_at, id',
               'duplicate_row_ids': dups, 'dedupe': status}]
        built.add('candidates.listing_class.jsonl', payloads.line(
            payloads.cand_key('listing_class', keep['id']), 'propose_image_candidates', 'listing_class',
            payloads.candidate(keep['id'], vehicle, 'listing_evidence', 'source=bat_import;image_url',
                               listing.get('confidence', 0.9),
                               [{k: v for k, v in e.items() if v is not None} for e in ev], image_class='listing',
                               pass_captured_on=listing.get('captured_on'))))
        out += 1
        copies += len(dups)
    return {'listing_class': {'emitted': out, 'config': {
        'key': "source = 'bat_import' + image_url (one candidate per distinct url)", 'vehicle_id': vehicle,
        'verdict': 'listing_evidence', 'image_class': 'listing',
        'keeper': 'the row image-url-dupes keeps (is_primary desc, created_at, id); the copies are listed in evidence',
        'load_gate': 'the vehicle in the dedupe done list; is_duplicate re-checked per image id before each call',
        'dedupe': status},
        'counts': {'keepers': out, 'copies_listed': copies, 'rows_read': len(rows), 'urls_skipped': skipped}}}


if __name__ == '__main__':
    import passlib
    passlib.pass_main(PASSES, __doc__)

#!/usr/bin/env python3
"""Album <-> DB reconciliation v2 — duplicate-aware.

Per library photo (in a vehicle-named album), gather ALL active DB rows whose
filename matches (size-filtered when available). Classify:
  unique-agree      one vehicle holds it, == album vehicle
  unique-wrong      one vehicle holds it, != album vehicle      -> fork queue
  dup-cross         2+ vehicles hold the same photo             -> dedup queue
  unmatched         photo not in DB at all (per this 296-vehicle scope)
  collision         name collision unresolvable (no sizes)

Album vehicle = path-anchor when the album's photos' storage paths point at
one vehicle (iphoto imports), else dominant unique-match vote.
"""
import json, csv, re, sys
from collections import defaultdict, Counter

WORK = '/tmp/k5-audit'
norm = lambda s: re.sub(r'\.(HEIC|JPG|JPEG|PNG|MOV|MP4)$', '', s.strip().upper())

veh_label = {}
for line in open(f'{WORK}/owned-vehicles.csv'):
    p = line.strip().split(',')
    if len(p) >= 4 and re.fullmatch(r'[0-9a-f-]{36}', p[0]):
        veh_label[p[0]] = ' '.join(x for x in p[1:5] if x).strip()

db_by_name = defaultdict(list)
for row in csv.reader(open(f'{WORK}/db-images2.csv')):
    if len(row) < 6 or not re.fullmatch(r'[0-9a-f-]{36}', row[0]):
        continue
    vid, iid, fname, fsize, source, path_vid = row[:6]
    db_by_name[norm(fname)].append({
        'vid': vid, 'iid': iid, 'size': int(fsize) if fsize.isdigit() else None,
        'source': source, 'path_vid': path_vid, 'fname': fname})

photos = json.load(open(f'{WORK}/library-all.json'))
YEAR = re.compile(r'(19[2-9]\d|20[0-2]\d)')

# pass 1: per-album path-anchor + unique votes
album_photos = defaultdict(list)
for p in photos:
    for a in (p.get('albums') or []):
        if YEAR.search(a):
            album_photos[a].append(p)

def rows_for(p):
    base = norm(p.get('original_filename') or '')
    if not base or base not in db_by_name:
        return base, None
    rows = db_by_name[base]
    size = p.get('original_filesize')
    if size:
        sized = [r for r in rows if r['size'] == size]
        if sized:
            rows = sized
    return base, rows

album_anchor = {}
for a, plist in album_photos.items():
    path_votes, uniq_votes = Counter(), Counter()
    for p in plist:
        _, rows = rows_for(p)
        if not rows: continue
        for r in rows:
            if r['path_vid'] and r['path_vid'] == r['vid']:
                path_votes[r['vid']] += 1
        vids = {r['vid'] for r in rows}
        if len(vids) == 1:
            uniq_votes[next(iter(vids))] += 1
    src = path_votes if path_votes else uniq_votes
    album_anchor[a] = src.most_common(1)[0][0] if src else None

# pass 2: classify
forkq = csv.writer(open(f'{WORK}/fork-queue.csv', 'w'))
forkq.writerow(['album','anchor_vid','anchor_label','image_id','db_vid','db_label','fname','source','lib_date','gps'])
dupq = csv.writer(open(f'{WORK}/dup-queue.csv', 'w'))
dupq.writerow(['album','anchor_vid','fname','vehicles_holding','image_ids','lib_date'])

print(f"{'ALBUM':40} {'photos':>6} {'agree':>6} {'wrong':>6} {'dup':>5} {'unmtch':>6} {'colls':>6}  anchor")
G = Counter()
rows_out = []
for a, plist in sorted(album_photos.items(), key=lambda kv: -len(kv[1])):
    anchor = album_anchor[a]
    if not anchor: continue
    c = Counter()
    for p in plist:
        base, rows = rows_for(p)
        if rows is None:
            c['unmatched'] += 1; continue
        vids = sorted({r['vid'] for r in rows})
        if len(vids) > 1:
            c['dup'] += 1
            dupq.writerow([a, anchor, rows[0]['fname'], ';'.join(vids),
                           ';'.join(r['iid'] for r in rows), (p.get('date') or '')[:16]])
        elif len(rows) >= 1 and all(r['size'] is None for r in rows) and len(db_by_name[base]) > len(rows):
            c['collision'] += 1
        elif vids[0] == anchor:
            c['agree'] += 1
        else:
            r = rows[0]
            c['wrong'] += 1
            forkq.writerow([a, anchor, veh_label.get(anchor,'?'), r['iid'], r['vid'],
                            veh_label.get(r['vid'],'?'), r['fname'], r['source'],
                            (p.get('date') or '')[:16],
                            f"{p.get('latitude') or ''},{p.get('longitude') or ''}"])
    G.update(c)
    print(f"{a[:40]:40} {len(plist):>6} {c['agree']:>6} {c['wrong']:>6} {c['dup']:>5} {c['unmatched']:>6} {c['collision']:>6}  {veh_label.get(anchor, '?')[:28]} ({anchor[:8]})")

print(f"\nGLOBAL: agree={G['agree']} wrong={G['wrong']} dup-cross-vehicle={G['dup']} "
      f"unmatched={G['unmatched']} collisions={G['collision']}")
print(f"fork queue -> {WORK}/fork-queue.csv ; dup queue -> {WORK}/dup-queue.csv")

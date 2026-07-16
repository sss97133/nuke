#!/usr/bin/env python3
"""Album <-> DB attribution reconciliation.

Owner albums in Photos = the vehicle prior. Each album's photos that exist in
the DB vote for a dominant vehicle_id (photo-density mapping). Album photos
attributed to a DIFFERENT vehicle than the dominant one are misattribution
candidates. Output: contamination matrix + ranked adjudication queue.

Match key: original filename (case-normalized); file_size tiebreak when both
sides have it. IMG_NNNN collisions without size on either side -> 'ambiguous'.
"""
import json, csv, re, sys
from collections import defaultdict, Counter

WORK = '/tmp/k5-audit'

# ── vehicles ────────────────────────────────────────────────────────────────
veh_label = {}
for line in open(f'{WORK}/owned-vehicles.csv'):
    parts = line.strip().split(',')
    if len(parts) >= 4 and re.fullmatch(r'[0-9a-f-]{36}', parts[0]):
        veh_label[parts[0]] = ' '.join(p for p in parts[1:5] if p).strip()

# ── DB images: fname -> list of rows ────────────────────────────────────────
db_by_name = defaultdict(list)
db_rows = 0
for row in csv.reader(open(f'{WORK}/db-images.csv')):
    if len(row) < 6 or not re.fullmatch(r'[0-9a-f-]{36}', row[0]):
        continue
    vehicle_id, image_id, fname, fsize, source, bucket = row[:6]
    key = fname.strip().upper()
    # normalize: strip .heic/.jpg/.jpeg/.png extension for matching
    base = re.sub(r'\.(HEIC|JPG|JPEG|PNG|MOV|MP4)$', '', key)
    db_by_name[base].append({
        'vehicle_id': vehicle_id, 'image_id': image_id,
        'size': int(fsize) if fsize.isdigit() else None,
        'source': source, 'fname': fname,
    })
    db_rows += 1

# ── library photos ──────────────────────────────────────────────────────────
photos = json.load(open(f'{WORK}/library-all.json'))
print(f'library photos: {len(photos)}, db rows: {db_rows}, vehicles: {len(veh_label)}', file=sys.stderr)

VEHICLE_ALBUM = re.compile(r'(19[2-9]\d|20[0-2]\d)')  # album names carrying a year

album_hits = defaultdict(list)   # album -> [(photo, db_row)]
album_total = Counter()          # album -> photos in album
matched_lib = 0

for p in photos:
    albums = p.get('albums') or []
    fname = (p.get('original_filename') or '').upper()
    base = re.sub(r'\.(HEIC|JPG|JPEG|PNG|MOV|MP4)$', '', fname)
    size = p.get('original_filesize')
    for a in albums:
        album_total[a] += 1
    if not base or base not in db_by_name:
        continue
    rows = db_by_name[base]
    # size tiebreak if multiple DB rows share the name
    chosen = None
    if len(rows) == 1:
        chosen = rows[0]
    elif size:
        sized = [r for r in rows if r['size'] == size]
        if len(sized) >= 1:
            chosen = sized[0]
    if not chosen:
        chosen = {'vehicle_id': 'AMBIGUOUS', 'image_id': '', 'source': '', 'fname': fname}
    matched_lib += 1
    for a in albums:
        album_hits[a].append((p, chosen))

print(f'library photos matched to DB by filename: {matched_lib}', file=sys.stderr)

# ── per-album dominant vehicle + mismatches ────────────────────────────────
out = csv.writer(open(f'{WORK}/mismatch-queue.csv', 'w'))
out.writerow(['album', 'dominant_vehicle', 'dominant_label', 'image_id',
              'db_vehicle', 'db_label', 'fname', 'source', 'lib_date', 'lib_gps'])

print(f"\n{'ALBUM':42} {'in-lib':>6} {'in-db':>6} {'agree':>6} {'wrong':>6} {'ambig':>6}  dominant vehicle")
summary = []
for album, hits in sorted(album_hits.items(), key=lambda kv: -len(kv[1])):
    if not VEHICLE_ALBUM.search(album):
        continue  # vehicle-named albums only for the matrix
    votes = Counter(r['vehicle_id'] for _, r in hits if r['vehicle_id'] != 'AMBIGUOUS')
    if not votes:
        continue
    dom, dom_n = votes.most_common(1)[0]
    agree = wrong = ambig = 0
    for p, r in hits:
        if r['vehicle_id'] == 'AMBIGUOUS':
            ambig += 1
        elif r['vehicle_id'] == dom:
            agree += 1
        else:
            wrong += 1
            gps = f"{p.get('latitude') or ''},{p.get('longitude') or ''}"
            out.writerow([album, dom, veh_label.get(dom, '?'), r['image_id'],
                          r['vehicle_id'], veh_label.get(r['vehicle_id'], '?'),
                          r['fname'], r['source'], (p.get('date') or '')[:16], gps])
    label = veh_label.get(dom, dom[:8])
    print(f"{album[:42]:42} {album_total[album]:>6} {len(hits):>6} {agree:>6} {wrong:>6} {ambig:>6}  {label[:30]} ({dom[:8]})")
    summary.append((album, len(hits), agree, wrong, ambig, dom))

tot_hits = sum(s[1] for s in summary); tot_wrong = sum(s[3] for s in summary)
print(f"\nTOTALS: {tot_hits} album-photo->db matches, {tot_wrong} cross-vehicle mismatches "
      f"({100*tot_wrong/max(tot_hits,1):.1f}%) -> {WORK}/mismatch-queue.csv")

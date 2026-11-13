#!/usr/bin/env python3
"""Choose the keyed claims the writer can accept today and pack them for land.sql.

usage: KEYS_DRY_RUN_DATA=<folder> pack_claims.py <fold.json from fold.py --json> [--parts 3]
A claim is packed when its state is a live registry condition key. Left out, and counted: a state with no registry
key (it waits on a proposal); a print of an older photo inside a receipt frame (its capture day is not the day it
shows); a body-panel key on an interior part (the skeptics' most common stretch); the same claim twice.
Writes land-part<N>.json in the data folder and prints each part's md5, which land.sql checks before it sends.
"""
import collections, hashlib, json, os, sys

DATA = os.environ.get('KEYS_DRY_RUN_DATA')
if not DATA or len(sys.argv) < 2: sys.exit(__doc__)
n_parts = int(sys.argv[sys.argv.index('--parts') + 1]) if '--parts' in sys.argv else 3
rows = json.load(open(sys.argv[1]))['rows']
statements = json.load(open(os.path.join(DATA, 'statements_all.json')))

# a statement's index inside its photo's damage_callouts array is its rank among that photo's statement ids
by_photo = collections.defaultdict(list)
for s in statements: by_photo[s['photo_full']].append(s['id'])
index = {sid: i for ids in by_photo.values() for i, sid in enumerate(sorted(ids))}

keep, left_out, seen = [], collections.Counter(), set()
for x in rows:
    if x['state_from'] != 'registry condition key': left_out['state has no registry key'] += 1; continue
    if x['scene'] == 'receipt_document': left_out['print inside a receipt frame'] += 1; continue
    if (x['part'] or '').startswith('interior.') and x['state'].startswith('exterior.body.'): left_out['body-panel key on an interior part'] += 1; continue
    key = (x['photo'], index[x['sid']], x['state'], x['part'], x['side'])
    if key in seen: left_out['same claim twice'] += 1; continue
    seen.add(key); keep.append(x)

descriptors = sorted({x['state'] for x in keep}); parts = sorted({x['part'] for x in keep if x['part']})
SIDE = {None: 0, 'driver': 1, 'passenger': 2, 'center': 3}
STATUS = {'registry': 1, 'registry (side not said)': 2, 'decided this run': 3, 'decided this run (which one not said)': 4, 'drafted': 5, 'unknown': 6}
claims = collections.OrderedDict()
for x in sorted(keep, key=lambda x: (x['photo'], index[x['sid']], x['state'], x['part'] or '')):
    claims.setdefault(x['photo'][:8], []).append([index[x['sid']], descriptors.index(x['state']), parts.index(x['part']) if x['part'] else -1, SIDE[x['side']], STATUS[x['part_from']]])
print(f"{len(rows)} claims -> {len(keep)} to land on {len(claims)} photos; left out: {dict(left_out)}")
photos = list(claims); size = -(-len(photos) // n_parts)
for n in range(n_parts):
    chunk = photos[n * size:(n + 1) * size]
    if not chunk: continue
    text = json.dumps({'d': descriptors, 'p': parts, 'c': {k: claims[k] for k in chunk}}, separators=(',', ':'))
    open(os.path.join(DATA, f'land-part{n + 1}.json'), 'w').write(text)
    print(f"part {n + 1}: {len(chunk)} photos, {sum(len(claims[k]) for k in chunk)} claims, {len(text)} bytes, md5 {hashlib.md5(text.encode()).hexdigest()}")

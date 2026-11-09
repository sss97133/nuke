#!/opt/homebrew/opt/python@3.14/bin/python3.14
"""Step 5 of the art-photos pipeline: works from Apple Vision feature prints. Cosine similarity between every pair of in-scope
photos, union-find at a threshold, one work per connected component. Prints the similarity distribution first so the threshold
is chosen from the data (2026-11-08, the owner's library: 0.9 kept 707 works from 947 photos with 5 seen on more than one day;
0.85 merged scenes, not works), then the works summary. Optional contact sheets of the multi-day works for a human look.
usage: cluster_works.py <workdir> <cos threshold> [contact-sheet-dir]
  <workdir> holds scored.json (score_candidates.py), featureprints.jsonl (featureprint.swift over the exported previews) and previews/."""
import json, os, sys, collections, datetime as dt
import numpy as np
from PIL import Image, ImageOps, ImageDraw

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
TH = float(sys.argv[2]) if len(sys.argv) > 2 else 0.9
SHEETS = sys.argv[3] if len(sys.argv) > 3 else None
scored = {r['uuid']: r for r in json.load(open(os.path.join(ROOT, 'scored.json')))}
paths, vecs, uuids = [], [], []
for line in open(os.path.join(ROOT, 'featureprints.jsonl')):
    o = json.loads(line); u = os.path.basename(o['path']).split('_')[0].upper()
    if u in scored and scored[u]['score'] >= 1:
        paths.append(o['path'] if os.path.isabs(o['path']) else os.path.join(ROOT, o['path'])); uuids.append(u); vecs.append(np.array(o['v'], dtype=np.float32))
X = np.stack(vecs); X = X / np.linalg.norm(X, axis=1, keepdims=True)
S = X @ X.T
n = len(uuids); iu = np.triu_indices(n, 1); sims = S[iu]
qs = np.quantile(sims, [0.5, 0.9, 0.99, 0.999, 0.9999])
print(json.dumps({'photos': n, 'pairs': int(sims.size), 'cos_quantiles_50_90_99_999_9999': [round(float(q), 3) for q in qs],
                  'pairs_over': {str(t): int((sims >= t).sum()) for t in (0.7, 0.75, 0.8, 0.85, 0.9, 0.95)}}))
parent = list(range(n))
def find(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
ii, jj = np.where(np.triu(S, 1) >= TH)
for i, j in zip(ii.tolist(), jj.tolist()):
    ri, rj = find(i), find(j)
    if ri != rj: parent[rj] = ri
groups = collections.defaultdict(list)
for i in range(n): groups[find(i)].append(i)
KIND_RANK = ['billboard', 'mural', 'sculpture', 'painting', 'drawing', 'sketch', 'artwork']
works = []
for root, idx in groups.items():
    ph = sorted((dict(scored[uuids[i]], path=paths[i]) for i in idx), key=lambda r: r['date'] or '')
    kinds = collections.Counter(r['kind'] for r in ph); kind = next(k for k in KIND_RANK if k in kinds)
    days = sorted({(r['date'] or '')[:10] for r in ph if r['date']})
    places = collections.Counter(r['place'] for r in ph if r['place'])
    works.append({'key': 'fp:' + uuids[idx[0]][:8].lower() + ':' + str(len(idx)), 'kind': kind,
                  'labels': sorted({l for r in ph for l in r['labels'] if l in {'painting', 'drawing', 'sketch', 'billboards', 'mural', 'sculpture', 'modern art', 'acrylic paint', 'street art'}}),
                  'photos': [{'uuid': r['uuid'], 'taken_at': r['date'], 'filename': r['filename'], 'labels': r['labels'], 'width': r['width'], 'height': r['height'],
                              'latitude': r['latitude'], 'longitude': r['longitude'], 'camera': r['camera'], 'caption': r['caption'], 'place': r['place'], 'path': r['path']} for r in ph],
                  'first': ph[0]['date'], 'last': ph[-1]['date'], 'sittings': len(days), 'days': days, 'places': places.most_common(3),
                  'captions': [r['caption'] for r in ph if r.get('caption')][:3], 'score': sum(r['score'] for r in ph)})
works.sort(key=lambda w: (-w['sittings'], -len(w['photos']), w['first'] or ''))
json.dump(works, open(os.path.join(ROOT, 'works.json'), 'w'), default=str, indent=1)
multi = [w for w in works if w['sittings'] > 1]
span_days = lambda w: (dt.datetime.fromisoformat(w['last'].replace('Z', '+00:00')) - dt.datetime.fromisoformat(w['first'].replace('Z', '+00:00'))).days if w['first'] and w['last'] else 0
print(json.dumps({'threshold': TH, 'works': len(works), 'photos_in_works': n, 'works_seen_on_more_than_one_day': len(multi),
                  'works_spanning_over_30_days': sum(1 for w in multi if span_days(w) > 30),
                  'by_kind': dict(collections.Counter(w['kind'] for w in works)), 'by_photo_count': dict(sorted(collections.Counter(min(len(w['photos']), 10) for w in works).items())),
                  'top_multi': [{'kind': w['kind'], 'photos': len(w['photos']), 'sittings': w['sittings'], 'first': (w['first'] or '')[:10], 'last': (w['last'] or '')[:10],
                                 'span_days': span_days(w), 'place': (w['places'][:1] or [None])[0], 'caption': (w['captions'][:1] or [None])[0]} for w in multi[:12]]}, indent=1, default=str))
if SHEETS:
    os.makedirs(SHEETS, exist_ok=True)
    for k, w in enumerate(multi[:24]):
        tiles = w['photos'][:8]; T = 240
        sheet = Image.new('RGB', (T * min(len(tiles), 4), T * ((len(tiles) + 3) // 4) + 28), 'white'); d = ImageDraw.Draw(sheet)
        for t, p in enumerate(tiles):
            try:
                im = ImageOps.exif_transpose(Image.open(p['path'])).convert('RGB'); im.thumbnail((T, T)); sheet.paste(im, ((t % 4) * T + (T - im.width) // 2, (t // 4) * T + (T - im.height) // 2))
            except Exception: pass
        d.text((6, sheet.height - 22), f"{w['kind']} · {len(w['photos'])} photos · {w['sittings']} days · {(w['first'] or '')[:10]} to {(w['last'] or '')[:10]} · {(w['places'][:1] or [('',0)])[0][0][:40]}", fill='black')
        sheet.save(os.path.join(SHEETS, f"work_{k:02d}_{w['kind']}_{w['sittings']}d.jpg"), quality=85)
    print('sheets', min(len(multi), 24), 'in', SHEETS)

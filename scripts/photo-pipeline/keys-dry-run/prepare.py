#!/usr/bin/env python3
"""Turn the result of pull.sql into the inputs of a dry run. Writes only inside the private data folder.

usage: KEYS_DRY_RUN_DATA=<folder> prepare.py --context "<vehicle kind and job in hand, one paragraph>" [--batches 30]
Reads <folder>/raw.json. Writes units/<photo>.json (one photo each), in/chunk-NN.json (batches that keep a photo's
statements together and mix the scenes), statements_all.json, receipt_lines_full.json, in/receipt-N.json,
in/registry.md, and copies the pending decisions beside them when none is there yet.
"""
import collections, json, os, re, shutil, sys

CODE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('KEYS_DRY_RUN_DATA')
if not DATA: sys.exit('set KEYS_DRY_RUN_DATA to the private data folder')
args = sys.argv[1:]
opt = lambda name, dflt=None: (args[args.index(name) + 1] if name in args else dflt)
context = opt('--context'); n_batches = int(opt('--batches', '30'))
if not context: sys.exit('--context is required: the vehicle kind and the job in hand')

raw = json.load(open(os.path.join(DATA, 'raw.json')))
if isinstance(raw, list): raw = raw[0]
raw = raw.get('r', raw)
for d in ('units', 'in', 'out'): os.makedirs(os.path.join(DATA, d), exist_ok=True)

photos = [p for p in raw['photos'] if p['callouts']]
short = collections.Counter(p['id'][:8] for p in raw['photos'])
assert max(short.values()) == 1, 'two photos share the first eight characters of their id'

# statement ids in capture order; photos taken in the same minute are ordered by scene, then as the query returned them
statements = []; n = 0
order = {p['id']: i for i, p in enumerate(raw['photos'])}
for p in sorted(photos, key=lambda p: (p['ts'], p['scene'] or '', order[p['id']])):
    for text in p['callouts']:
        n += 1
        statements.append({'id': 's%04d' % n, 'photo': p['id'][:8], 'photo_full': p['id'], 'day': p['day'], 'scene': p['scene'], 'text': re.sub(r'\s+', ' ', text.strip())})
json.dump(statements, open(os.path.join(DATA, 'statements_all.json'), 'w'))

by_photo = collections.OrderedDict()
for s in statements: by_photo.setdefault(s['photo'], []).append(s)
for photo, ss in by_photo.items():
    json.dump({'photo': photo, 'capture_day': ss[0]['day'], 'scene': ss[0]['scene'], 'reader': 'reviewed deep reading',
               'statements': [{'id': s['id'], 'text': s['text']} for s in ss]}, open(os.path.join(DATA, 'units', f'{photo}.json'), 'w'), indent=1)

# batches: photos dealt round-robin by scene then time, so each batch is a mix and a photo is never split
ordered = sorted(by_photo.values(), key=lambda v: (v[0]['scene'] or '', v[0]['day'], v[0]['id']))
batches = [[] for _ in range(n_batches)]
for i, ss in enumerate(ordered): batches[i % n_batches].extend(ss)
for i, b in enumerate(batches):
    b.sort(key=lambda s: s['id'])
    json.dump({'reader': 'reviewed deep reading', 'statements': [{k: s[k] for k in ('id', 'photo', 'day', 'scene', 'text')} for s in b]},
              open(os.path.join(DATA, 'in', 'chunk-%02d.json' % i), 'w'), indent=0)

# receipt lines the model has already asked about, with what was answered; prices are left behind
items = {}
field = lambda p, k: (re.search(r'"%s": (?:"([^"]*)"|null)' % k, p) or [None, None])[1]
for j in raw.get('judgment') or []:
    it = items.setdefault(j['subject_id'], {'item': j['subject_id'], 'description': None, 'zone': None, 'end_hint': None, 'bought': None, 'asked': 0, 'answers': []})
    it['asked'] += 1
    for k in ('description', 'zone', 'end_hint'): it[k] = it[k] or field(j['params'], k)
    it['bought'] = it['bought'] or field(j['params'], 'anchor_date') or field(j['params'], 'purchase_date')
    if j['status'] in ('answered', 'withdrawn') and j.get('answer'):
        a = j['answer']; it['answers'].append({k: a.get(k) for k in ('visible', 'installed', 'confidence', 'quote')} | {'photo': a.get('image_id'), 'status': j['status']})
lines = []
for i, it in enumerate(sorted(items.values(), key=lambda it: (it['bought'] or '', it['description'] or '')), 1):
    cur = [a for a in it['answers'] if a['status'] == 'answered']
    it['line'] = 'r%03d' % i
    it['verdict'] = ('visible+installed' if any(a['visible'] == 'yes' and a['installed'] == 'yes' for a in cur) else 'visible only' if any(a['visible'] == 'yes' for a in cur)
                     else 'not visible' if any(a['visible'] == 'no' for a in cur) else 'cannot tell' if cur else 'none')
    lines.append(it)
json.dump(lines, open(os.path.join(DATA, 'receipt_lines_full.json'), 'w'), indent=1)
asked = [{k: l[k] for k in ('line', 'description', 'zone', 'end_hint', 'bought')} for l in lines if l['description']]
for b in range(3):
    json.dump({'note': 'Receipt lines for parts bought for this vehicle. Key the PART only.', 'lines': asked[b::3]}, open(os.path.join(DATA, 'in', f'receipt-{b}.json'), 'w'), indent=0)

open(os.path.join(DATA, 'in', 'registry.md'), 'w').write(
    '# Keys dry run input (PRIVATE: one owner vehicle; never copy into the repository)\n\n## Context\n' + context.strip() + '\n\n'
    + open(os.path.join(CODE, 'registry.snapshot.md')).read().split('## Registry snapshot', 1)[1].join(['## Registry snapshot', '']))
seed = os.path.join(DATA, 'decisions-v1.json')
if not os.path.exists(seed): shutil.copy(os.path.join(CODE, 'decisions.pending.2026-11-10.json'), seed)
json.dump({'from': 'keys drafted on the first vehicle keyed; pending, not approved', 'drafted_part_keys': [json.load(open(os.path.join(CODE, 'registry.snapshot.json')))['k10_parts']], 'proposals': []},
          open(os.path.join(DATA, 'k10_seed.json'), 'w'), indent=1)
print(f'{len(statements)} statements on {len(by_photo)} photos, {n_batches} batches, {len(lines)} receipt lines -> {DATA}')

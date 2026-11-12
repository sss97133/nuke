#!/usr/bin/env python3
"""The batch-context step, in code: check every photo, fold repeats, join receipts, answer the three question shapes.

usage: fold.py [--map draft-map.json] [--json fold.json]
Reads out/chunk-*.json, out/receipt-*.json, statements_all.json, receipt_lines_full.json, decisions-v1.json.
"""
import json, glob, os, sys, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_units import check_unit, load_decisions, HERE, SUBJECT, COND, PROPS, is_stem

args = sys.argv[1:]
opt = lambda name: (args[args.index(name) + 1] if name in args else None)
draft_map = json.load(open(opt('--map'))) if opt('--map') else {}
dp, ds = load_decisions(os.path.join(HERE, 'decisions-v1.json'))
ST = {s['id']: s for s in json.load(open(os.path.join(HERE, 'statements_all.json')))}

# 1. every photo through the code check; a photo that fails is left out and listed
by_photo = collections.defaultdict(list); proposals = collections.defaultdict(list); seen_sid = collections.Counter()
chunks = sorted(glob.glob(os.path.join(HERE, 'out', 'chunk-*.json')))
for path in chunks:
    c = json.load(open(path))
    for r in c['results']:
        seen_sid[r['sid']] += 1
        if r['sid'] in ST: by_photo[ST[r['sid']]['photo']].append(r)
    for r in c['results']:
        if r['sid'] in ST: proposals[ST[r['sid']]['photo']] = c.get('proposals', [])
ok_photos, rejected = {}, {}
for photo, rs in by_photo.items():
    problems, _ = check_unit({'photo': photo, 'results': rs, 'proposals': proposals[photo]}, dp, ds)
    (rejected if problems else ok_photos)[photo] = problems or rs
missing = sorted(set(ST) - set(seen_sid)); dup = sorted(s for s, n in seen_sid.items() if n > 1)

# 2. one row per claim, with the part and the state resolved the same way for every photo
def part_of(p):
    k, side, d = p.get('key'), p.get('side'), p.get('decision')
    k = draft_map.get(k, k)
    if k is None: return None, None, 'unknown'
    if k not in SUBJECT and side and f'{k}.{side}' in SUBJECT: k = f'{k}.{side}'
    if k in SUBJECT: return k, SUBJECT[k] or (side if side != 'center' else None), 'registry'
    if is_stem(k): return k, side, 'registry (side not said)'
    if is_stem(k, dp) and k not in dp: return k, side, 'decided this run (which one not said)'
    return k, (side if side != 'center' else None), ('decided this run' if k in dp else 'drafted')
def state_of(s):
    prop, val = s.get('property_key'), s.get('value_or_key')
    val = draft_map.get(val, val)
    if prop in PROPS and val in PROPS[prop]: return f'{prop}={val}', 'registry property'
    if prop is None and val in COND: return val, 'registry condition key'
    return (f'{prop}={val}' if prop else val), 'drafted'
FLAW = re.compile(r'(rust_severity=(surface|pitting|perforation)|oxidation|pitting|perforation|paint\.(loss|blister|delamin|fading|crazing|orange)|scratch|deformation|distortion|alignment|discoloration|fracture|crack|tear|wear|sagging|staining|soiling|hazing|missing|absent|corrosion|seepage|uv_degradation|bent|rot|filler|chip|rough|uneven)')
rows = []; kinds = collections.Counter()
for photo, rs in ok_photos.items():
    for r in rs:
        s = ST[r['sid']]
        if not r.get('claims'): kinds['not a claim' if r.get('not_a_claim') else 'question only'] += 1; continue
        kinds['statements with a claim'] += 1
        for c in r['claims']:
            pk, side, pwhere = part_of(c['part']); sk, swhere = state_of(c['state'])
            rows.append({'sid': r['sid'], 'photo': s['photo_full'], 'day': s['day'], 'scene': s['scene'], 'part': pk, 'side': side, 'part_from': pwhere,
                         'state': sk, 'state_from': swhere, 'flaw': bool(FLAW.search(sk or '')), 'said': c.get('said'), 'text': s['text']})

# 3. fold: same part, side, state and capture day is one claim with every photo as witness
folds = collections.OrderedDict()
for x in rows:
    if x['part'] is None: continue
    folds.setdefault((x['part'], x['side'], x['state'], x['day']), []).append(x)

# 4. receipts, keyed with the same part vocabulary
R = {l['line']: l for l in json.load(open(os.path.join(HERE, 'receipt_lines_full.json')))}
for path in sorted(glob.glob(os.path.join(HERE, 'out', 'receipt-*.json'))):
    for rp in json.load(open(path))['receipt_parts']:
        if rp['line'] in R:
            pk, side, where = part_of(rp.get('part') or {}) if rp.get('kind') == 'part' else (None, None, 'not a part')
            R[rp['line']].update({'part': pk, 'side': side, 'part_from': where})
stem = lambda k: re.sub(r'\.(driver|passenger)$', '', k or '')
claims_by_part = collections.defaultdict(list)
for x in rows:
    if x['part']: claims_by_part[stem(x['part'])].append(x)

keyed_full = [x for x in rows if x['part'] and x['part_from'].startswith('registry') and x['state_from'].startswith('registry')]
out = {
    'photos_checked': len(by_photo), 'photos_pass': len(ok_photos), 'photos_rejected': {p: v for p, v in rejected.items()},
    'statements': len(ST), 'statements_keyed': sum(seen_sid.values()), 'statements_missing': missing, 'statements_twice': dup,
    'statement_kinds': dict(kinds), 'claims': len(rows),
    'claims_part': dict(collections.Counter(x['part_from'] for x in rows)), 'claims_state': dict(collections.Counter(x['state_from'] for x in rows)),
    'claims_part_and_state_in_registry': len(keyed_full),
    'folded_claims': len(folds), 'folded_with_2plus_photos': sum(1 for v in folds.values() if len({x['photo'] for x in v}) > 1),
    'drafted_part_keys': dict(collections.Counter(x['part'] for x in rows if x['part_from'] == 'drafted').most_common()),
    'drafted_states': dict(collections.Counter(x['state'] for x in rows if x['state_from'] == 'drafted').most_common()),
}
print(json.dumps({k: (len(v) if k in ('statements_missing', 'statements_twice') else v) for k, v in out.items() if k not in ('drafted_part_keys', 'drafted_states', 'photos_rejected')}, indent=1))
print('rejected photos:', len(rejected)); [print('  ', p, v[:2]) for p, v in list(rejected.items())[:10]]
print('drafted part keys:', len(out['drafted_part_keys']), list(out['drafted_part_keys'].items())[:40])
print('drafted states:', len(out['drafted_states']), list(out['drafted_states'].items())[:40])

print('\n=== Q1 shape: a part that was bought and is seen installed, with the photo ===')
q1 = [l for l in R.values() if l.get('verdict') == 'visible+installed']
for l in sorted(q1, key=lambda l: l['bought'] or '')[:40]:
    a = next(a for a in l['answers'] if a['visible'] == 'yes' and a['installed'] == 'yes' and a['status'] == 'answered')
    also = len(claims_by_part.get(stem(l.get('part')), []))
    print(f"  bought {l['bought']} | {l['description']:<38} | part {l.get('part')} | photo {str(a['photo'])[:8]} | photo statements on that part: {also}")
print(f"  total: {len(q1)} receipt lines of {len(R)}")

print('\n=== Q2 shape: imperfections on this car, by part, with witness photos ===')
flawfolds = [(k, v) for k, v in folds.items() if v[0]['flaw']]
byp = collections.defaultdict(list)
for k, v in flawfolds: byp[(k[0], k[1])].append((k, v))
for (part, side), items in sorted(byp.items(), key=lambda kv: -sum(len({x['photo'] for x in v}) for _, v in kv[1]))[:25]:
    photos = {x['photo'] for _, v in items for x in v}
    print(f"  {part}{' [' + side + ']' if side else ''}: {len(items)} folded flaw claims, {len(photos)} photos: " + '; '.join(sorted({k[2] for k, _ in items}))[:150])
print(f"  total: {len(flawfolds)} folded flaw claims on {len(byp)} parts")

print('\n=== Q3 shape: a flaw on a part, and that part bought or later seen without the flaw ===')
n3 = 0
for part, xs in sorted(claims_by_part.items()):
    flaws = [x for x in xs if x['flaw']]
    if not flaws: continue
    lines = [l for l in R.values() if stem(l.get('part')) == part]
    days = sorted({x['day'] for x in flaws})
    later_clean = [x for x in xs if not x['flaw'] and x['day'] > days[0]]
    if lines:
        n3 += 1
        print(f"  {part}: flaw seen {days[0]}{' ..' + days[-1] if len(days) > 1 else ''} in {len({x['photo'] for x in flaws})} photos ({'; '.join(sorted({x['state'] for x in flaws}))[:80]})")
        for l in lines[:4]: print(f"       receipt {l['line']} bought {l['bought']}: {l['description']} -> {l.get('verdict')}")
        if later_clean: print(f"       later photos without a flaw statement on it: {len({x['photo'] for x in later_clean})}")
print(f"  parts with both a flaw claim and a receipt line: {n3}")
if opt('--json'):
    json.dump({'summary': out, 'rows': rows, 'folds': [{'part': k[0], 'side': k[1], 'state': k[2], 'day': k[3], 'photos': sorted({x['photo'] for x in v}), 'statements': sorted({x['sid'] for x in v})} for k, v in folds.items()],
               'receipts': list(R.values())}, open(opt('--json'), 'w'), indent=1)

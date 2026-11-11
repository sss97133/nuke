#!/usr/bin/env python3
"""Same statements keyed two ways: one photo per agent, and many photos in one batch. Where do they agree?

usage: compare.py <batch chunk file> <single workflow outputs...> [--decisions decisions.json]
"""
import json, sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_units import check_unit, load_decisions, units_from, HERE, SUBJECT

args = sys.argv[1:]
dec = None
if '--decisions' in args: i = args.index('--decisions'); dec = args[i + 1]; del args[i:i + 2]
dp, ds = load_decisions(dec)
batch_path, single_paths = args[0], args[1:]

# statement -> photo
sid_photo = {}
for f in os.listdir(os.path.join(HERE, 'units')):
    u = json.load(open(os.path.join(HERE, 'units', f)))
    for s in u['statements']: sid_photo[s['id']] = (u['photo'], s['text'])

batch = json.load(open(batch_path))
b_by_photo = collections.defaultdict(list)
for r in batch['results']: b_by_photo[sid_photo[r['sid']][0]].append(r)
b_units = [{'photo': p, 'results': rs, 'proposals': batch.get('proposals', [])} for p, rs in b_by_photo.items()]
s_units = [u['result'] for path in single_paths for u in units_from(path) if u.get('result')]
missing = [u['photo'] for path in single_paths for u in units_from(path) if not u.get('result')]


def gate(units, label):
    ok = bad = 0; c = collections.Counter(); reasons = []
    for u in units:
        problems, counts = check_unit(u, dp, ds); c.update(counts)
        if problems: bad += 1; reasons += [f"{u['photo']}: {p}" for p in problems]
        else: ok += 1
    print(f"{label}: {ok} photos pass the code check, {bad} rejected | {dict(c)}")
    for r in reasons[:12]: print('    -', r)
    return c

print(f"photos: batch {len(b_units)}, singles {len(s_units)}" + (f", singles with no result: {missing}" if missing else ''))
cb = gate(b_units, 'batch  ')
cs = gate(s_units, 'singles')

B = {r['sid']: r for u in b_units for r in u['results']}
S = {r['sid']: r for u in s_units for r in u['results']}
both = sorted(set(B) & set(S))
def side_of(part):
    # the registry fixes the side of a sided or centre key; on any other key "center" says no more than null
    k, s = part.get('key'), part.get('side')
    if k in SUBJECT and SUBJECT[k]: return SUBJECT[k]
    return '-' if s in (None, 'center') else s
sig = lambda r: sorted((c['part'].get('key') or '?', side_of(c['part']), c['state'].get('property_key') or '', c['state'].get('value_or_key') or '') for c in r.get('claims') or [])
parts = lambda r: sorted({(c['part'].get('key') or '?') for c in r.get('claims') or []})
states = lambda r: sorted({(c['state'].get('property_key') or '') + '=' + (c['state'].get('value_or_key') or '') for c in r.get('claims') or []})
is_claim = lambda r: bool(r.get('claims'))
same_kind = [s for s in both if is_claim(B[s]) == is_claim(S[s])]
both_claims = [s for s in both if is_claim(B[s]) and is_claim(S[s])]
same_parts = [s for s in both_claims if parts(B[s]) == parts(S[s])]
same_states = [s for s in both_claims if states(B[s]) == states(S[s])]
same_all = [s for s in both_claims if sig(B[s]) == sig(S[s])]
existing_only = [s for s in both_claims if all(k in SUBJECT or k == '?' for k in parts(B[s]) + parts(S[s]))]
print(f"\nstatements keyed both ways: {len(both)}")
print(f"  agree on claim vs not a claim: {len(same_kind)} of {len(both)}")
print(f"  both made claims: {len(both_claims)}; same parts {len(same_parts)}, same states {len(same_states)}, identical {len(same_all)}")
print(f"  of those, statements where both used only existing part keys: {len(existing_only)}; same parts there: {len([s for s in existing_only if parts(B[s]) == parts(S[s])])}")
print("\ndisagreements:")
for s in both:
    if is_claim(B[s]) != is_claim(S[s]) or sig(B[s]) != sig(S[s]):
        print(f"  {s}: \"{sid_photo[s][1][:110]}\"")
        print(f"     batch : {sig(B[s]) or 'not a claim'}")
        print(f"     single: {sig(S[s]) or 'not a claim'}")

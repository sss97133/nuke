#!/usr/bin/env python3
"""The code check on one photo's keyed result. A result that fails is not counted.

usage: check_units.py <workflow-output.json> [more outputs...] [--decisions decisions.json] [--show]
Reads registry.snapshot.json beside this file and the unit inputs (units/<photo>.json) in the data folder
(KEYS_DRY_RUN_DATA). It checks, for every statement of the photo: accounted for exactly once; the quoted words are
in the reading; a part marked existing is a registry key; a part marked decided is in the decisions; a drafted key
is in the registry's pattern and has a proposal; a property value is a listed value; no baseline or score key.
"""
import json, re, sys, os, collections

CODE = os.path.dirname(os.path.abspath(__file__))
# Private inputs and outputs live outside the repository: set KEYS_DRY_RUN_DATA to that folder.
HERE = os.environ.get('KEYS_DRY_RUN_DATA') or CODE
REG = json.load(open(os.path.join(CODE, 'registry.snapshot.json')))
SUBJECT, COND, PROPS = REG['subject'], REG['condition'], REG['properties']
BEFORE_PARTS = set(REG['k10_parts']); BEFORE_STATE = set(REG['k10_other'])
KEY_SHAPE = re.compile(r'^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$')
norm = lambda s: re.sub(r'\s+', ' ', str(s)).strip().lower().strip('.…')


def load_decisions(path):
    if not path or not os.path.exists(path): return set(), set()
    d = json.load(open(path))
    parts = {x['key'] for x in d.get('part_decisions', []) if x.get('key')}
    states = set()
    for x in d.get('state_decisions', []):
        if x.get('value_or_key'): states.add(x['value_or_key']); states.add((x.get('property_key'), x['value_or_key']))
    return parts, states


def is_stem(key, also=()):
    """A sided or front/rear key written without its last word: the part is known, which one is not said."""
    return bool(key) and (any(k.startswith(key + '.') for k in SUBJECT) or any(k.startswith(key + '.') for k in also))


def check_unit(unit, dec_parts=frozenset(), dec_states=frozenset(), texts=None):
    """Returns (problems, counts). problems is a list of strings; empty means the unit passes."""
    problems = []
    photo = unit.get('photo')
    if texts is None:
        src_path = os.path.join(HERE, 'units', f'{photo}.json')
        if not os.path.exists(src_path): return [f'no such photo: {photo}'], {}
        texts = {s['id']: s['text'] for s in json.load(open(src_path))['statements']}
    res = unit.get('results') or []
    got = [r.get('sid') for r in res]
    if sorted(got) != sorted(texts): problems.append(f'statements not accounted for exactly once: expected {sorted(texts)}, got {sorted(got)}')
    proposed = {(p.get('kind'), p.get('key')) for p in unit.get('proposals') or []}
    proposed_keys = {k for _, k in proposed}
    counts = collections.Counter()
    for r in res:
        sid = r.get('sid'); text = texts.get(sid, '')
        claims = r.get('claims') or []
        if not claims and not r.get('not_a_claim') and not r.get('question'): problems.append(f'{sid}: neither a claim, a reason it is not one, nor a question')
        if not claims: counts['not_a_claim' if r.get('not_a_claim') else 'question'] += 1
        for c in claims:
            counts['claims'] += 1
            part, state, said = c.get('part') or {}, c.get('state') or {}, c.get('said') or ''
            if norm(said) not in norm(text): problems.append(f'{sid}: quoted words are not in the reading: "{said[:60]}"')
            pd, pk, side = part.get('decision'), part.get('key'), part.get('side')
            if side not in ('driver', 'passenger', 'center', None): problems.append(f'{sid}: side {side!r} is not a listed side')
            if pd == 'existing':
                if pk not in SUBJECT and side and f'{pk}.{side}' in SUBJECT: pk = f'{pk}.{side}'
                if pk not in SUBJECT: problems.append(f'{sid}: part key {pk!r} is marked existing but is not in the registry')
                elif SUBJECT[pk] and side not in (SUBJECT[pk], None): problems.append(f'{sid}: part key {pk!r} is the {SUBJECT[pk]} one but side says {side}')
                counts['part_existing'] += 1
            elif pd == 'decided_before':
                if pk not in BEFORE_PARTS and pk not in dec_parts: problems.append(f'{sid}: part key {pk!r} is marked decided before but no decision has it')
                counts['part_decided_before'] += 1
            elif pd == 'no_place':
                if not pk or not KEY_SHAPE.match(pk): problems.append(f'{sid}: drafted part key {pk!r} is not in the registry\'s pattern')
                elif pk in SUBJECT: problems.append(f'{sid}: part key {pk!r} is marked as drafted but already exists')
                elif pk not in proposed_keys: problems.append(f'{sid}: drafted part key {pk!r} has no proposal')
                counts['part_drafted'] += 1
            elif pd == 'unknown':
                if pk is None: counts['part_unknown'] += 1
                elif is_stem(pk, dec_parts) and side is None: counts['part_known_side_unknown'] += 1
                else: problems.append(f'{sid}: part is marked unknown but carries key {pk!r}, which is not a sided key written without its side')
            else: problems.append(f'{sid}: part decision {pd!r} is not a listed decision')
            sd, prop, val = state.get('decision'), state.get('property_key'), state.get('value_or_key')
            if re.search(r'(baseline|assessed|score)', str(val or '')): problems.append(f'{sid}: {val!r} is a baseline, score or assessed key')
            if sd in ('property', 'decided_before') and (prop, val) in dec_states and prop not in PROPS:
                counts['state_decided_before'] += 1
            elif sd == 'property':
                if prop not in PROPS: problems.append(f'{sid}: property {prop!r} is not in the registry')
                elif val not in PROPS[prop]: problems.append(f'{sid}: {val!r} is not a listed value of {prop}')
                counts['state_property'] += 1
            elif sd == 'condition_key':
                if val not in COND: problems.append(f'{sid}: condition key {val!r} is not in the registry')
                counts['state_condition_key'] += 1
            elif sd == 'decided_before':
                if val not in BEFORE_STATE and val not in dec_states and val not in COND and not any(val in v for v in PROPS.values()): problems.append(f'{sid}: state {val!r} is marked decided before but no decision has it')
                counts['state_decided_before'] += 1
            elif sd == 'no_place':
                if not val or (val not in proposed_keys and f'{prop}={val}' not in proposed_keys and not any(val in (k or '') for k in proposed_keys)): problems.append(f'{sid}: drafted state {val!r} has no proposal')
                counts['state_drafted'] += 1
            else: problems.append(f'{sid}: state decision {sd!r} is not a listed decision')
    return problems, counts


def units_from(path):
    o = json.load(open(path)); r = o.get('result', o) if isinstance(o, dict) else o
    return [x for x in r if isinstance(x, dict)]


def main():
    args = sys.argv[1:]; show = '--show' in args; args = [a for a in args if a != '--show']
    dec = None
    if '--decisions' in args: i = args.index('--decisions'); dec = args[i + 1]; del args[i:i + 2]
    dp, ds = load_decisions(dec)
    total = collections.Counter(); passed = failed = empty = 0
    for path in args:
        for u in units_from(path):
            unit = u.get('result')
            if not unit: empty += 1; print(f"{u.get('photo')}: NO RESULT"); continue
            problems, counts = check_unit(unit, dp, ds)
            total.update(counts)
            if problems: failed += 1; print(f"{unit.get('photo')}: REJECTED"); [print('   -', p) for p in problems]
            else: passed += 1; print(f"{unit.get('photo')}: passes ({dict(counts)})")
            if show:
                src = json.load(open(os.path.join(HERE, 'units', f"{unit.get('photo')}.json")))
                texts = {s['id']: s['text'] for s in src['statements']}
                print(f"   photo {src['photo']}, taken {src['capture_day']}, scene {src['scene']}")
                for r in unit.get('results') or []:
                    print(f"   {r['sid']}: \"{texts.get(r['sid'], '?')}\"")
                    for c in r.get('claims') or []:
                        p, s = c['part'], c['state']
                        st = f"{s['property_key']} = {s['value_or_key']}" if s.get('property_key') else s['value_or_key']
                        print(f"      -> part {p['key']} ({p['decision']}{', ' + p['side'] if p.get('side') else ''}) | state {st} ({s['decision']})")
                    if r.get('not_a_claim'): print(f"      -> not a claim: {r['not_a_claim']}")
                    if r.get('question'): print(f"      -> question: {r['question']}")
                for p in unit.get('proposals') or []: print(f"   proposal ({p['kind']}): {p['key']}  nearest: {p['nearest_existing']}")
                if unit.get('unsure') and unit['unsure'].lower() != 'nothing': print(f"   unsure: {unit['unsure']}")
    print(f"\nunits: {passed} pass, {failed} rejected, {empty} no result | {dict(total)}")


if __name__ == '__main__': main()

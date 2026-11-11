#!/usr/bin/env python3
"""python3 scripts/photo-pipeline/keys-dry-run/test_check_units.py
The code check is the part of the dry run that does not depend on any agent. These cases must keep failing."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_units import check_unit

TEXTS = {'s1': 'Surface rust on the driver door lower edge.', 's2': 'Reflections prevent assessment of the roof.'}
claim = lambda part, state, said='Surface rust on the driver door': {'part': part, 'state': state, 'said': said}
RUST = {'decision': 'property', 'property_key': 'image_visible_rust_severity', 'value_or_key': 'surface'}
DOOR = {'decision': 'existing', 'key': 'door.front.driver', 'side': 'driver'}
HEDGE = {'sid': 's2', 'claims': [], 'not_a_claim': 'a limit of the photo', 'question': None}
unit = lambda claims, proposals=(), rest=(HEDGE,): {'photo': 'p', 'results': [{'sid': 's1', 'claims': claims, 'not_a_claim': None, 'question': None}, *rest], 'proposals': list(proposals)}
problems = lambda u: check_unit(u, texts=TEXTS)[0]

assert problems(unit([claim(DOOR, RUST)])) == [], 'a true claim with registry keys passes'
assert any('not accounted for' in p for p in problems(unit([claim(DOOR, RUST)], rest=()))), 'a dropped statement fails'
assert any('not in the reading' in p for p in problems(unit([claim(DOOR, RUST, said='perforation through the door')]))), 'invented words fail'
assert any('not in the registry' in p for p in problems(unit([claim({'decision': 'existing', 'key': 'door.made.up', 'side': None}, RUST)]))), 'an invented existing key fails'
assert any('but side says' in p for p in problems(unit([claim({'decision': 'existing', 'key': 'door.front.driver', 'side': 'passenger'}, RUST)]))), 'a side that contradicts its key fails'
assert any('not a listed value' in p for p in problems(unit([claim(DOOR, {'decision': 'property', 'property_key': 'image_visible_rust_severity', 'value_or_key': 'heavy'})]))), 'a value off the list fails'
assert any('has no proposal' in p for p in problems(unit([claim({'decision': 'no_place', 'key': 'door.hinge.pin', 'side': None}, RUST)]))), 'a drafted key with no proposal fails'
assert problems(unit([claim({'decision': 'no_place', 'key': 'door.hinge.pin', 'side': None}, RUST)], proposals=[{'kind': 'part', 'key': 'door.hinge.pin'}])) == [], 'a drafted key with its proposal passes'
assert any('pattern' in p for p in problems(unit([claim({'decision': 'no_place', 'key': 'Hinge', 'side': None}, RUST)], proposals=[{'kind': 'part', 'key': 'Hinge'}]))), 'a draft outside the naming pattern fails'
assert any('baseline' in p for p in problems(unit([claim(DOOR, {'decision': 'condition_key', 'property_key': None, 'value_or_key': 'exterior.assessed.baseline'})]))), 'a baseline key fails'
assert problems(unit([claim({'decision': 'unknown', 'key': 'door.front', 'side': None}, RUST)])) == [], 'a sided part with no side said is kept without a side'
assert any('marked unknown but carries key' in p for p in problems(unit([claim({'decision': 'unknown', 'key': 'door.made.up', 'side': None}, RUST)]))), 'an unknown part may not carry an invented key'
assert any('neither a claim' in p for p in problems(unit([claim(DOOR, RUST)], rest=({'sid': 's2', 'claims': [], 'not_a_claim': None, 'question': None},)))), 'an empty entry fails'
print('check_units: 13 cases pass')

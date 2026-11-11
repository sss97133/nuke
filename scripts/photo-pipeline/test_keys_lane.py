#!/usr/bin/env python3
"""python3 scripts/photo-pipeline/test_keys_lane.py
The keys lane with no network: the database and the claude CLI are stand-ins. Every id and statement here is invented."""
import ast, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import keys_lane
from keys_lane import body_for, jsonb, landable, read_envelope, run, utc_ms

V, U = '1b1b1b1b-2222-4333-8444-555555555555', '66666666-7777-4888-8999-aaaaaaaaaaaa'
P1, P2, P3 = ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003')
S1 = '99999999-8888-4777-8666-555555555555'
ENV = {'SUPABASE_URL': 'https://db.example.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'service-key-stand-in', 'CLAUDE_CODE_OAUTH_TOKEN': 'token-stand-in'}
STATEMENT = 'Paint is flaking on the  driver door lower edge.'   # two spaces: the body carries the stored text, not a tidied one
photo = lambda pid, **over: {'id': pid, 'taken_at': '2024-03-09T16:05:07.98765-07:00', 'created_at': '2024-03-10T01:02:03+00:00',
                             'image_url': 'https://img.example.invalid/1.jpg', 'scene': 'exterior_detail',
                             'callouts': [STATEMENT, 'Glare hides the roof.'], 'reader_model': 'reader-model-b', 'prompt_version': 'deep-v3', **over}
SUBJECT_ROWS = [{'subject_key': k, 'side': s} for k, s in (('door.front.driver', 'driver'), ('door.front.passenger', 'passenger'), ('interior.dashboard', 'center'), ('interior.seat.front.driver', 'driver'))]
FRAGMENT = 'manual.sec_6a.fig_12.clearance'   # live in the table and not in the curated list: stands for a service-manual fragment
CONDITION_ROWS = [{'canonical_key': k, 'descriptor_type': t} for k, t in (('exterior.body.deformation', 'mechanism'), ('exterior.paint.delamination', 'mechanism'), ('exterior.paint.respray', 'state'), ('interior.dashboard.cracking', 'mechanism'), (FRAGMENT, 'mechanism'))]
DOOR = {'decision': 'existing', 'key': 'door.front.driver', 'side': 'driver'}
on_key = lambda key, decision='condition_key': {'decision': decision, 'property_key': None, 'value_or_key': key}
FLAKING, DENT = on_key('exterior.paint.delamination'), on_key('exterior.body.deformation')
claim = lambda state=FLAKING, said='Paint is flaking on the driver door', part=DOOR: {'part': part, 'state': state, 'said': said}
unit = lambda said='Paint is flaking on the driver door': {'photo': 'aaaaaaaa', 'proposals': [], 'unsure': 'nothing', 'results': [
    {'sid': 'c0', 'claims': [{'part': DOOR, 'state': FLAKING, 'said': said}], 'not_a_claim': None, 'question': None},
    {'sid': 'c1', 'claims': [], 'not_a_claim': 'a limit of the photo', 'question': None}]}
# the same result with any claims on its first statement, and a model stand-in that answers with one value
answer_of = lambda *claims, proposals=(): {**unit(), 'proposals': list(proposals), 'results': [{'sid': 'c0', 'claims': list(claims), 'not_a_claim': None, 'question': None}, unit()['results'][1]]}
says = lambda value: lambda prompt, model: {'ok': True, 'value': value}
NEW = {'success': True, 'duplicate': False, 'observation_id': S1}
PAUSES = []   # the waits between re-sends, recorded and not waited


class Lost(TimeoutError):
    """The connection dropped before the writer's answer arrived. committed: the writer had stored the row first."""
    def __init__(self, committed=False): super().__init__('no answer'); self.committed = committed


def answers(*script):
    """A writer that gives each POST the next scripted answer, (status, body) or an exception to raise, and then says new."""
    left = list(script)
    def writer(body):
        said = left.pop(0) if left else (200, NEW)
        if isinstance(said, Exception): raise said
        return said
    return writer


class Database:
    """Stands in for PostgREST and the writer. Records every call. Like the writer, it answers duplicate to bytes it
    has stored, so a re-send that differed by a byte would land a second row and show in the count."""
    def __init__(self, photos, keyed=(), reading=(), writer=answers(), lands=True):
        self.photos, self.keyed, self.reading, self.writer, self.lands, self.calls, self.stored = photos, list(keyed), list(reading), writer, lands, [], []
    def __call__(self, method, url, headers, body=None):
        self.calls.append((method, url, body))
        assert headers['Authorization'] == 'Bearer service-key-stand-in'
        if method == 'POST':
            if body in self.stored: return 200, {}, json.dumps({'success': True, 'duplicate': True, 'observation_id': S1, 'message': 'Observation already exists'})
            try: status, answer = self.writer(json.loads(body))
            except Lost as lost:
                if lost.committed: self.stored.append(body)
                raise
            if self.lands and status == 200 and answer.get('success') and not answer.get('duplicate'): self.stored.append(body)
            return status, {}, json.dumps(answer)
        path = url.split('/rest/v1/')[1]; table = path.split('?')[0]
        offset = int((re.search(r'offset=(\d+)', path) or [0, 0])[1])
        lane_rows = self.keyed + [json.loads(b)['source_identifier'] for b in self.stored]
        if method == 'HEAD': return 200, {'content-range': '0-0/%d' % (len(self.photos) if table == 'vehicle_images' else len(lane_rows))}, ''
        if table == 'vehicle_images':
            after = re.search(r'id=gt\.([0-9a-f-]+)', path)
            return 200, {}, json.dumps([p for p in self.photos if not after or p['id'] > after[1]])
        rows = (SUBJECT_ROWS if table == 'subject_taxonomy' else CONDITION_ROWS if table == 'condition_taxonomy'
                else self.reading if 'reviewed_image_analysis_v1' in path else [{'source_identifier': s} for s in lane_rows])
        return 200, {}, json.dumps(rows[offset:offset + 1000])
    writes = property(lambda self: [c for c in self.calls if c[0] not in ('GET', 'HEAD')])


def lane(db, *flags, ask=lambda prompt, model: {'ok': True, 'value': unit()}, env=ENV):
    lines = []
    code = run(['--vehicle-id', V, '--user-id', U, *flags], env, http=db, ask=ask, out=lines.append, sleep=PAUSES.append)
    printed = '\n'.join(lines)
    for private in (V, U, P1, P2, P3, S1, 'flaking', 'Glare', 'dented', 'service-key-stand-in', 'example.invalid'):
        assert private not in printed, f'the lane printed something private: {private}'
    return code, printed


# 1. a bad id is refused before anything is read; ANTHROPIC_API_KEY is refused
for bad in (V.upper(), V[:-1], V + '\n', V.replace('-', ''), '', "x' or '1'='1", '*'):
    for args in (['--vehicle-id', bad, '--user-id', U], ['--vehicle-id', V, '--user-id', bad]):
        db = Database([photo(P1)]); lines = []
        assert run(args, ENV, http=db, ask=None, out=lines.append) == 2 and not db.calls, 'a bad id is refused and nothing is read'
        assert not bad.strip() or bad not in ''.join(lines), 'the refused value is not echoed'
db = Database([photo(P1)])
assert run(['--vehicle-id', V, '--user-id', U], {**ENV, 'ANTHROPIC_API_KEY': 'x'}, http=db, ask=None, out=lambda s: None) == 2 and not db.calls, 'ANTHROPIC_API_KEY refuses the start'
assert run(['--vehicle-id', V, '--user-id', U], {'SUPABASE_URL': 'x'}, http=db, ask=None, out=lambda s: None) == 2 and not db.calls, 'a missing key refuses the start'
assert run(['--vehicle-id', V, '--user-id', U, '--photos', '0'], ENV, http=db, ask=None, out=lambda s: None) == 2 and not db.calls
assert run(['--vehicle-id', V, '--user-id', U, '--after', 'not-a-cursor'], ENV, http=db, ask=None, out=lambda s: None) == 2 and not db.calls

# 2. jsonb key order: shorter keys first, then bytewise, at every depth
ordered = jsonb({'bb': 1, 'a': {'zz': 1, 'b': 2, 'aa': [{'cc': 1, 'c': 2}], 'B': 3}, 'ab': 4, 'é': 5, 'zz': 6})
assert list(ordered) == ['a', 'ab', 'bb', 'zz', 'é'], 'length is counted in bytes'
assert list(ordered['a']) == ['B', 'b', 'aa', 'zz'] and list(ordered['a']['aa'][0]) == ['c', 'cc']

# 3. the clock, as land.sql formats it: UTC, milliseconds cut off
assert utc_ms('2024-03-09T16:05:07.98765-07:00') == '2024-03-09T23:05:07.987Z'
assert utc_ms('2024-01-01T05:30:00.5+05:30') == '2024-01-01T00:00:00.500Z'
assert utc_ms('2024-03-10T01:02:03+00:00') == '2024-03-10T01:02:03.000Z' and utc_ms('2024-06-01 12:00:00.123456Z') == '2024-06-01T12:00:00.123Z'
assert utc_ms('2024-06-01T12:00:00') == '2024-06-01T12:00:00.000Z' and utc_ms(None) is None and utc_ms('yesterday') is None

# 4. the body for one fixed claim, written out by hand from land.sql: jsonb_build_object gives every object its keys
#    in jsonb order, and each value below is the expression land.sql has for that key.
GOLDEN = ' '.join('''
{"kind": "condition",
"source_url": "https://img.example.invalid/1.jpg",
"vehicle_id": "1b1b1b1b-2222-4333-8444-555555555555",
"agent_model": "reader-model-a",
"observed_at": "2024-03-09T23:05:07.987Z",
"source_slug": "photo_pipeline",
"content_text": "Paint is flaking on the  driver door lower edge.",
"agent_inferred": true,
"defer_analysis": true,
"descriptor_key": "exterior.paint.delamination",
"raw_source_ref": "vehicle_observations:99999999-8888-4777-8666-555555555555",
"structured_data": {"reader": {"model": "reader-model-a", "prompt": "deep-v3", "observation_id": "99999999-8888-4777-8666-555555555555"},
"image_id": "aaaaaaaa-0000-4000-8000-000000000001",
"part_key": "door.front.driver",
"part_side": "driver",
"placed_by": {"run": "scripts/photo-pipeline/keys_lane.py 2026-11-11", "role": "skills/image-keys/SKILL.md", "check": "scripts/photo-pipeline/keys-dry-run/check_units.py", "model": "sonnet", "decisions": "scripts/photo-pipeline/keys-dry-run/decisions.pending.2026-11-10.json"},
"capture_at": "2024-03-09T23:05:07.987Z",
"claim_role": "inferred",
"limitation": "One reader's statement about one photo, placed on existing keys by an agent. The part is carried as text until a part has a place on an observation. Not confirmed by a second reader, a receipt or the owner.",
"is_inferred": true,
"source_text": "Paint is flaking on the  driver door lower edge.",
"answer_basis": "stored_reading",
"analysis_kind": "photo_map_harvest",
"descriptor_key": "exterior.paint.delamination",
"statement_path": "vehicle_images.ai_scan_metadata.byok_deep_analysis.state_observations.damage_callouts[0]",
"part_key_status": "registry",
"observed_at_basis": "photo_capture_time"},
"extraction_method": "photo_map_harvest_v1",
"source_identifier": "photo_map_harvest_v1:aaaaaaaa-0000-4000-8000-000000000001:0:exterior.paint.delamination:door.front.driver:driver"}
'''.strip().splitlines())
CLAIM = {'photo': P1, 'idx': 0, 'scene': 'exterior_detail', 'part': 'door.front.driver', 'side': 'driver', 'part_from': 'registry',
         'state': 'exterior.paint.delamination', 'state_from': 'registry condition key'}
READING = {'id': S1, 'agent_model': 'reader-model-a'}
assert json.dumps(body_for(V, photo(P1), CLAIM, READING, 'sonnet', '2026-11-11'), ensure_ascii=False) == GOLDEN, 'the body is land.sql\'s, field for field'
bare = body_for(V, photo(P1, taken_at=None, reader_model=None, image_url=None), {**CLAIM, 'idx': 1, 'part': None, 'side': None, 'part_from': 'unknown'}, {}, 'sonnet', '2026-11-11')
assert bare['observed_at'] == '2024-03-10T01:02:03.000Z' and bare['structured_data']['capture_at'] is None and bare['structured_data']['observed_at_basis'] == 'photo_upload_time'
assert bare['agent_model'] == 'stored deep reading; model not recorded' and bare['structured_data']['reader'] == {'model': None, 'prompt': 'deep-v3', 'observation_id': None}
assert bare['raw_source_ref'] == 'vehicle_images:' + P1 and bare['source_identifier'].endswith(':1:exterior.paint.delamination:-:-') and bare['source_url'] is None
assert bare['structured_data']['part_key'] is None and bare['structured_data']['part_side'] is None and bare['structured_data']['part_key_status'] == 'unknown'
assert list(bare) == list(json.loads(GOLDEN)) and list(bare['structured_data']) == list(json.loads(GOLDEN)['structured_data']), 'a null keeps its key and its place'

# 5. the claude envelope
answer = read_envelope(0, json.dumps({'type': 'result', 'is_error': False, 'result': 'Here it is:\n```json\n{"photo": "aaaaaaaa", "results": []}\n```'}), '')
assert answer == {'ok': True, 'value': {'photo': 'aaaaaaaa', 'results': []}}
LIMIT = (1, json.dumps({'type': 'result', 'is_error': True, 'api_error_status': 429, 'result': "You've hit your 5-hour limit · resets 3pm"}), '')
assert read_envelope(*LIMIT)['error_class'] == 'reader_usage_limit', 'a usage limit exits non-zero with its JSON on stdout'
assert read_envelope(1, json.dumps({'is_error': True, 'result': 'Claude usage limit reached'}), '')['error_class'] == 'reader_usage_limit'
NO_AUTH = (1, json.dumps({'type': 'result', 'is_error': True, 'api_error_status': 401, 'result': 'Invalid bearer token'}), '')
assert read_envelope(*NO_AUTH)['error_class'] == 'reader_unauthorized'
assert read_envelope(1, '', 'OAuth token has expired. Please sign in again.')['error_class'] == 'reader_unauthorized', 'an auth failure with no envelope'
assert read_envelope(1, json.dumps({'is_error': True, 'api_error_status': 503, 'result': ''}), '')['error_class'] == 'reader_api_unreachable'
assert read_envelope(0, json.dumps({'is_error': False, 'result': 'I could not decide.'}), '')['error_class'] == 'reader_output_invalid'
assert read_envelope(2, 'Segmentation fault', '')['error_class'] == 'reader_exited'

# 6. the CLI is started from an empty directory, the prompt on stdin, with neither the service key nor ANTHROPIC_API_KEY
seen = {}
def cli(argv, **kw):
    seen.update(kw, argv=argv, empty=os.listdir(kw['cwd']) == [])
    return subprocess.CompletedProcess(argv, 0, json.dumps({'is_error': False, 'result': '{"results": []}'}), '')
saved = dict(os.environ)
os.environ.update(SUPABASE_SERVICE_ROLE_KEY='k', ANTHROPIC_API_KEY='k', CLAUDE_CODE_OAUTH_TOKEN='t', CLAUDECODE='1')
try: assert keys_lane.ask_claude('the prompt', 'sonnet', runner=cli) == {'ok': True, 'value': {'results': []}}
finally: os.environ.clear(); os.environ.update(saved)
assert seen['argv'] == ['claude', '-p', '--output-format', 'json', '--model', 'sonnet'] and seen['input'] == 'the prompt' and seen['empty']
assert set(seen['env']) <= set(keys_lane.KEEP) and seen['env']['CLAUDE_CODE_OAUTH_TOKEN'] == 't'
assert not {'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'CLAUDECODE'} & set(seen['env'])

# 7. the prompt is the brief and the unit's own conventions, lifted, with nothing private but the statements
fr = keys_lane.frame()
assert fr['brief'].startswith('---\nname: image-keys') and 'CONVENTIONS, fixed for every run' in fr['task'] and fr['task'].endswith('or "nothing".')
assert '${' not in fr['task'] and fr['binding'].startswith('a part map') and fr['binding'].endswith('say so in unsure.')
assert fr['shape'].startswith('const N = ') and "required: ['photo', 'results', 'proposals', 'unsure']" in fr['shape'] and fr['assemblies'].startswith('### Assemblies')
prompts = []
def keyed(prompt, model): prompts.append(prompt); return {'ok': True, 'value': unit()}

# 8. a dry run performs no POST and says what it would send
db = Database([photo(P1)], reading=[READING])
code, printed = lane(db, ask=keyed)
assert code == 0 and not db.writes, 'a dry run writes nothing anywhere'
assert 'dry run' in printed and 'keyed: 1' in printed and 'landable: 1' in printed and 'writer: not called (dry run)' in printed
assert 'before 0, after 0, landed 0' in printed and 'cursor for --after: aaaaaaaa' in printed and '1 claims would be sent' in printed
assert "left out: {}" in printed and 'registry read live: 4 part keys, 4 condition keys (live and in the curated list; 1 live keys outside it withheld)' in printed
assert 'not checked by code: that a statement supports the key it was given' in printed and 're-sends' not in printed and 'partly landed' not in printed
assert FRAGMENT not in prompts[0] and '1 further live keys are not listed' in prompts[0], 'a live key outside the curated list is not offered'
assert len(prompts) == 1 and '"id": "c0"' in prompts[0] and '"id": "c1"' in prompts[0] and 'Paint is flaking on the driver door lower edge.' in prompts[0]
assert 'door.front.driver [driver]' in prompts[0] and 'exterior.paint.respray (state)' in prompts[0] and 'image_visible_rust_severity: none, surface' in prompts[0]
assert fr['task'] in prompts[0] and fr['brief'] in prompts[0] and '"part_decisions"' in prompts[0]
for private in (V, U, P1, 'service-key-stand-in', 'example.invalid'): assert private not in prompts[0]

# 9. with --write the claim goes to the writer once, with the golden body, and the rows are counted
with tempfile.TemporaryDirectory() as tmp:
    summary = os.path.join(tmp, 'summary.md')
    db = Database([photo(P1)], reading=[READING])
    code, printed = lane(db, '--write', env={**ENV, 'GITHUB_STEP_SUMMARY': summary})
    (method, url, sent), = db.writes
    run_day = re.search(r'keys_lane\.py (\d{4}-\d\d-\d\d)', sent.decode())[1]
    assert method == 'POST' and url == 'https://db.example.invalid/functions/v1/ingest-observation' and sent.decode() == GOLDEN.replace('2026-11-11', run_day)
    assert code == 0 and 'writer: new 1, duplicate 0, no answer 0, refused 0' in printed and 'before 0, after 1, landed 1' in printed and '1 rows landed' in printed
    assert 'result: work done' in open(summary).read() and P1 not in open(summary).read()
src_read, = [c[1] for c in db.calls if 'reviewed_image_analysis_v1' in c[1]]
assert f'vehicle_id=eq.{V}' in src_read and 'is_superseded=not.is.true' in src_read and f'structured_data->>image_id=eq.{P1}' in src_read and 'order=ingested_at.desc&limit=1' in src_read

# 10. the writer's answers are counted apart: a duplicate is not a row, a refusal shows its status and error field only
db = Database([photo(P1)], writer=lambda body: (200, {'success': True, 'duplicate': True, 'observation_id': S1, 'message': 'Observation already exists'}))
code, printed = lane(db, '--write')
assert code == 0 and 'new 0, duplicate 1' in printed and 'landed 0' in printed
db = Database([photo(P1)], writer=lambda body: (400, {'error': 'Unknown or deprecated descriptor_key: exterior.paint.delamination', 'hint': 'never printed'}))
code, printed = lane(db, '--write')
assert code == 1 and "refused 1 {'400 Unknown or deprecated descriptor_key: exterior.paint.delamination': 1}" in printed and 'never printed' not in printed
assert len(db.writes) == 1 and 'again): 0' in printed, 'a 4xx is the writer\'s answer: not sent again, and a photo with nothing landed is not partly landed'
db = Database([photo(P1)], writer=lambda body: (401, {'error': 'unauthorized', 'message': 'no'}))
assert lane(db, '--write')[0] == 4, 'the writer refusing the key is an authentication failure'
db = Database([photo(P1)], writer=answers(Lost(), Lost(), Lost()))
code, printed = lane(db, '--write')
assert code == 1 and 'no answer 1' in printed and len(db.writes) == keys_lane.ATTEMPTS == 3, 'a lost answer is unknown, not zero; the same bytes are sent a bounded number of times'
assert len({sent for _, _, sent in db.writes}) == 1 and 'landed 0' in printed
code, printed = lane(Database([photo(P1)], lands=False), '--write')   # the writer says new, the count does not move
assert code == 1 and 'new 1' in printed and 'landed 0' in printed, 'success is rows landed, not what the writer said'

# 11. a unit that fails the check lands nothing; the kinds of problem are printed, not their text
db = Database([photo(P1)])
code, printed = lane(db, '--write', ask=lambda prompt, model: {'ok': True, 'value': unit(said='Perforation through the quarter panel')})
assert code == 5 and not db.writes and 'rejected by the check: 1' in printed and "{'quoted words not in the reading': 1}" in printed and 'Perforation' not in printed
code, printed = lane(Database([photo(P1)]), '--write', ask=lambda prompt, model: {'ok': True, 'value': {'results': [{'sid': 'c0', 'claims': ['x']}, {'sid': 'c1', 'claims': []}]}})
assert code == 5 and 'rejected by the check: 1' in printed, 'a malformed result is rejected, not a crash'
assert keys_lane.kind_of("c0: part key 'made.up' is marked existing but is not in the registry") == 'part key not in the registry'
assert keys_lane.kind_of("c0: condition key 'made.up' is not in the registry") == 'condition key not in the registry' and keys_lane.kind_of('something new') == 'other'

# 12. a usage limit stops at once (exit 3); an auth failure is exit 4; a reader that fails on every photo is exit 5
asked = []
def limited(prompt, model): asked.append(1); return read_envelope(*LIMIT)
db = Database([photo(P1), photo(P2)])
code, printed = lane(db, '--photos', '2', '--write', ask=limited)
assert code == 3 and len(asked) == 1 and not db.writes and 'usage limit reached' in printed and "'reader_usage_limit': 1" in printed
assert lane(Database([photo(P1)]), ask=lambda prompt, model: read_envelope(*NO_AUTH))[0] == 4
code, printed = lane(Database([photo(P1), photo(P2)]), '--photos', '2', ask=lambda prompt, model: {'ok': False, 'error_class': 'reader_timeout'})
assert code == 5 and 'reader failed: 2' in printed and 'cursor for --after: bbbbbbbb' in printed

# 13. which photos are taken: id ascending, not one this lane has keyed, not a receipt frame, after the cursor
library = [photo(P3), photo(P1), photo(P2, scene='receipt_document'), photo('dddddddd-0000-4000-8000-000000000004', callouts=[]), photo('eeeeeeee-0000-4000-8000-000000000005', callouts=None)]
library.sort(key=lambda p: p['id'])
db = Database(library, keyed=[f'photo_map_harvest_v1:{P1}:0:exterior.paint.delamination:door.front.driver:driver'])
code, printed = lane(db, '--photos', '5')
assert code == 0 and 'seen: 3 (with at least one row from this lane, not taken again: 1; receipt_document, not asked: 1)' in printed and 'photos taken: 1' in printed and 'cursor for --after: cccccccc' in printed
code, printed = lane(Database(library), '--after', 'aaaaaaaa')
assert code == 0 and 'photos taken: 1' in printed and 'cursor for --after: cccccccc' in printed, 'the cursor is honoured'
code, printed = lane(Database(library), '--after', 'cccccccc')
assert code == 0 and 'result: nothing left to do' in printed and 'photos taken: 0' in printed
db = Database([])
code, printed = lane(db)
assert code == 2 and len(db.calls) == 1 and 'no photo on this vehicle' in printed, 'a vehicle the user has no photo on is refused'

# 14. the landable rules are pack_claims.py's, on the same rows (fold.py's rows; sid s000N is the photo's Nth statement)
row = lambda sid, pid, part, side, part_from, state, state_from='registry condition key', scene='exterior_detail': {
    'sid': sid, 'photo': pid, 'scene': scene, 'part': part, 'side': side, 'part_from': part_from, 'state': state, 'state_from': state_from}
ROWS = [
    row('s0001', P1, 'door.front.driver', 'driver', 'registry', 'exterior.paint.delamination'),
    row('s0001', P1, 'door.front.driver', 'driver', 'registry', 'exterior.paint.delamination'),                      # the same claim twice
    row('s0002', P1, 'door.front.driver', 'driver', 'registry', 'image_visible_rust_severity=surface', 'registry property'),
    row('s0002', P1, 'exterior.hood', None, 'decided this run', 'exterior.paint.crazing', 'drafted'),
    row('s0003', P2, 'door.front.driver', 'driver', 'registry', 'exterior.paint.delamination', scene='receipt_document'),
    row('s0003', P2, None, None, 'unknown', 'exterior.paint.crazing', 'drafted', scene='receipt_document'),
    row('s0004', P3, 'interior.seat.front.driver', 'driver', 'registry', 'exterior.body.deformation'),                 # a body-panel key on an interior part
    row('s0004', P3, 'door.front', None, 'registry (side not said)', 'exterior.body.deformation'),
    row('s0005', P3, None, None, 'unknown', 'exterior.paint.delamination'),
    row('s0006', P3, 'interior.dashboard', 'center', 'registry', 'interior.dashboard.cracking'),
]
INDEX = {'s0001': 0, 's0002': 1, 's0003': 0, 's0004': 0, 's0005': 1, 's0006': 2}
keep, left_out = landable([{**x, 'idx': INDEX[x['sid']]} for x in ROWS])
ours = sorted((x['photo'][:8], x['idx'], x['state'], x['part'], x['side'], x['part_from']) for x in keep)
assert ours == [('aaaaaaaa', 0, 'exterior.paint.delamination', 'door.front.driver', 'driver', 'registry'),
                ('cccccccc', 0, 'exterior.body.deformation', 'door.front', None, 'registry (side not said)'),
                ('cccccccc', 1, 'exterior.paint.delamination', None, None, 'unknown'),
                ('cccccccc', 2, 'interior.dashboard.cracking', 'interior.dashboard', 'center', 'registry')]
assert dict(left_out) == {'same claim twice': 1, 'state has no registry key': 3, 'print inside a receipt frame': 1, 'body-panel key on an interior part': 1}
PACK = os.path.join(HERE, 'keys-dry-run', 'pack_claims.py')
if os.path.exists(PACK):   # run the file itself on these rows and compare what it packs and what it leaves out
    with tempfile.TemporaryDirectory() as data:
        json.dump([{'id': sid, 'photo_full': next(x['photo'] for x in ROWS if x['sid'] == sid)} for sid in INDEX], open(os.path.join(data, 'statements_all.json'), 'w'))
        json.dump({'rows': ROWS}, open(os.path.join(data, 'fold.json'), 'w'))
        said = subprocess.run([sys.executable, PACK, os.path.join(data, 'fold.json'), '--parts', '1'], env={**os.environ, 'KEYS_DRY_RUN_DATA': data}, capture_output=True, text=True, check=True).stdout
        packed = json.load(open(os.path.join(data, 'land-part1.json')))
    theirs = sorted((p8, i, packed['d'][d], packed['p'][p] if p >= 0 else None, [None, 'driver', 'passenger', 'center'][s],
                     ['registry', 'registry (side not said)', 'decided this run', 'decided this run (which one not said)', 'drafted', 'unknown'][st - 1])
                    for p8, claims in packed['c'].items() for i, d, p, s, st in claims)
    assert theirs == ours and ast.literal_eval(said.split('left out: ', 1)[1].splitlines()[0]) == dict(left_out), 'pack_claims.py and the lane disagree'
    pack = 'pack_claims.py itself was run on the same rows and agrees'
else:
    pack = 'pack_claims.py is NOT in this checkout: its rules were compared as written out in this test, not by running it'

# 15. a condition key is offered and landed only when it is live AND in the curated list (registry.snapshot.json)
assert FRAGMENT not in keys_lane.CURATED and len(keys_lane.CURATED) == 53 and 'exterior.metal.perforation' in keys_lane.CURATED
for key, why in ((FRAGMENT, 'live, not curated'), ('exterior.metal.perforation', 'curated, not live')):
    db = Database([photo(P1)])
    code, printed = lane(db, '--write', ask=says(answer_of(claim(on_key(key)))))
    assert code == 5 and not db.writes and "{'condition key not in the registry': 1}" in printed, f'a key that is {why} is not a registry key for this lane'
db = Database([photo(P1)])   # drafted as a new key with a proposal: the check passes it, and it is left out, not landed
code, printed = lane(db, '--write', ask=says(answer_of(claim(on_key(FRAGMENT, 'no_place')), proposals=[{'kind': 'condition_key', 'key': FRAGMENT}])))
assert code == 0 and not db.writes and "left out: {'state has no registry key': 1}" in printed and '0 rows landed' in printed

# 16. a landable claim must quote two words or more, or the whole statement; the check alone passes '' and any one word
for thin in ('', '  ', 'Paint', 'door.'):
    db = Database([photo(P1)])
    code, printed = lane(db, '--write', ask=says(answer_of(claim(said=thin))))
    assert code == 5 and not db.writes and 'rejected by the check: 1' in printed and "{'landable claim quoting under two words': 1}" in printed, repr(thin)
db = Database([photo(P1)])
assert lane(db, '--write', ask=says(answer_of(claim(said='Paint is'))))[0] == 0 and len(db.writes) == 1
db = Database([photo(P1, callouts=['Delamination.', 'Glare hides the roof.'])])
assert lane(db, '--write', ask=says(answer_of(claim(said='delamination'))))[0] == 0 and len(db.writes) == 1, 'a one-word statement quoted whole is all there is to quote'
RUST = {'decision': 'property', 'property_key': 'image_visible_rust_severity', 'value_or_key': 'surface'}
db = Database([photo(P1)])
assert lane(db, '--write', ask=says(answer_of(claim(), claim(RUST, said='Paint'))))[0] == 0 and len(db.writes) == 1, 'a claim that lands nothing is not held to it'
# A statement that denies the flaw lands nothing, whether the quote keeps the "No" or drops it. What is still NOT
# checked by code, and the summary says so on every run: that an affirmed statement supports the key it was given.
for quoted in ('flaking paint is visible on the driver door', 'No flaking paint is visible'):
    db = Database([photo(P1, callouts=['No flaking paint is visible on the driver door.', 'Glare hides the roof.'])])
    code, printed = lane(db, '--write', ask=says(answer_of(claim(said=quoted))))
    assert code == 5 and not db.writes and "{'landable claim under a negation': 1}" in printed, quoted
    assert 'not checked by code: that a statement supports the key it was given' in printed
assert keys_lane.negated('rust is visible at the lower edge', 'The door is not original, and rust is visible at the lower edge.') is False, 'a negation in an earlier clause does not deny this one'
assert keys_lane.negated('active fluid drip is resolved', 'No obvious starter housing breakage or active fluid drip is resolved in this view.') is True
assert keys_lane.negated('creases and light surface marks', 'Exposed upholstery has creases and light surface marks without a clear visible tear.') is False
db = Database([photo(P1, callouts=['The door is not original, and paint is flaking at the lower edge.', 'Glare hides the roof.'])])
assert lane(db, '--write', ask=says(answer_of(claim(said='paint is flaking at the lower edge'))))[0] == 0 and len(db.writes) == 1

# 17. the claims on one statement are bounded, so one answer cannot put a statement on every key
PASSENGER = {'decision': 'existing', 'key': 'door.front.passenger', 'side': 'passenger'}
every = [claim(on_key(r['canonical_key']), said='the driver', part=part) for r in CONDITION_ROWS[:4] for part in (DOOR, PASSENGER)]
for too_many in (every, [claim()] * (keys_lane.MAX_CLAIMS + 1)):
    db = Database([photo(P1)])
    code, printed = lane(db, '--write', ask=says(answer_of(*too_many)))
    assert code == 5 and not db.writes and "{'too many claims on one statement': 1}" in printed
db = Database([photo(P1)])
code, printed = lane(db, '--write', ask=says(answer_of(*every[:keys_lane.MAX_CLAIMS])))
assert keys_lane.MAX_CLAIMS == 6 and code == 0 and len(db.writes) == 6 and 'landed 6' in printed, 'the bound itself is allowed'

# 18. a claim the writer did not take is sent again with the same bytes; what is still not taken is counted, and a
#     later run does not call the photo done
for unknown in ((503, {'error': 'Property registry unavailable'}), (429, {'error': 'rate limited'}), Lost()):
    del PAUSES[:]
    db = Database([photo(P1)], writer=answers(unknown))
    code, printed = lane(db, '--write')
    assert code == 0 and len(db.writes) == 2 and db.writes[0][2] == db.writes[1][2] and PAUSES == [3], 'one re-send, byte for byte, after a pause'
    assert 'writer: new 1, duplicate 0, no answer 0, refused 0' in printed and 'before 0, after 1, landed 1' in printed
    assert 're-sends of the same bytes after no answer, a 5xx or a 429: 1; claims the writer then called duplicate: 0' in printed
db = Database([photo(P1)], writer=answers(Lost(committed=True)))   # the row landed and the answer was lost
code, printed = lane(db, '--write')
assert code == 0 and len(db.writes) == 2 and 'writer: new 0, duplicate 0' in printed and 'claims the writer then called duplicate: 1' in printed
assert 'before 0, after 1, landed 1' in printed and '1 rows landed' in printed, 'a re-send cannot land a second row, and the row it found is counted as landed'
TWO = ['Paint is flaking on the driver door.', 'The driver door is dented near the handle.']
two = {**unit(), 'results': [{'sid': 'c0', 'claims': [claim()], 'not_a_claim': None, 'question': None},
                             {'sid': 'c1', 'claims': [claim(DENT, said='driver door is dented')], 'not_a_claim': None, 'question': None}]}
FAIL = (500, {'error': 'Failed to insert observation', 'details': 'never printed'})
db = Database([photo(P1, callouts=TWO)], writer=answers((200, NEW), FAIL, FAIL, FAIL))
code, printed = lane(db, '--write', ask=says(two))
assert code == 1 and len(db.writes) == 4 and "writer: new 1, duplicate 0, no answer 0, refused 1 {'500 Failed to insert observation': 1}" in printed and 'never printed' not in printed
assert 'photos left partly landed (some claims taken, some not; a later run does not take the photo again): 1' in printed
assert 'result: the writer did not take everything that was sent; photos left partly landed: 1 (exit 1)' in printed and 'landed 1' in printed
asked = []
code, printed = lane(db, '--write', ask=lambda prompt, model: asked.append(1))   # the next run: the photo has one row
assert code == 0 and not asked and len(db.writes) == 4 and 'photos taken: 0' in printed
assert 'nothing left to do' not in printed and 'result: no photo left to take: 1 passed over because each has at least one row from this lane' in printed
db = Database([photo(P1, callouts=TWO)], writer=answers((200, NEW), (401, {'error': 'unauthorized'})))
code, printed = lane(db, '--write', ask=says(two))
assert code == 4 and len(db.writes) == 2 and 'again): 1' in printed, 'a stop between two claims of one photo leaves it partly landed, and the count says so'
print(f'keys_lane: 18 groups of cases pass ({pack})')

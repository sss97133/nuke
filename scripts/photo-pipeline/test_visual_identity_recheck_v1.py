"""Contract tests for visual_identity_recheck_v1 pure gates (no network, no model)."""
import unittest

import visual_identity_recheck_v1 as V

A, B = 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'
VEH, OTHER = '11111111-0000-4000-8000-000000000000', '22222222-0000-4000-8000-000000000000'


def first(i, verdict='wrong_vehicle', state='on_vehicle', v=VEH):
    return {'image_id': i, 'vehicle_id': v, 'state': state, 'verdict': verdict, 'clue': 'red pickup, record is a black coupe',
            'sheet': 's1', 'ref_ids': [], 'ref_basis': 'capture_set_link'}


class ParseTest(unittest.TestCase):
    def test_sheet_parse_takes_last_json_and_dedupes_tiles(self):
        out = V.parse_sheet('thinking {"x":1}\n{"sheet":"s","flags":[{"tile":3,"verdict":"unrelated","clue":"phone screenshot"},'
                            '{"tile":3,"verdict":"wrong_vehicle","clue":"dup"}]}', 20)
        self.assertEqual(out, [{'tile': 3, 'verdict': 'unrelated', 'clue': 'phone screenshot'}])

    def test_sheet_parse_rejects_out_of_range_and_empty_clue(self):
        with self.assertRaises(ValueError):
            V.parse_sheet('{"flags":[{"tile":21,"verdict":"unrelated","clue":"x"}]}', 20)
        with self.assertRaises(ValueError):
            V.parse_sheet('{"flags":[{"tile":2,"verdict":"unrelated","clue":"  "}]}', 20)
        with self.assertRaises(ValueError):
            V.parse_sheet('{"flags":[{"tile":2,"verdict":"maybe","clue":"x"}]}', 20)

    def test_single_parse_checks_id(self):
        self.assertEqual(V.parse_single(f'{{"id":"{A}","verdict":"not_this_vehicle","clue":"C2 Corvette"}}', A)['verdict'], 'not_this_vehicle')
        with self.assertRaises(ValueError):
            V.parse_single(f'{{"id":"{B}","verdict":"not_this_vehicle","clue":"x"}}', A)


class GateTest(unittest.TestCase):
    def test_both_looks_required(self):
        f = [first(A), first(B)]
        s = {A: {'verdict': 'not_this_vehicle', 'clue': 'x'}, B: {'verdict': 'belongs_or_unsure', 'clue': 'y'}}
        self.assertEqual([c['image_id'] for c in V.hold_candidates(f, s, set())], [A])

    def test_personal_never_held_and_only_on_vehicle(self):
        f = [first(A, 'personal'), first(B, state='unverified')]
        s = {A: {'verdict': 'not_this_vehicle', 'clue': 'x'}, B: {'verdict': 'not_this_vehicle', 'clue': 'x'}}
        self.assertEqual(V.hold_candidates(f, s, set()), [])

    def test_privacy_exclude_wins(self):
        s = {A: {'verdict': 'not_this_vehicle', 'clue': 'x'}}
        self.assertEqual(V.hold_candidates([first(A)], s, {A}), [])

    def test_live_recheck_and_cap(self):
        ids = [f'{n:08x}-0000-4000-8000-000000000000' for n in range(80)]
        cands = [{**first(i), 'second': {'verdict': 'not_this_vehicle', 'clue': 'x'}} for i in ids]
        cur = {i: {'vehicle_id': VEH, 'vision_gate_status': 'approved', 'is_sensitive': False} for i in ids}
        cur[ids[0]]['vision_gate_status'] = 'review_needed'
        cur[ids[1]]['vehicle_id'] = OTHER
        cur[ids[2]]['is_sensitive'] = True
        batch = V.plan_hold_batch(cands, VEH, cur, cap=500)
        self.assertEqual(len(batch), 50)
        self.assertNotIn(ids[0], [b['image_id'] for b in batch])

    def test_granted_by_required_and_signed(self):
        c = {**first(A), 'second': {'verdict': 'not_this_vehicle', 'clue': 'x'}}
        with self.assertRaises(ValueError):
            V.hold_items([c], ' ')
        sig = V.hold_items([c], 'skylar')[0]['signals']
        self.assertEqual((sig['producer'], sig['granted_by'], sig['visual_gate']), (V.VERSION, 'skylar', 'wrong_vehicle'))
        self.assertEqual(sig['prompt_ids'], [V.SHEET_PROMPT_ID, V.SINGLE_PROMPT_ID])

    def test_run_name_and_wilson(self):
        self.assertEqual(V.run_name(VEH, '20261112', 'a'), 'visual_identity_recheck_v1-11111111-20261112a')
        self.assertGreater(V.wilson_low(112, 112), 0.96)
        self.assertLess(V.wilson_low(1, 2), 0.5)

    def test_eligible_row_excludes_private_empty_and_redacted(self):
        ok = {'id': A, 'image_url': 'https://x.supabase.co/storage/v1/object/public/a.jpg', 'is_sensitive': False, 'redaction_level': None}
        self.assertTrue(V.eligible_row(ok, set()))
        self.assertFalse(V.eligible_row({**ok, 'image_url': ''}, set()))
        self.assertFalse(V.eligible_row({**ok, 'is_sensitive': True}, set()))
        self.assertFalse(V.eligible_row({**ok, 'redaction_level': 'blur'}, set()))
        self.assertFalse(V.eligible_row(ok, {A}))


if __name__ == '__main__':
    unittest.main()

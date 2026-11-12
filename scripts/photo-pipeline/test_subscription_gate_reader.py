"""Self-agreement gate and answer parsing of subscription_gate_reader.py.  python3 -m unittest scripts/photo-pipeline/test_subscription_gate_reader.py"""
import importlib.util, os, unittest
spec = importlib.util.spec_from_file_location('gr', os.path.join(os.path.dirname(__file__), 'subscription_gate_reader.py'))
gr = importlib.util.module_from_spec(spec); spec.loader.exec_module(gr)  # module import has no side effects; main() is not run

def pairs(c=0, w=0, u=0, fa=0, wu=0, cw=0):
    """c correct agreed, w wrong agreed, u unclear agreed, fa hand-wrong read correct, wu hand-wrong read unclear, cw hand-correct read wrong"""
    return [('correct','correct')]*c + [('wrong','wrong')]*w + [('unclear','unclear')]*u + [('wrong','correct')]*fa + [('wrong','unclear')]*wu + [('correct','wrong')]*cw

class Calibration(unittest.TestCase):
    def test_perfect_agreement_passes(self):
        r = gr.calibration_verdict(pairs(c=85, w=56, u=29)); self.assertTrue(r['passed']); self.assertEqual(r['agreement'], 1.0)
    def test_one_false_accept_in_fifty_six_wrong_passes_at_the_limit(self):
        r = gr.calibration_verdict(pairs(c=85, w=55, u=29, fa=1)); self.assertAlmostEqual(r['false_accept_rate'], 1/56); self.assertTrue(r['passed'])
    def test_two_false_accepts_in_fifty_six_fail(self):
        r = gr.calibration_verdict(pairs(c=85, w=54, u=29, fa=2)); self.assertFalse(r['passed'])
    def test_false_accept_fails_even_with_high_agreement(self):
        r = gr.calibration_verdict(pairs(c=200, w=5, fa=1)); self.assertGreater(r['agreement'], 0.99); self.assertFalse(r['passed'])
    def test_cautious_reader_unclear_on_wrongs_is_not_a_false_accept(self):
        r = gr.calibration_verdict(pairs(c=90, w=50, u=29, wu=6)); self.assertEqual(r['false_accepts'], 0); self.assertTrue(r['passed'])
    def test_low_agreement_fails(self):
        r = gr.calibration_verdict(pairs(c=50, w=56, cw=35)); self.assertLess(r['agreement'], 0.85); self.assertFalse(r['passed'])
    def test_no_hand_wrong_cannot_pass(self):
        self.assertFalse(gr.calibration_verdict(pairs(c=50))['passed'])
    def test_empty_fails(self):
        self.assertFalse(gr.calibration_verdict([])['passed'])
    def test_malformed_reader_status_counts_as_unclear_not_correct(self):
        r = gr.calibration_verdict([('wrong', 'CORRECT'), ('wrong', None)] + pairs(c=10, w=10))
        self.assertEqual(r['false_accepts'], 0)

class Tuning(unittest.TestCase):
    def test_binary_agreement_wrong_vs_unclear_agrees(self):
        r = gr.calibration_verdict([('wrong', 'unclear')] * 10 + [('unclear', 'wrong')] * 10 + pairs(c=10, w=1))
        self.assertEqual(r['agreement'], 1.0); self.assertEqual(r['false_accepts'], 0)
    def test_binary_accept_disagreement_counts(self):
        r = gr.calibration_verdict([('unclear', 'correct')] * 2 + [('correct', 'unclear')] * 2 + pairs(c=6, w=1))
        self.assertAlmostEqual(r['agreement'], 7 / 11)
    def test_correct_without_a_mark_is_unclear(self):
        v = gr.parse_verdicts('{"verdicts":[{"s":0,"status":"correct","why":"same truck"},{"s":1,"status":"correct","mark":" "},{"s":2,"status":"correct","mark":"primer patch on left fender"}]}', 3)
        self.assertEqual([x['status'] for x in v], ['unclear', 'unclear', 'correct'])
    def test_vehicle_name_leaves_out_colour(self):
        self.assertEqual(gr.vehicle_name({'year': 1983, 'make': 'GMC', 'model': 'K2500', 'color': 'Midnight Blue'}), '1983 GMC K2500')
    def test_prompt_rules(self):
        p = gr.PROMPT.lower()
        for must in ('distinguishing mark', 'same generation', 'not enough', 'too dark', 'only a hint', '"mark"', 'lookalike', 'same-generation-and-colour', 'red crew cab'):
            self.assertIn(must, p)
        self.assertNotIn('{color}', p)

class Parse(unittest.TestCase):
    def test_parses_and_fills_missing_as_unclear(self):
        v = gr.parse_verdicts('ok {"verdicts":[{"s":0,"status":"correct","mark":"white roof over blue","why":"same car"},{"s":2,"status":"wrong"}]}', 3)
        self.assertEqual([x['status'] for x in v], ['correct', 'unclear', 'wrong'])
    def test_bad_status_and_out_of_range_index_never_become_correct(self):
        v = gr.parse_verdicts('{"verdicts":[{"s":0,"status":"yes"},{"s":9,"status":"correct"},{"s":"x","status":"correct"}]}', 2)
        self.assertEqual([x['status'] for x in v], ['unclear', 'unclear'])
    def test_no_json_is_all_unclear(self):
        self.assertEqual({x['status'] for x in gr.parse_verdicts('I cannot see the image', 4)}, {'unclear'})

class VehicleSpecificMark(unittest.TestCase):
    def test_fa_generation_marks_are_not_specific(self):
        veh = {'year': 1989, 'make': 'Chevrolet', 'model': 'Pickup R3500 Cheyenne'}
        for mark in (
            'Faded red crew-cab square-body Chevrolet with a dark lower body, as in REF5',
            "Red crew-cab long-bed square-body with a dark lower body, matching REF5's profile",
            'Faded red paint with a dark lower body and a Chevrolet square-body front',
            'Red crew-cab square-body with a dark lower body, as in REF5',
        ):
            self.assertFalse(gr.mark_is_vehicle_specific(mark, veh), mark)

    def test_concrete_marks_are_specific(self):
        veh = {'year': 1989, 'make': 'Chevrolet', 'model': 'Pickup R3500 Cheyenne'}
        for mark in (
            'primer patch on the left rear fender',
            'dent above the right tail light',
            'California plate 1ABC123',
            'aftermarket tube bumper with a welded hook',
        ):
            self.assertTrue(gr.mark_is_vehicle_specific(mark, veh), mark)

    def test_correct_with_a_generic_mark_is_unclear(self):
        v = gr.parse_verdicts('{"verdicts":[{"s":0,"status":"correct","mark":"Faded red crew-cab square-body Chevrolet with a dark lower body, as in REF5","why":"same truck"},{"s":1,"status":"correct","mark":"primer patch on left fender","why":"same patch"}]}', 2, vehicle={'make':'Chevrolet','model':'Pickup R3500 Cheyenne','year':1989})
        self.assertEqual([x['status'] for x in v], ['unclear', 'correct'])

    def test_competing_owned_same_generation_and_color(self):
        target = {'id':'t','year':1989,'make':'Chevrolet','model':'R3500','color':'Red'}
        owned = [
            target,
            {'id':'a','year':1987,'make':'GMC','model':'K2500','color':'Red'},      # same family, close year, same color
            {'id':'b','year':1988,'make':'Chevrolet','model':'C1500','color':'Blue'}, # different color
            {'id':'c','year':2005,'make':'Chevrolet','model':'Silverado','color':'Red'}, # too far in year
            {'id':'d','year':1990,'make':'Ford','model':'F-150','color':'Red'},     # different make
        ]
        ids = {v['id'] for v in gr.competing_owned(owned, target)}
        self.assertEqual(ids, {'a'})

if __name__ == '__main__':
    unittest.main()

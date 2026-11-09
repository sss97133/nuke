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

class Parse(unittest.TestCase):
    def test_parses_and_fills_missing_as_unclear(self):
        v = gr.parse_verdicts('ok {"verdicts":[{"s":0,"status":"correct","why":"same car"},{"s":2,"status":"wrong"}]}', 3)
        self.assertEqual([x['status'] for x in v], ['correct', 'unclear', 'wrong'])
    def test_bad_status_and_out_of_range_index_never_become_correct(self):
        v = gr.parse_verdicts('{"verdicts":[{"s":0,"status":"yes"},{"s":9,"status":"correct"},{"s":"x","status":"correct"}]}', 2)
        self.assertEqual([x['status'] for x in v], ['unclear', 'unclear'])
    def test_no_json_is_all_unclear(self):
        self.assertEqual({x['status'] for x in gr.parse_verdicts('I cannot see the image', 4)}, {'unclear'})

if __name__ == '__main__':
    unittest.main()

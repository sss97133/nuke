"""Regression cases from sparse, ineligible and uncertain photo gates."""
import copy
import unittest

from check_dimensions import photo_evidence


class PhotoEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.names = ['crown', 'front_tab', 'rear_leg', 'rim', 'lower_flange', 'rib']
        self.cameras = {'cameras': [dict(id=cid, gate=True, rvec=[0, 0, 0], tvec=[0, 0, 2],
                                        validation_role=role)
                                     for cid, role in [('construction', 'fit'), ('oblique', 'holdout')]]}
        self.sources = [dict(name=name, sigma_mm=3) for name in self.names]
        self.rows = [dict(image_id=cid, name=name, d_mm=2, depth_m=2)
                     for cid in ['construction', 'oblique'] for name in self.names]
        self.requirements = {'required_landmarks': self.names}

    def check(self):
        return photo_evidence(self.rows, self.cameras, self.sources, self.requirements)

    def test_complete_coverage_is_only_a_coverage_pass(self):
        report = self.check()
        self.assertEqual(report['status'], 'COVERAGE_CHECK_PASSED')
        self.assertIn('no independent camera calibration', report['scope'])

    def test_one_good_point_per_photo_cannot_pass(self):
        self.rows = [r for r in self.rows if r['name'] == 'crown']
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_explicitly_ineligible_vendor_is_not_validation(self):
        self.cameras['cameras'][1]['gate'] = False
        report = self.check()
        self.assertEqual(report['status'], 'BLOCKED')
        self.assertEqual(report['qualifying_views'], ['construction'])
        self.assertEqual(report['per_image']['oblique']['exclusion'], 'gate:false')

    def test_undeclared_camera_eligibility_is_not_inferred_from_pose(self):
        del self.cameras['cameras'][1]['gate']
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_eighty_mm_uncertainty_cannot_prove_twenty_five_mm_accuracy(self):
        self.sources[0]['sigma_mm'] = 80
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_missing_required_feature_cannot_hide_among_many_other_points(self):
        self.requirements['required_landmarks'] = self.names + ['hidden_return']
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_duplicate_points_do_not_supply_coverage(self):
        self.rows = [copy.copy(self.rows[0]) for _ in range(50)]
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_fit_views_do_not_supply_independent_validation(self):
        self.cameras['cameras'][1]['validation_role'] = 'fit'
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_unknown_uncertainty_or_invalid_depth_or_error_fails(self):
        for field, value in [('d_mm', float('nan')), ('d_mm', 52.4), ('depth_m', -1)]:
            with self.subTest(field=field, value=value):
                saved = self.rows[0][field]
                self.rows[0][field] = value
                self.assertEqual(self.check()['status'], 'BLOCKED')
                self.rows[0][field] = saved
        del self.sources[0]['sigma_mm']
        self.assertEqual(self.check()['status'], 'BLOCKED')

    def test_missing_pose_and_unknown_camera_fail(self):
        self.cameras['cameras'][1]['rvec'] = None
        self.assertEqual(self.check()['status'], 'BLOCKED')
        self.rows[0]['image_id'] = 'unregistered'
        self.assertTrue(any('unknown cameras' in r for r in self.check()['reasons']))

    def test_unrelated_holdout_points_cannot_validate_required_features(self):
        self.cameras['cameras'][1]['validation_role'] = 'fit'
        extra = dict(self.cameras['cameras'][0], id='third', validation_role='holdout')
        self.cameras['cameras'].append(extra)
        for i in range(6):
            name = 'unrelated_' + str(i)
            self.rows.append(dict(image_id='third', name=name, d_mm=1, depth_m=2))
            self.sources.append(dict(name=name, sigma_mm=2))
        self.assertTrue(any('lack a qualifying holdout' in r for r in self.check()['reasons']))

    def test_requirements_cannot_be_empty_or_malformed(self):
        for value in [[], 'crown', [''], ['crown', 'crown']]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                photo_evidence(self.rows, self.cameras, self.sources, {'required_landmarks': value})


if __name__ == '__main__':
    unittest.main()

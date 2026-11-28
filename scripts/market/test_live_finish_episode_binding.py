import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import pandas as pd

path = Path(__file__).with_name('live-finish.py')
spec = importlib.util.spec_from_file_location('live_finish', path)
finish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finish)

VEHICLE = '00000000-0000-4000-8000-000000000101'
EVENT = '00000000-0000-4000-8000-000000000201'
URL = 'https://bringatrailer.com/listing/fixture-relisted-car'


def lot(**overrides):
    row = {
        'vehicle_id': VEHICLE, 'house': 'bringatrailer', 'listing_url': URL,
    }
    row.update(overrides)
    return row


class EpisodeBindingTests(unittest.TestCase):
    def binding(self, **overrides):
        result = {'applied': True, 'basis': 'retained_native_current_episode',
                  'canonical_vehicle_id': VEHICLE, 'auction_event_id': EVENT}
        result.update(overrides)
        return result

    def test_verified_relisted_lot_carries_its_exact_event(self):
        result = finish.verified_source_bindings(pd.DataFrame([lot()]), {URL: self.binding()})
        self.assertEqual(result, {VEHICLE: {'source_event_id': EVENT,
                                            'source_listing_url': URL,
                                            'source_identity_basis': 'retained_native_current_episode'}})

    def test_unapplied_mismatched_and_malformed_bindings_are_withheld(self):
        cases = [
            (lot(), {URL: self.binding(applied=False)}),
            (lot(), {URL: self.binding(canonical_vehicle_id='00000000-0000-4000-8000-000000000102')}),
            (lot(), {URL: self.binding(auction_event_id='not-a-uuid')}),
            (lot(listing_url='https://example.com/listing/not-the-auction'), {URL: self.binding()}),
            (lot(house='pcarmarket'), {URL: self.binding()}),
            (lot(), {}),
            (lot(), {'https://bringatrailer.com/listing/another': self.binding()}),
        ]
        for row, links in cases:
            with self.subTest(row=row, links=links):
                self.assertEqual(finish.verified_source_bindings(pd.DataFrame([row]), links), {})

    def test_same_vehicle_in_two_presentations_cannot_bind_either(self):
        competing = lot(house='pcarmarket', listing_url='https://www.pcarmarket.com/auction/another')
        self.assertEqual(finish.verified_source_bindings(pd.DataFrame([lot(), competing]), {URL: self.binding()}), {})

    def test_duplicate_board_rows_do_not_create_a_binding(self):
        self.assertEqual(finish.verified_source_bindings(pd.DataFrame([lot(), lot()]), {URL: self.binding()}), {})

    def test_native_fold_binds_the_same_episode_and_rejects_conflicting_source(self):
        state = {VEHICLE: {'basis': 'canonical_native_fold', 'auction_event_id': EVENT,
                           'source_listing_claims': {'source_url': URL}}}
        result = finish.verified_source_bindings(pd.DataFrame([lot()]), {}, state)
        self.assertEqual(result[VEHICLE]['source_event_id'], EVENT)
        self.assertEqual(result[VEHICLE]['source_identity_basis'], 'canonical_native_fold')
        state[VEHICLE]['source_listing_claims']['source_url'] = URL + '-other'
        self.assertEqual(finish.verified_source_bindings(pd.DataFrame([lot()]), {}, state), {})
        state[VEHICLE]['source_listing_claims'] = None
        self.assertEqual(finish.verified_source_bindings(pd.DataFrame([lot()]), {}, state)[VEHICLE]['source_event_id'], EVENT)

    def test_refused_link_does_not_fall_back_to_native_state(self):
        state = {VEHICLE: {'basis': 'canonical_native_fold', 'auction_event_id': EVENT}}
        self.assertEqual(finish.verified_source_bindings(pd.DataFrame([lot()]), {URL: self.binding(applied=False)}, state), {})

    def test_scorer_accepts_wrapped_and_existing_input_shapes(self):
        row = {'id': VEHICLE, 'title': 'Fixture car', 'listing_url': URL, 'house': 'bringatrailer'}
        cases = [
            ({'lots': [row], 'identity_links': {URL: self.binding()}}, True),
            ([row], False),
            ({'columns': ['id', 'title', 'listing_url'], 'auctions': [[VEHICLE, 'Fixture car', URL]]}, False),
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'lots.json'
            for payload, is_bound in cases:
                with self.subTest(payload=payload):
                    path.write_text(json.dumps(payload))
                    lots = finish.load_lots(path)
                    self.assertEqual(list(lots.vehicle_id), [VEHICLE])
                    links, state = finish.load_source_identity(path)
                    self.assertEqual(bool(finish.verified_source_bindings(lots, links, state)), is_bound)


if __name__ == '__main__':
    unittest.main()

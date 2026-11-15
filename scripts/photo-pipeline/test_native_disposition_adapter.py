import unittest
import hashlib
import json

from native_disposition_adapter import adapt

def bound_adapt(source, selected, **kwargs):
    raw = json.dumps(source).encode()
    selected = {**selected, "inputSha256": hashlib.sha256(raw).hexdigest()}
    return adapt(source, selected, input_bytes=raw, **kwargs)


class NativeAdapterTests(unittest.TestCase):
    def test_binds_native_candidate_to_current_source_and_holds_missing_lineage(self):
        source = {"assets": [{"id": "no-gps", "sourceVersion": "v1", "captureAt": "2026-05-13T21:40:00Z",
                              "latitude": None, "longitude": None, "labels": [], "exactVehicleIds": []}]}
        selected = {"mediaScope": "images_only", "sourceImages": 1,
                    "candidates": [{"id": "no-gps", "reasons": ["near_anchor_time", "missing_gps"]}]}
        frozen, manifest = bound_adapt(source, selected, snapshot_id="fixture", observed_at="2026-11-15T00:00:00Z",
                                 source_namespace="fixture-library", access_scope="sample",
                                 videos_outside_selector=19)
        self.assertEqual(frozen["candidates"][0]["sourceVersion"], "v1")
        self.assertEqual(frozen["snapshot"]["nativeInputSha256"], hashlib.sha256(json.dumps(source).encode()).hexdigest())
        self.assertEqual(manifest["counts"], {"original_unverified": 1})
        self.assertEqual(manifest["mediaCoverage"]["knownVideosOutsideSelector"], 19)
        self.assertEqual(manifest["sourceProposals"], [])

    def test_stale_or_unbound_output_cannot_promote_reasons(self):
        source = {"assets": [{"id": "same", "sourceVersion": "v2"}]}
        old = json.dumps({"assets": [{"id": "same", "sourceVersion": "v1"}]}).encode()
        raw = json.dumps(source).encode()
        for fingerprint in (None, hashlib.sha256(old).hexdigest()):
            selected = {"mediaScope": "images_only", "sourceImages": 1,
                        "inputSha256": fingerprint, "candidates": [{"id": "same", "reasons": ["work_label"]}]}
            with self.assertRaisesRegex(ValueError, "fingerprint missing or changed"):
                adapt(source, selected, input_bytes=raw, snapshot_id="fixture",
                      observed_at="2026-11-15T00:00:00Z", source_namespace="fixture-library",
                      access_scope="sample", videos_outside_selector=0)

    def test_rejects_candidate_outside_native_source_snapshot(self):
        source = {"assets": [{"id": "a", "sourceVersion": "v1"}]}
        selected = {"mediaScope": "images_only", "sourceImages": 1,
                    "candidates": [{"id": "withdrawn", "reasons": []}]}
        with self.assertRaisesRegex(ValueError, "outside source snapshot"):
            bound_adapt(source, selected, snapshot_id="fixture", observed_at="2026-11-15T00:00:00Z",
                  source_namespace="fixture-library", access_scope="sample", videos_outside_selector=0)


if __name__ == "__main__":
    unittest.main()

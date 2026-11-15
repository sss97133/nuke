import unittest
import hashlib
import json

from native_disposition_adapter import adapt
from source_disposition import build, digest
from test_source_disposition import qualified

def bound_adapt(source, selected, **kwargs):
    raw = json.dumps(source).encode()
    selected = {**selected, "inputSha256": hashlib.sha256(raw).hexdigest()}
    selected.setdefault("unplaced", [{"id": asset["id"], "reasons": []} for asset in source["assets"]])
    return adapt(source, selected, input_bytes=raw, **kwargs)


class NativeAdapterTests(unittest.TestCase):
    def test_retained_reference_does_not_promote_original_or_current_library_version(self):
        source = {"assets": [{"id": "SOURCE-A", "sourceVersion": "local-v2"}]}
        retained = {"sourceScope": "retained_capture", "sourceNamespace": "retained-owner",
                    "observedAt": "2026-11-15T00:00:00Z", "sourceProposals": [],
                    "rows": [{"sourceId": "source-a", "sourceVersion": "retained-v1",
                              "existingLeafImageId": "leaf", "disposition": "supported_complete"}]}
        retained["manifestSha256"] = digest(retained)
        args = dict(snapshot_id="fixture", observed_at="2026-11-15T00:00:00Z", source_namespace="local-store",
                    access_scope="sample", videos_outside_selector=0, retained_disposition=retained)
        selected = {"mediaScope": "images_only", "sourceImages": 1, "candidates": []}
        _, result = bound_adapt(source, selected, **args)
        self.assertEqual(result["counts"], {"original_unverified": 1})
        self.assertEqual(result["sourceProposals"], [])
        self.assertFalse(result["rows"][0]["qualifiedCompleteFiling"])
        ref = result["rows"][0]["retainedCaptureReferences"][0]
        self.assertFalse(ref["currentSourceVersionVerified"])
        self.assertEqual(ref["retainedDisposition"], "supported_complete")
        retained["rows"][0]["sourceVersion"] = "changed"
        with self.assertRaisesRegex(ValueError, "fingerprint changed"):
            bound_adapt(source, selected, **args)

    def test_local_snapshot_keeps_video_denominator_and_does_not_rebind_changed_images(self):
        image = {"id": "image", "sourceVersion": "local-v1", "mediaKind": "image"}
        video = {"id": "video", "sourceVersion": "local-v2", "mediaKind": "video"}
        source = {"assets": [image]}
        meta = {"snapshotId": "fixture", "sourceNamespace": "local-store", "observedAt": "2026-11-15T00:00:00Z",
                "sourceScope": "local_photos_database", "sourceVersionBasis": "local_modification_hint",
                "accessScope": "sample", "declaredAssetCount": 2,
                "mediaCoverage": {"imagesEnumerated": True, "videosEnumerated": True, "knownVideosOutsideSelector": 1},
                "assets": [image, video]}
        args = dict(snapshot_id="fixture", observed_at=meta["observedAt"], source_namespace="local-store",
                    access_scope="sample", videos_outside_selector=1, source_snapshot={"snapshot": meta})
        selected = {"mediaScope": "images_only", "sourceImages": 1, "candidates": []}
        frozen, result = bound_adapt(source, selected, **args)
        self.assertEqual(frozen["snapshot"]["sourceScope"], "local_photos_database")
        self.assertEqual(result["counts"], {"original_unverified": 1, "unsupported_video": 1})
        self.assertEqual(result["sourceProposals"], [])
        args["source_snapshot"]["sourceFacts"] = {"image": {"sourceVersion": "local-v1", "selectedForAdmission": False,
            "original": {"sourceVersion": "local-v1", "sha256": "a" * 64, "byteSize": 12, "mimeType": "image/jpeg"}}}
        _, with_original = bound_adapt(source, selected, **args)
        self.assertEqual(with_original["counts"], {"privacy_hold": 1, "unsupported_video": 1})
        self.assertEqual(with_original["sourceProposals"], [])
        changed = {"assets": [{**image, "sourceVersion": "new-version"}]}
        with self.assertRaisesRegex(ValueError, "exact source snapshot"):
            bound_adapt(changed, selected, **args)
        args["source_namespace"] = "other-store"
        with self.assertRaisesRegex(ValueError, "identity or scope differs"):
            bound_adapt(source, selected, **args)

    def test_unknown_version_and_personal_control_outside_candidates(self):
        source = {"assets": [{"id": "unknown"}, {"id": "personal", "sourceVersion": "v1", "isPersonal": False}]}
        selected = {"mediaScope": "images_only", "sourceImages": 2, "candidates": [],
                    "unplaced": [{"id": "unknown", "reasons": []}, {"id": "personal", "reasons": ["personal_review"]}]}
        frozen, manifest = bound_adapt(source, selected, snapshot_id="fixture", observed_at="2026-11-15T00:00:00Z",
                                      source_namespace="fixture-library", access_scope="sample", videos_outside_selector=0)
        self.assertEqual(manifest["counts"], {"privacy_hold": 1, "version_unverified": 1})
        self.assertEqual(frozen["candidates"], [])
        self.assertIsNone(frozen["snapshot"]["assets"][0]["sourceVersion"])
        frozen["sourceFacts"]["personal"] = qualified()
        self.assertEqual(build(frozen)["counts"], {"privacy_hold": 1, "version_unverified": 1})
        self.assertEqual(build(frozen)["sourceProposals"], [])

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

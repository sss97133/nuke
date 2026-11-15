import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("source_disposition", Path(__file__).with_name("source_disposition.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
build = module.build
H1, H2 = "a" * 64, "b" * 64


def asset(sid, kind="image", gps=None):
    return {"id": sid, "sourceVersion": "v1", "mediaKind": kind,
            "captureAt": "2026-05-13T21:40:00Z", "captureClockBasis": "photos_creation_date",
            "latitude": gps[0] if gps else None, "longitude": gps[1] if gps else None,
            "labels": [], "exactVehicleIds": [], "filedVehicleId": None, "isPersonal": False}


def document(assets):
    return {"schemaVersion": 1, "intendedUse": "vehicle_gallery", "snapshot": {"snapshotId": "fixture", "sourceNamespace": "fixture-library",
            "observedAt": "2026-11-15T00:00:00Z",
            "accessScope": "sample", "declaredAssetCount": len(assets),
            "mediaCoverage": {"imagesEnumerated": True, "videosEnumerated": False,
                              "knownVideosOutsideSelector": 19}, "assets": assets},
            "candidates": [], "sourceFacts": {}, "priorSourceIds": []}


def qualified(sha=H1):
    return {"sourceVersion": "v1", "selectedForAdmission": True,
            "original": {"sourceVersion": "v1", "sha256": sha, "byteSize": 42, "mimeType": "image/heic"},
            "privacy": {"status": "clear", "sourceVersion": "v1", "decisionId": "privacy-1",
                        "intendedUse": "vehicle_gallery"}}


class SourceDispositionTests(unittest.TestCase):
    def test_local_database_keeps_its_scope_and_cannot_claim_full_permission(self):
        d = document([asset("local")])
        d["snapshot"].update(sourceScope="local_photos_database", sourceVersionBasis="local_modification_hint",
                             enumeration={"completeWithinLocalDatabase": True, "photoKitPermission": "not_measured"})
        result = build(d)
        self.assertEqual(result["sourceScope"], "local_photos_database")
        self.assertEqual(result["observedAt"], d["snapshot"]["observedAt"])
        self.assertEqual(result["enumeration"]["photoKitPermission"], "not_measured")
        d["snapshot"]["accessScope"] = "full"
        with self.assertRaisesRegex(ValueError, "bounded version basis"):
            build(d)

    def test_retained_capture_cannot_claim_original_or_admission(self):
        d = document([asset("preview")])
        d["snapshot"].update(sourceScope="retained_capture", sourceVersionBasis="retained_provenance_sha256")
        d["sourceFacts"]["preview"] = qualified()
        with self.assertRaisesRegex(ValueError, "retained capture cannot"):
            build(d)

    def test_exact_retained_leaf_keeps_partial_filing_and_version_scope(self):
        d = document([asset("preview")])
        d["snapshot"].update(sourceScope="retained_capture", sourceVersionBasis="retained_provenance_sha256")
        fact = qualified()
        fact["rendition"] = fact.pop("original")
        fact["selectedForAdmission"] = False
        fact["existingLeaf"] = {"imageId": "leaf", "sourceNamespace": "fixture-library",
            "sourceId": "preview", "sourceVersion": "v1", "byteRole": "rendition", "sha256": H1,
            "visibility": "current", "isSuperseded": False, "supersededBy": None, "sourceBindingId": "binding"}
        fact["filing"] = {"status": "partial", "sourceVersion": "v1", "recordedVehicleId": "car"}
        d["sourceFacts"]["preview"] = fact
        result = build(d)
        self.assertEqual(result["sourceScope"], "retained_capture")
        self.assertEqual(result["rows"][0]["disposition"], "partial")
        self.assertEqual(result["rows"][0]["recordedVehicleId"], "car")
        self.assertEqual(result["sourceProposals"], [])

    def test_no_gps_can_propose_unassigned_source(self):
        d = document([asset("decal")])
        d["sourceFacts"]["decal"] = qualified()
        d["candidates"] = [{"id": "decal", "sourceVersion": "v1", "reasons": ["near_anchor_time", "missing_gps"]}]
        result = build(d)
        self.assertEqual(result["rows"][0]["disposition"], "ready_source_admission")
        self.assertIn("missing_gps_context_only", result["rows"][0]["reasons"])
        self.assertIsNone(result["sourceProposals"][0]["vehicleId"])

    def test_unselected_source_is_distinct_from_discovery_candidate(self):
        d = document([asset("candidate"), asset("other")])
        d["candidates"] = [{"id": "candidate", "sourceVersion": "v1", "reasons": ["same_workday"]}]
        d["sourceFacts"] = {"candidate": {**qualified(), "selectedForAdmission": False},
                            "other": {**qualified(), "selectedForAdmission": False}}
        self.assertEqual({r["sourceId"]: r["disposition"] for r in build(d)["rows"]},
                         {"candidate": "candidate_unreviewed", "other": "unselected_source"})

    def test_partial_filing_does_not_become_complete(self):
        d = document([asset("partial")])
        d["sourceFacts"]["partial"] = {**qualified(), "filing": {"status": "partial", "sourceVersion": "v1"}}
        self.assertEqual(build(d)["rows"][0]["disposition"], "partial")
        self.assertEqual(build(d)["sourceProposals"], [])

    def test_transformed_copy_is_ambiguous_without_exact_source_bytes(self):
        d = document([asset("historical")])
        d["sourceFacts"]["historical"] = {**qualified(), "rendition": {"sourceVersion": "v1", "sha256": H2,
                                                                     "byteSize": 30, "mimeType": "image/jpeg"},
            "existingLeaf": {"imageId": "gallery-1", "sourceNamespace": "fixture-library",
                             "sourceId": "historical", "sourceVersion": "v1",
                             "byteRole": "original", "sha256": H2}}
        r = build(d)
        self.assertEqual(r["rows"][0]["disposition"], "identity_ambiguous")
        self.assertIsNone(r["rows"][0]["existingLeafImageId"])
        self.assertEqual(r["sourceProposals"], [])

    def test_same_time_distinct_source_ids_stay_distinct_and_order_independent(self):
        d = document([asset("b"), asset("a")])
        d["sourceFacts"] = {"a": qualified(), "b": qualified(H2)}
        r = build(d)
        self.assertEqual([p["sourceId"] for p in r["sourceProposals"]], ["a", "b"])
        d["snapshot"]["assets"].reverse()
        self.assertEqual(build(d)["manifestSha256"], r["manifestSha256"])

    def test_withdrawn_source_is_only_historical_and_hash_guard_works(self):
        d = document([asset("current")])
        d["priorSourceIds"] = ["removed", "current"]
        r = build(d)
        self.assertEqual([x["sourceId"] for x in r["rows"]], ["current"])
        self.assertEqual(r["priorAbsenceUnknown"], ["removed"])
        d["withdrawnSources"] = [{"id": "removed", "kind": "photokit_removed_from_permission_scope",
                                  "sourceNamespace": "fixture-library", "evidenceId": "change-1"}]
        r = build(d)
        self.assertEqual({x["sourceId"]: x["disposition"] for x in r["rows"]}["removed"], "withdrawn")
        self.assertEqual(r["sourceProposals"], [])
        d["expectedSnapshotSha256"] = r["snapshotSha256"]
        self.assertEqual(build(d)["manifestSha256"], r["manifestSha256"])
        d["snapshot"]["assets"][0]["sourceVersion"] = "v2"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            build(d)

    def test_personal_and_other_vehicle_context_cannot_auto_propose(self):
        personal, other = asset("personal"), asset("other", gps=(35.97, -114.85))
        personal["isPersonal"] = True
        other["filedVehicleId"] = "other-car"
        d = document([personal, other])
        d["candidates"] = [{"id": "personal", "sourceVersion": "v1", "reasons": ["personal_review"]},
                           {"id": "other", "sourceVersion": "v1", "reasons": ["filed_other_vehicle"]}]
        d["sourceFacts"] = {"personal": qualified(),
                            "other": {**qualified(), "selectedForAdmission": False,
                                      "filing": {"status": "disputed", "sourceVersion": "v1"}}}
        r = build(d)
        self.assertEqual({x["sourceId"]: x["disposition"] for x in r["rows"]},
                         {"other": "disputed", "personal": "privacy_hold"})
        self.assertEqual(r["sourceProposals"], [])

    def test_video_accounting_and_fresh_leaf_complete(self):
        d = document([asset("video", "video"), asset("filed")])
        d["sourceFacts"]["video"] = qualified()
        d["sourceFacts"]["video"]["original"]["mimeType"] = "video/quicktime"
        d["sourceFacts"]["filed"] = {**qualified(),
            "existingLeaf": {"imageId": "image-1", "sourceNamespace": "fixture-library",
                             "sourceId": "filed", "sourceVersion": "v1",
                             "byteRole": "original", "sha256": H1, "visibility": "current",
                             "isSuperseded": False, "supersededBy": None, "sourceBindingId": "binding-1"},
            "filing": {"status": "supported_complete", "sourceVersion": "v1",
                       "sourceNamespace": "fixture-library", "sourceId": "filed", "imageId": "image-1",
                       "decisionId": "filing-1", "witnessId": "witness-1", "intendedUse": "vehicle_gallery"}}
        r = build(d)
        self.assertEqual(r["counts"], {"supported_complete": 1, "unsupported_video": 1})
        self.assertEqual(r["sourceProposals"], [])

    def test_screenshot_requires_separate_review_even_with_clear_flag(self):
        d = document([asset("sheet", "screenshot")])
        d["sourceFacts"]["sheet"] = qualified()
        r = build(d)
        self.assertEqual(r["rows"][0]["disposition"], "privacy_hold")
        self.assertIn("sensitive_media_requires_current_policy_decision", r["rows"][0]["reasons"])
        self.assertEqual(r["sourceProposals"], [])
        d["sourceFacts"]["sheet"]["mediaPolicy"] = {"status": "clear", "sourceVersion": "v1",
                                                     "intendedUse": "vehicle_gallery",
                                                     "decisionId": "screenshot-review-1"}
        self.assertEqual(build(d)["rows"][0]["disposition"], "ready_source_admission")

    def test_complete_filing_requires_current_leaf_privacy_and_bound_witness(self):
        d = document([asset("filed")])
        d["sourceFacts"]["filed"] = {**qualified(),
            "existingLeaf": {"imageId": "image-1", "sourceNamespace": "fixture-library",
                             "sourceId": "filed", "sourceVersion": "v1", "byteRole": "original",
                             "sha256": H1, "visibility": "current", "isSuperseded": False,
                             "supersededBy": None, "sourceBindingId": "binding-1"},
            "filing": {"status": "supported_complete", "sourceVersion": "v1"}}
        self.assertEqual(build(d)["rows"][0]["disposition"], "disputed")
        d["sourceFacts"]["filed"]["filing"].update({"sourceNamespace": "fixture-library",
            "sourceId": "filed", "imageId": "image-1", "decisionId": "decision-1",
            "witnessId": "witness-1", "intendedUse": "vehicle_gallery"})
        complete = build(d)
        self.assertEqual(complete["rows"][0]["disposition"], "supported_complete")
        d["sourceFacts"]["filed"]["filing"]["witnessId"] = "witness-2"
        changed = build(d)
        self.assertEqual(changed["rows"][0]["disposition"], "supported_complete")
        self.assertNotEqual(changed["rows"][0]["sourceFactSha256"], complete["rows"][0]["sourceFactSha256"])
        self.assertNotEqual(changed["manifestSha256"], complete["manifestSha256"])
        d["sourceFacts"]["filed"]["existingLeaf"]["isSuperseded"] = True
        self.assertEqual(build(d)["rows"][0]["disposition"], "identity_ambiguous")
        d["sourceFacts"]["filed"]["existingLeaf"]["isSuperseded"] = False
        del d["sourceFacts"]["filed"]["existingLeaf"]["supersededBy"]
        self.assertEqual(build(d)["rows"][0]["disposition"], "identity_ambiguous")
        d["sourceFacts"]["filed"]["existingLeaf"]["supersededBy"] = "newer-image"
        self.assertEqual(build(d)["rows"][0]["disposition"], "identity_ambiguous")

    def test_sensitive_complete_filing_stays_held_without_media_policy(self):
        sheet = asset("sheet", "screenshot")
        d = document([sheet])
        d["sourceFacts"]["sheet"] = {**qualified(),
            "existingLeaf": {"imageId": "image-1", "sourceNamespace": "fixture-library", "sourceId": "sheet",
                             "sourceVersion": "v1", "byteRole": "original", "sha256": H1,
                             "visibility": "current", "isSuperseded": False, "supersededBy": None,
                             "sourceBindingId": "binding-1"},
            "filing": {"status": "supported_complete", "sourceVersion": "v1",
                       "sourceNamespace": "fixture-library", "sourceId": "sheet", "imageId": "image-1",
                       "decisionId": "filing-1", "witnessId": "witness-1", "intendedUse": "vehicle_gallery"}}
        r = build(d)["rows"][0]
        self.assertEqual(r["disposition"], "privacy_hold")
        self.assertFalse(r["qualifiedCompleteFiling"])
        d["sourceFacts"]["sheet"]["mediaPolicy"] = {"status": "clear", "sourceVersion": "v1",
            "decisionId": "media-1", "intendedUse": "vehicle_gallery"}
        r = build(d)["rows"][0]
        self.assertEqual(r["disposition"], "supported_complete")
        self.assertTrue(r["qualifiedCompleteFiling"])

    def test_invalid_version_and_duplicate_id_rejected(self):
        d = document([asset("a")])
        d["sourceFacts"]["a"] = {**qualified(), "sourceVersion": "old"}
        with self.assertRaisesRegex(ValueError, "version mismatch"):
            build(d)
        d = document([asset("a"), asset("a")])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            build(d)
        d = document([asset("a")])
        d["candidates"] = [{"id": "a", "sourceVersion": "old", "reasons": ["near_anchor_time"]}]
        with self.assertRaisesRegex(ValueError, "candidate source version mismatch"):
            build(d)

    def test_stale_byte_fact_and_privacy_clear_cannot_propose(self):
        d = document([asset("stale")])
        d["sourceFacts"]["stale"] = {**qualified(),
            "privacy": {"status": "clear", "sourceVersion": "old"}}
        self.assertEqual(build(d)["rows"][0]["disposition"], "privacy_hold")
        self.assertEqual(build(d)["sourceProposals"], [])
        d["sourceFacts"]["stale"] = {**qualified(),
            "original": {"sourceVersion": "old", "sha256": H1, "byteSize": 42, "mimeType": "image/heic"}}
        with self.assertRaisesRegex(ValueError, "current sourceVersion"):
            build(d)

    def test_missing_photo_kit_version_is_accounted_and_held(self):
        photo = asset("unversioned")
        photo["sourceVersion"] = None
        d = document([photo])
        r = build(d)
        self.assertEqual(r["rows"][0]["disposition"], "version_unverified")
        self.assertEqual(r["rows"][0]["requiredNext"], ["current_source_version"])
        self.assertEqual(r["sourceProposals"], [])


if __name__ == "__main__":
    unittest.main()

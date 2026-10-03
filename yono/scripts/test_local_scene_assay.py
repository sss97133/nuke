"""Network-free admission, guided decoding, budget and failure tests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from PIL import Image
import local_scene_assay as assay


class SceneAssayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "synthetic.jpg"
        Image.new("RGB", (12, 8)).save(self.path)
        self.packet = assay.load_questionnaire()
        self.rows = [{"image_id": str(uuid4()), "vehicle_id": str(uuid4()),
                      "public": True, "path": str(self.path),
                      "sha256": assay.sha256(self.path.read_bytes()),
                      "source_url": "https://bringatrailer.com/example.jpg", "source": "bat_import",
                      "is_sensitive": False, "is_duplicate": False, "is_superseded": False,
                      "vision_gate_status": "pending", "expected_image_type": "vehicle_exterior"}
                     for _ in range(4)]
        del self.rows[3]["expected_image_type"]
        self.manifest = {"images": self.rows}
        self.calls = []

    def response(self):
        return {"model": self.packet["model"], "done": True, "done_reason": "stop",
                "created_at": "2026-10-03T03:00:00Z", "total_duration": 5000000,
                "load_duration": 0, "prompt_eval_count": 100, "eval_count": 20,
                "message": {"role": "assistant", "content": json.dumps(
                    {"image_type": "vehicle_exterior", "visible_evidence": "whole_vehicle"})}}

    def request(self, path, payload=None, timeout=5):
        self.calls.append((path, payload, timeout))
        if path == "/api/tags":
            return {"models": [{"name": self.packet["model"], "digest": assay.MODEL_DIGEST}]}
        return self.response()

    def test_frozen_executed_packet_hash(self):
        self.assertEqual(self.packet["version"], "local_image_scene_v2")
        self.assertEqual(assay.sha256(json.dumps(self.packet, sort_keys=True,
                         separators=(",", ":")).encode()), assay.QUESTIONNAIRE_HASH)

    def test_default_is_no_network_dry_run(self):
        receipt = assay.run_assay(self.manifest, request=self.request)
        self.assertEqual(self.calls, [])
        self.assertTrue(receipt["summary"]["dry_run"])
        self.assertEqual(receipt["summary"]["model_calls"], 0)

    def test_public_source_qualification_fails_before_transport(self):
        variants = [{"public": False}, {"public": "true"}, {"is_sensitive": None},
                    {"is_duplicate": True}, {"is_superseded": True},
                    {"vision_gate_status": "rejected"}, {"sha256": "0" * 64},
                    {"source_url": "https://bringatrailer.com.evil.test/a.jpg"},
                    {"source_url": "https://bringatrailer.com/a.jpg?token=private"},
                    {"source_url": "https://user@bringatrailer.com/a.jpg"}]
        for changes in variants:
            with self.subTest(changes=changes):
                manifest = copy.deepcopy(self.manifest)
                manifest["images"][0].update(changes)
                with self.assertRaises(ValueError):
                    assay.run_assay(manifest, run=True, request=self.request)
        self.assertEqual(self.calls, [])

    def test_duplicate_oversize_and_missing_controls_rejected(self):
        for rows in [self.rows + [self.rows[0]], self.rows * 6,
                     [{k: v for k, v in row.items() if k != "expected_image_type"}
                      for row in self.rows]]:
            with self.assertRaises(ValueError):
                assay.run_assay({"images": rows}, run=True, request=self.request)
        with patch.object(assay, "MAX_IMAGE_BYTES", 1):
            with self.assertRaises(ValueError):
                assay.run_assay(self.manifest, run=True, request=self.request)
        self.assertEqual(self.calls, [])

    def test_guided_payload_and_frozen_pixel_provenance(self):
        completed = []
        result = assay.run_assay(self.manifest, run=True, request=self.request,
                                  record_completed=completed.append)
        self.assertTrue(result["summary"]["completed"])
        self.assertEqual(result["summary"]["schema_valid"], 4)
        self.assertEqual(len(completed), 4)
        for path, payload, timeout in self.calls[1:]:
            self.assertEqual(path, "/api/chat")
            self.assertEqual(payload["format"], self.packet["schema"])
            self.assertFalse(payload["stream"])
            self.assertEqual(payload["options"]["temperature"], 0)
            self.assertEqual(payload["options"]["num_predict"], 160)
            self.assertLessEqual(timeout, 60)
        self.assertEqual(self.calls[-1][1]["keep_alive"], 0)
        row = result["results"][0]
        self.assertEqual(row["original_sha256"], self.rows[0]["sha256"])
        self.assertEqual(row["sent_sha256"], row["original_sha256"])
        self.assertEqual(row["response"]["created_at"], "2026-10-03T03:00:00Z")
        self.assertEqual(row["semantic_review"], "unreviewed")
        self.assertTrue(result["summary"]["classifications_are_unaccepted_testimony"])

    def test_nullable_exact_schema_rejects_fabricated_details(self):
        self.assertEqual(assay.validate_scene('{"image_type":null,"visible_evidence":null}',
                                             self.packet)["image_type"], None)
        for content in ['{"image_type":"wrong","visible_evidence":null}',
                        '{"image_type":"other","visible_evidence":false}',
                        '{"image_type":"other","visible_evidence":null,"condition":5}',
                        '{"image_type":"other","image_type":null,"visible_evidence":null}',
                        '{"image_type":"other","visible_evidence":NaN}']:
            with self.assertRaises(ValueError):
                assay.validate_scene(content, self.packet)

    def test_response_incomplete_usage_and_missing_clock_rejected(self):
        for changes in [{"done_reason": "length"}, {"done": False}, {"model": "remote"},
                        {"created_at": "2026-10-03T03:00:00"}, {"eval_count": True},
                        {"prompt_eval_count": -1}]:
            response = self.response()
            response.update(changes)
            with self.assertRaises(ValueError):
                assay.validate_response(response, self.packet)

    def test_model_digest_drift_makes_zero_generation_calls(self):
        def request(path, payload=None, timeout=5):
            self.calls.append(path)
            return {"models": [{"name": self.packet["model"], "digest": "changed"}]}
        with self.assertRaisesRegex(ValueError, "digest"):
            assay.run_assay(self.manifest, run=True, request=request)
        self.assertEqual(self.calls, ["/api/tags"])

    def test_provider_failure_no_retry_or_false_completion(self):
        def request(path, payload=None, timeout=5):
            if path == "/api/chat":
                raise TimeoutError("never publish this raw private response")
            return self.request(path, payload, timeout)
        result = assay.run_assay(self.manifest, run=True, request=request)
        self.assertEqual(result["summary"]["model_calls"], 1)
        self.assertFalse(result["summary"]["completed"])
        self.assertEqual(result["results"][0]["error_type"], "TimeoutError")
        self.assertNotIn("private response", json.dumps(result))

    def test_control_disagreement_stops_expansion(self):
        def request(path, payload=None, timeout=5):
            result = self.request(path, payload, timeout)
            if path == "/api/chat":
                result["message"]["content"] = '{"image_type":"other","visible_evidence":null}'
            return result
        result = assay.run_assay(self.manifest, run=True, request=request)
        self.assertEqual(result["summary"]["model_calls"], 1)
        self.assertEqual(result["summary"]["schema_valid"], 1)
        self.assertFalse(result["summary"]["completed"])
        self.assertFalse(result["results"][0]["control_agreement"])

    def test_expired_run_does_not_start_generation(self):
        values = iter([0, 300, 300])
        result = assay.run_assay(self.manifest, run=True, request=self.request,
                                  clock=lambda: next(values))
        self.assertEqual(result["summary"]["model_calls"], 0)
        self.assertEqual(result["summary"]["stopped_reason"], "run_budget")
        self.assertFalse(result["summary"]["completed"])

    def test_redirects_forbidden(self):
        with self.assertRaisesRegex(ValueError, "redirect"):
            assay.NoRedirect().redirect_request(None)


if __name__ == "__main__":
    unittest.main()

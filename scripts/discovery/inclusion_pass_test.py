"""Failure, privacy and evidence-stage checks for the existing discovery engine."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("inclusion_pass", Path(__file__).with_name("inclusion-pass.py"))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class DiscoveryContractTests(unittest.TestCase):
    def test_query_errors_cannot_be_reported_as_empty_inspection(self):
        for output, code in [(json.dumps({"message": "permission denied"}), 0),
                             ("not json", 0), ("[]", 1), ("[1]", 0)]:
            with self.subTest(output=output, code=code):
                result = subprocess.CompletedProcess([], code, output, "")
                with patch.object(engine.subprocess, "run", return_value=result):
                    with self.assertRaises(RuntimeError):
                        engine.q("select 1")

    def test_query_is_forced_read_only_and_has_timeout(self):
        result = subprocess.CompletedProcess([], 0, '[{"value":1}]', "")
        with patch.object(engine.subprocess, "run", return_value=result) as runner:
            self.assertEqual(engine.q("select 1 as value"), [{"value": 1}])
        sql = runner.call_args.args[0][1]
        self.assertIn("BEGIN READ ONLY", sql)
        self.assertIn("statement_timeout='30s'", sql)
        self.assertTrue(sql.endswith("COMMIT;"))

    def test_identifier_injection_fails_before_sample_query(self):
        with patch.object(engine, "targets", return_value=([], [])), patch.object(engine, "q") as query:
            with self.assertRaises(ValueError):
                engine.run(["vehicles; DELETE FROM vehicle_observations"], None)
            query.assert_not_called()

    def test_perfect_handle_inclusion_remains_unqualified_candidate(self):
        values = [{"v": "handle_" + str(i)} for i in range(30)]
        responses = [[{"est_rows": 1000}], [{"column_name": "author_username", "data_type": "text"}],
                     values, [{"n": 30}]]
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "candidates.json"
            with patch.object(engine, "targets", return_value=([], [("external_identities", "handle", "lower")])), \
                 patch.object(engine, "q", side_effect=responses), contextlib.redirect_stdout(io.StringIO()):
                engine.run(["synthetic_comments"], destination)
            candidate = json.loads(destination.read_text())[0]
            self.assertEqual(candidate["rate"], 1.0)
            self.assertEqual(candidate["evidence_stage"], "sample_inclusion")
            self.assertTrue(candidate["requires_platform_scope"])
            self.assertFalse(candidate["semantic_identity_verified"])
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_catalog_retains_private_code_and_separates_mentions_from_dependencies(self):
        def synthetic_query(sql):
            category = next(name for name, query in engine.CATALOG_QUERIES.items() if query == sql)
            if category == "relations": return [{"name": "vehicle_log", "kind": "r"}]
            if category == "columns": return [{"relation": "vehicle_log", "name": "vehicle_id", "description": None}]
            if category == "functions": return [{"oid": 101, "body": "-- vehicle_log\nSELECT 'private-body-marker';"}]
            return []
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "catalog.json"
            output = io.StringIO()
            with patch.object(engine, "q", side_effect=synthetic_query), contextlib.redirect_stdout(output):
                catalog = engine.export_catalog(destination)
            self.assertNotIn("private-body-marker", output.getvalue())
            self.assertIn("private-body-marker", destination.read_text())
            self.assertFalse(catalog["scope"]["semantic_review_complete"])
            self.assertEqual(catalog["dependencies"], [])
            mention = catalog["function_relation_mentions"][0]
            self.assertEqual(mention["evidence_stage"], "lexical_candidate")
            self.assertFalse(mention["runtime_verified"])
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_incomplete_catalog_never_replaces_previous_complete_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "catalog.json"
            destination.write_text('{"previous_complete":true}')
            with patch.object(engine, "q", side_effect=[[], RuntimeError("network failure")]):
                with self.assertRaises(RuntimeError):
                    engine.export_catalog(destination)
            self.assertEqual(json.loads(destination.read_text()), {"previous_complete": True})

    def test_catalog_requires_private_destination_and_does_not_query(self):
        process = subprocess.run([os.sys.executable, str(Path(__file__).with_name("inclusion-pass.py")), "--catalog"],
                                 capture_output=True, text=True)
        self.assertEqual(process.returncode, 2)
        self.assertIn("requires --json", process.stderr)
        self.assertEqual(process.stdout, "")


if __name__ == "__main__":
    unittest.main()

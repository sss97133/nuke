"""Offline tests of private source retrieval and false completion boundaries."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'agent-intent.py'
spec = importlib.util.spec_from_file_location('agent_intent', SCRIPT)
intent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intent)


class IntentContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'archive'
        self.source = self.base / 'source.jsonl'
        records = [
            dict(role='user', text='Derive the drawing from the recorded model.', uuid='u1'),
            dict(role='assistant', text='The source reader and its evidence need verification.', uuid='a1'),
            dict(role='user', text='Keep unresolved inputs explicit; do not invent values.', uuid='u2'),
        ]
        for i, record in enumerate(records):
            record.update(session_id='fixture-session', source_path='fixture-original.jsonl',
                          record_kind='test_source', sequence=i,
                          timestamp='2026-01-01T00:00:00Z')
        self.source.write_text(''.join(json.dumps(x) + '\n' for x in records))
        self.manifest = self.base / 'manifest.json'
        self.manifest.write_text(json.dumps(dict(coverage='bounded_pilot', inputs=[
            dict(platform='fixture', path=str(self.source))], limits=['One synthetic session.'])))
        self.root.mkdir()
        (self.root / 'manifest.json').write_bytes(self.manifest.read_bytes())
        with contextlib.redirect_stdout(io.StringIO()):
            intent.build(self.root, self.manifest)
        with contextlib.closing(intent.connect(self.root)) as db:
            self.anchor = db.execute("SELECT id FROM messages WHERE locator='u1'").fetchone()[0]
            self.correction = db.execute("SELECT id FROM messages WHERE locator='u2'").fetchone()[0]
            self.assistant = db.execute("SELECT id FROM messages WHERE locator='a1'").fetchone()[0]
        self.requirement = dict(id='R-TEST', scopes=['drawing'], status='active',
            statement='The drawing consumes the recorded model and preserves unknowns.',
            source_occurrence_ids=[self.anchor, self.correction], evidence_kinds=['interaction'],
            implementation_status='open',
            implementation_links=[dict(path='example.sql', stage='committed', runtime='unverified')],
            open_outcomes=['Live consumer not verified.'])
        self.write_ledger([self.requirement])

    def write_ledger(self, requirements):
        (self.root / 'requirements.json').write_text(json.dumps(dict(requirements=requirements)))

    def test_missing_archive_is_explicit_and_is_not_created(self):
        missing = self.base / 'missing'
        result, status = intent.packet(missing, 'drawing')
        self.assertEqual(status, 2)
        self.assertIn('archive_unavailable', result['failures'])
        self.assertFalse(missing.exists())

    def test_partial_history_stays_partial(self):
        result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 0)
        self.assertEqual(result['status'], 'retrievable')
        self.assertEqual(result['archive']['coverage'], 'bounded_pilot')
        self.assertTrue(any('absence is not abandonment' in x for x in result['archive']['limits']))

    def test_sources_keep_the_correction_and_adjacent_response(self):
        result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 0)
        sources = {x['id']: x for x in result['sources']}
        self.assertEqual(set(sources), {self.anchor, self.correction, self.assistant})
        self.assertEqual(sources[self.assistant]['role'], 'assistant')
        self.assertTrue(sources[self.correction]['body'].startswith('Keep unresolved'))
        self.assertEqual(sources[self.anchor]['locator'], 'u1')
        self.assertEqual(len(sources[self.anchor]['raw_hash']), 64)

    def test_declared_implementation_is_not_promoted_to_verified(self):
        result, _ = intent.packet(self.root, 'drawing')
        requirement = result['requirements'][0]
        self.assertEqual(requirement['implementation_status'], 'open')
        self.assertEqual(requirement['implementation_links'][0]['runtime'], 'unverified')
        self.assertEqual(requirement['open_outcomes'], ['Live consumer not verified.'])

    def test_unreviewed_scope_is_not_an_empty_success(self):
        result, status = intent.packet(self.root, 'unreviewed')
        self.assertEqual(status, 1)
        self.assertIn('scope_unreviewed_or_unavailable', result['failures'])

    def test_duplicate_requirement_ids_are_not_silently_collapsed(self):
        self.write_ledger([self.requirement, dict(self.requirement, statement='Different meaning')])
        with self.assertRaisesRegex(ValueError, 'Duplicate reviewed requirement ID'):
            intent.packet(self.root, 'drawing')

    def test_malformed_scope_cannot_match_a_substring(self):
        self.requirement['scopes'] = 'drawing-related'
        self.write_ledger([self.requirement])
        with self.assertRaisesRegex(ValueError, 'scopes must be a list'):
            intent.packet(self.root, 'drawing')

    def test_changed_frozen_input_refuses_a_packet(self):
        with self.source.open('a') as stream:
            stream.write('\n')
        result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 2)
        self.assertIn('indexed_input_changed', result['archive']['failures'])

    def test_changed_manifest_does_not_silently_reuse_old_index(self):
        manifest = json.loads(self.manifest.read_text())
        manifest['inputs'][0]['path'] = str(self.base / 'unindexed.jsonl')
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 2)
        self.assertIn('manifest_and_index_inputs_differ', result['archive']['failures'])

    def test_source_hashing_has_a_bound(self):
        with patch.object(intent, 'MAX_INPUT_BYTES', 1):
            result = intent.archive_health(self.root, verify_hashes=True)
        self.assertEqual(result['status'], 'unavailable')
        self.assertIn('input_verification_budget_exceeded', result['failures'])

    def test_unchanged_large_exports_do_not_get_rehashed_for_every_task(self):
        with patch.object(intent, 'MAX_INPUT_BYTES', 1):
            result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 0)
        self.assertEqual(result['archive']['input_verification'], 'metadata_bound_to_indexed_hash')
        self.assertEqual(result['archive']['input_bytes_verified'], 0)

    def test_legacy_receipts_without_metadata_are_hash_checked(self):
        p = self.root / 'index-receipt.json'
        receipt = json.loads(p.read_text())
        for source in receipt['inputs']:
            source.pop('bytes')
            source.pop('mtime_ns')
        p.write_text(json.dumps(receipt))
        result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 0)
        self.assertEqual(result['archive']['input_verification'], 'current_hash')
        self.assertEqual(result['archive']['input_bytes_verified'], self.source.stat().st_size)

    def test_missing_original_link_is_explicit(self):
        self.requirement.pop('source_occurrence_ids')
        self.write_ledger([self.requirement])
        result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 1)
        self.assertTrue(any('original_source_links_missing' in x for x in result['failures']))

    def test_missing_and_assistant_anchors_cannot_replace_owner_sources(self):
        for anchor in ['f' * 64, self.assistant]:
            with self.subTest(anchor=anchor):
                self.requirement['source_occurrence_ids'] = [anchor]
                self.write_ledger([self.requirement])
                result, status = intent.packet(self.root, 'drawing')
                self.assertEqual(status, 1)
                self.assertTrue(any('original_user_record_unavailable' in x for x in result['failures']))

    def test_truncation_is_explicit_and_incomplete(self):
        with patch.object(intent, 'MAX_PACKET_CHARACTERS', 4):
            result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 1)
        self.assertTrue(any(x['text_truncated'] for x in result['sources']))
        self.assertLessEqual(sum(len(x['body']) for x in result['sources']), 4)

    def test_requirement_count_is_bounded(self):
        with patch.object(intent, 'MAX_REQUIREMENTS', 0):
            result, status = intent.packet(self.root, 'drawing')
        self.assertEqual(status, 1)
        self.assertIn('requirement_budget_exceeded', result['failures'])

    def test_credentials_are_redacted_before_index_output(self):
        secret = 'sk-' + 'A' * 24
        record = intent.record(dict(text='Example ' + secret, role='user'), 'fixture', self.source, 1)
        self.assertNotIn(secret, record[-1])
        self.assertIn('[REDACTED_CREDENTIAL]', record[-1])

    def test_repeated_messages_keep_independent_source_occurrences(self):
        a = intent.record(dict(text='Same words', uuid='first', role='user'), 'fixture', self.source, 1)
        b = intent.record(dict(text='Same words', uuid='second', role='user'), 'fixture', self.source, 2)
        self.assertNotEqual(a[0], b[0])
        self.assertEqual(a[-2:], b[-2:])

    def test_fresh_process_recovers_packet_outside_repository(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(self.root),
            'packet', '--scope', 'drawing'], cwd=self.base, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value['requirements'][0]['source_occurrence_ids'], [self.anchor, self.correction])

    def test_code_evidence_alone_cannot_satisfy_interaction_requirement(self):
        receipt = self.base / 'receipt.json'
        with contextlib.redirect_stdout(io.StringIO()):
            intent.prepare(self.root, 'drawing', 'Synthetic inspection', receipt)
        value = json.loads(receipt.read_text())
        evidence = self.base / 'code.txt'
        evidence.write_text('Synthetic committed implementation evidence')
        value['requirements'][0].update(disposition='satisfied', evidence=[dict(kind='source',
            path=str(evidence), sha256=hashlib.sha256(evidence.read_bytes()).hexdigest(),
            observed_at='2026-01-01T00:00:00Z', target='source', observation='Code exists')])
        receipt.write_text(json.dumps(value))
        with contextlib.redirect_stdout(io.StringIO()) as output:
            status = intent.check(self.root, receipt)
        self.assertEqual(status, 1)
        self.assertIn('interaction', output.getvalue())

    def test_later_requirement_correction_invalidates_old_receipt(self):
        receipt = self.base / 'receipt.json'
        with contextlib.redirect_stdout(io.StringIO()):
            intent.prepare(self.root, 'drawing', 'Synthetic inspection', receipt)
        self.requirement['statement'] = 'A corrected owner requirement.'
        self.write_ledger([self.requirement])
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(intent.check(self.root, receipt), 1)
        self.assertIn('Requirement version changed', output.getvalue())


if __name__ == '__main__':
    unittest.main()

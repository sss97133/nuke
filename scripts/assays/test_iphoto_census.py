import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('census', Path(__file__).with_name('iphoto-census.py'))
census = importlib.util.module_from_spec(spec)
spec.loader.exec_module(census)


class MetadataSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'Photos.sqlite'
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE Z_METADATA (Z_UUID TEXT)')
            db.execute("INSERT INTO Z_METADATA VALUES ('fixture-store')")
            db.execute('CREATE TABLE ZASSET (ZUUID TEXT,ZKIND INTEGER,ZHIDDEN INTEGER,ZTRASHEDSTATE INTEGER,ZDATECREATED REAL,ZMODIFICATIONDATE REAL,ZLATITUDE REAL,ZLONGITUDE REAL)')
            db.executemany('INSERT INTO ZASSET VALUES (?,?,?,?,?,?,?,?)', [
                ('a', 0, 0, 0, 100, 200, None, None),
                ('b', 0, 0, 0, 100, 201, 35, -114),
                ('movie', 1, 0, 0, 300, 400, -180, -180),
                ('hidden', 0, 1, 0, 100, 200, 35, -114),
                ('trashed', 0, 0, 1, 100, 200, 35, -114),
                ('unknown-visibility', 0, None, 0, 100, 200, 35, -114)])

    def test_visible_inventory_keeps_video_and_same_time_sources_without_cloud_claim(self):
        before = self.path.read_bytes()
        d = census.metadata_snapshot(self.path)
        s = d['snapshot']
        self.assertEqual([a['id'] for a in s['assets']], ['a', 'b', 'movie'])
        self.assertEqual(s['declaredAssetCount'], 3)
        self.assertEqual(s['mediaCoverage']['knownVideosOutsideSelector'], 1)
        self.assertEqual(s['enumeration']['excludedRows'], 3)
        self.assertEqual(s['enumeration']['iCloudCompleteness'], 'not_measured')
        self.assertEqual(s['enumeration']['photoKitPermission'], 'not_measured')
        self.assertIsNone(s['assets'][2]['latitude'])
        self.assertEqual(d['sourceFacts'], {})
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(census.metadata_snapshot(self.path)['snapshot']['snapshotId'], s['snapshotId'])

    def test_version_change_changes_snapshot_but_not_source_identity(self):
        before = census.metadata_snapshot(self.path)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE ZASSET SET ZMODIFICATIONDATE=202 WHERE ZUUID='a'")
        after = census.metadata_snapshot(self.path)
        self.assertNotEqual(before['snapshot']['snapshotId'], after['snapshot']['snapshotId'])
        self.assertEqual(before['snapshot']['assets'][0]['id'], after['snapshot']['assets'][0]['id'])

    def test_null_clock_and_version_are_unknown(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE ZASSET SET ZMODIFICATIONDATE=NULL,ZDATECREATED=NULL WHERE ZUUID='a'")
        a = census.metadata_snapshot(self.path)['snapshot']['assets'][0]
        self.assertIsNone(a['sourceVersion'])
        self.assertIsNone(a['captureAt'])

    def test_bound_and_unsupported_kind_refuse_without_partial_inventory(self):
        with self.assertRaisesRegex(ValueError, 'exceeds explicit bound'):
            census.metadata_snapshot(self.path, 2)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE ZASSET SET ZKIND=9 WHERE ZUUID='a'")
        with self.assertRaisesRegex(ValueError, 'unsupported visible media'):
            census.metadata_snapshot(self.path)

    def test_duplicate_id_refuses_and_hidden_id_cannot_be_seeded(self):
        d = census.metadata_snapshot(self.path)
        with self.assertRaisesRegex(ValueError, 'seed missing'):
            census.discovery_input(d, {'targetVehicleId': 'vehicle', 'timeZoneIdentifier': 'UTC', 'seedAssetIds': ['hidden']})
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE ZASSET SET ZUUID='a' WHERE ZUUID='b'")
        with self.assertRaisesRegex(ValueError, 'duplicate source UUID'):
            census.metadata_snapshot(self.path)

    def test_native_input_is_only_images_with_no_invented_label_or_filing(self):
        d = census.discovery_input(census.metadata_snapshot(self.path),
            {'targetVehicleId': 'vehicle', 'timeZoneIdentifier': 'UTC', 'seedAssetIds': ['a']})
        self.assertEqual([a['id'] for a in d['assets']], ['a', 'b'])
        self.assertTrue(all(a['labels'] == [] and a['exactVehicleIds'] == [] and a['filedVehicleId'] is None for a in d['assets']))

    def test_new_private_receipt_never_overwrites_checkpoint(self):
        path = Path(self.temp.name) / 'snapshot.json'
        census.write_private_json(path, {'version': 1})
        with self.assertRaises(FileExistsError):
            census.write_private_json(path, {'version': 2})
        self.assertEqual(json.loads(path.read_text()), {'version': 1})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def originals_fixture(self):
        root = Path(self.temp.name) / 'originals'
        (root / 'A').mkdir(parents=True)
        with sqlite3.connect(self.path) as db:
            db.execute('ALTER TABLE ZASSET ADD COLUMN ZDIRECTORY TEXT')
            db.execute('ALTER TABLE ZASSET ADD COLUMN ZFILENAME TEXT')
            db.execute("UPDATE ZASSET SET ZDIRECTORY='A',ZFILENAME=ZUUID||'.jpg'")
        (root / 'A' / 'a.jpg').write_bytes(b'\xff\xd8\xff' + b'synthetic original fixture')
        return root, census.metadata_snapshot(self.path)

    def test_original_bytes_are_separate_from_missing_local_cloud_unknown(self):
        root, snapshot = self.originals_fixture()
        facts = census.local_original_facts(self.path, snapshot, ['a', 'b'], root)
        self.assertEqual(facts['a']['original']['mimeType'], 'image/jpeg')
        self.assertEqual(facts['a']['original']['byteSize'], (root / 'A/a.jpg').stat().st_size)
        self.assertFalse(facts['a']['selectedForAdmission'])
        self.assertEqual(facts['b']['localOriginalStatus'], 'not_present')
        self.assertEqual(facts['b']['originalStatus'], 'unverified')
        self.assertNotIn('original', facts['b'])
        self.assertNotIn('privacy', facts['a'])

    def test_original_selection_refuses_stale_version_hidden_source_and_path_escape(self):
        root, snapshot = self.originals_fixture()
        with self.assertRaisesRegex(ValueError, 'outside visible'):
            census.local_original_facts(self.path, snapshot, ['hidden'], root)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE ZASSET SET ZMODIFICATIONDATE=202 WHERE ZUUID='a'")
        with self.assertRaisesRegex(ValueError, 'version changed'):
            census.local_original_facts(self.path, snapshot, ['a'], root)
        snapshot = census.metadata_snapshot(self.path)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE ZASSET SET ZDIRECTORY='..' WHERE ZUUID='a'")
        with self.assertRaisesRegex(ValueError, 'source path'):
            census.local_original_facts(self.path, snapshot, ['a'], root)

    def test_source_withdrawn_during_byte_read_is_not_certified(self):
        root, snapshot = self.originals_fixture()
        real_sha = census.hashlib.sha256
        class ChangingHash:
            def __init__(self): self.inner = real_sha()
            def update(self, chunk):
                self.inner.update(chunk)
                with sqlite3.connect(self_path) as db:
                    db.execute("UPDATE ZASSET SET ZHIDDEN=1 WHERE ZUUID='a'")
            def hexdigest(self): return self.inner.hexdigest()
        self_path = self.path
        with patch.object(census.hashlib, 'sha256', ChangingHash):
            with self.assertRaisesRegex(ValueError, 'withdrawn'):
                census.local_original_facts(self.path, snapshot, ['a'], root)

    def test_same_version_changed_bytes_and_symlink_refuse(self):
        root, snapshot = self.originals_fixture()
        snapshot['sourceFacts'] = census.local_original_facts(self.path, snapshot, ['a'], root)
        file = root / 'A/a.jpg'
        file.write_bytes(b'\xff\xd8\xffdifferent fixture')
        with self.assertRaisesRegex(ValueError, 'same source version'):
            census.local_original_facts(self.path, snapshot, ['a'], root)
        file.unlink()
        file.symlink_to(root / 'A/another.jpg')
        with self.assertRaisesRegex(ValueError, 'redirects'):
            census.local_original_facts(self.path, snapshot, ['a'], root)

    def test_missing_original_preserves_last_byte_identity_across_resume(self):
        root, snapshot = self.originals_fixture()
        file = root / 'A/a.jpg'
        original = file.read_bytes()
        snapshot['sourceFacts'] = census.local_original_facts(self.path, snapshot, ['a'], root)
        checksum = snapshot['sourceFacts']['a']['original']['sha256']
        file.unlink()
        for _ in range(2):
            snapshot['sourceFacts'].update(census.local_original_facts(self.path, snapshot, ['a'], root))
            missing = snapshot['sourceFacts']['a']
            self.assertEqual(missing['originalStatus'], 'unverified')
            self.assertNotIn('original', missing)
            self.assertEqual(missing['lastVerifiedOriginal']['sha256'], checksum)
        file.write_bytes(b'\xff\xd8\xffdifferent original after local eviction')
        with self.assertRaisesRegex(ValueError, 'same source version'):
            census.local_original_facts(self.path, snapshot, ['a'], root)
        file.write_bytes(original)
        restored = census.local_original_facts(self.path, snapshot, ['a'], root)
        self.assertEqual(restored['a']['original']['sha256'], checksum)
        self.assertEqual(restored['a']['localOriginalStatus'], 'verified')

    def test_parent_directory_redirect_is_rejected(self):
        root, snapshot = self.originals_fixture()
        (root / 'A').rename(root / 'B')
        (root / 'A').symlink_to(root / 'B', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'redirects'):
            census.local_original_facts(self.path, snapshot, ['a'], root)

    def test_parent_directory_redirect_during_read_is_rejected(self):
        root, snapshot = self.originals_fixture()
        real_sha = census.hashlib.sha256
        class RedirectingHash:
            def __init__(self): self.inner = real_sha()
            def update(self, chunk):
                self.inner.update(chunk)
                (root / 'A').rename(root / 'B')
                (root / 'A').symlink_to(root / 'B', target_is_directory=True)
            def hexdigest(self): return self.inner.hexdigest()
        with patch.object(census.hashlib, 'sha256', RedirectingHash):
            with self.assertRaisesRegex(ValueError, 'directory changed or redirects'):
                census.local_original_facts(self.path, snapshot, ['a'], root)

    def test_special_file_and_oversize_original_refuse_before_reading(self):
        root, snapshot = self.originals_fixture()
        file = root / 'A/a.jpg'
        file.unlink()
        os.mkfifo(file)
        with self.assertRaisesRegex(ValueError, 'regular-file byte bound'):
            census.local_original_facts(self.path, snapshot, ['a'], root)
        file.unlink()
        with file.open('wb') as stream:
            stream.truncate(65 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, 'regular-file byte bound'):
            census.local_original_facts(self.path, snapshot, ['a'], root)


if __name__ == '__main__':
    unittest.main()

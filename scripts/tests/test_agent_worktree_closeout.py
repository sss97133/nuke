"""Offline preservation/recovery tests; source fixtures never touch the user's repository."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'agent-worktree-closeout.py'
spec = importlib.util.spec_from_file_location('closeout', SCRIPT)
closeout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(closeout)


class Preservation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.git(self.repo, 'init', '--quiet')
        self.git(self.repo, 'config', 'user.name', 'Fixture')
        self.git(self.repo, 'config', 'user.email', 'fixture@localhost')
        self.git(self.repo, 'config', 'commit.gpgsign', 'false')
        (self.repo / '.gitignore').write_text('private.env\nlocal/\nnode_modules/\n__pycache__/\n')
        (self.repo / 'code.txt').write_text('original\n')
        (self.repo / 'deleted.txt').write_text('keep deletion state\n')
        (self.repo / 'rename.txt').write_text('rename source\n')
        (self.repo / 'binary.dat').write_bytes(b'\0original\xff')
        self.git(self.repo, 'add', '--all')
        self.git(self.repo, 'commit', '--quiet', '-m', 'Fixture base')
        self.base_head = self.git(self.repo, 'rev-parse', 'HEAD').decode().strip()
        self.git(self.repo, 'update-ref', 'refs/remotes/origin/main', self.base_head)
        self.work = self.base / '.worktrees' / 'unfinished'
        self.git(self.repo, 'worktree', 'add', '--quiet', '-b', 'unfinished', str(self.work))
        (self.work / 'branch.txt').write_text('committed branch work\n')
        self.git(self.work, 'add', 'branch.txt')
        self.git(self.work, 'commit', '--quiet', '-m', 'Unpublished branch commit')
        (self.work / 'code.txt').write_text('staged\n')
        self.git(self.work, 'add', 'code.txt')
        (self.work / 'code.txt').write_text('working\r\nexact bytes\n')
        (self.work / 'deleted.txt').unlink()
        self.git(self.work, 'mv', 'rename.txt', 'renamed.txt')
        (self.work / 'binary.dat').write_bytes(b'\0changed\xff\0')
        self.special = 'new $(never-execute) \' file.txt'
        (self.work / self.special).write_text('untracked source\n')
        (self.work / 'private.env').write_text('private local setting\n')
        (self.work / 'private.env').chmod(0o600)
        (self.work / 'local').mkdir(mode=0o750)
        (self.work / 'local/evidence.json').write_text('{"original_evidence":true}\n')
        (self.work / 'local/link').symlink_to(self.base / 'external-target')
        (self.work / 'node_modules').mkdir()
        (self.work / 'node_modules/generated').write_text('reinstallable')
        self.record = self.base / 'archive' / 'unfinished'

    def git(self, repo, *args, data=None):
        return closeout.git(repo, *args, data=data)

    def snapshot(self):
        return closeout.snapshot(self.repo, self.work, self.record)

    def test_snapshot_keeps_original_checkout_and_index_unchanged(self):
        status = closeout.changes(self.work)[0]
        index = Path(self.git(self.work, 'rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
        raw_index = index.read_bytes()
        value = self.snapshot()
        self.assertEqual(closeout.changes(self.work)[0], status)
        self.assertEqual(index.read_bytes(), raw_index)
        self.assertEqual(base64.b64decode(value['status_b64']), status)
        result = subprocess.run(['git', '-C', str(self.repo), 'cat-file', '-e', value['working_commit']], capture_output=True)
        self.assertNotEqual(result.returncode, 0, 'Private snapshot objects must not be installed into public repository refs/objects')

    def test_restore_recovers_branch_unstaged_staged_rename_binary_and_local_files(self):
        self.snapshot()
        value = closeout.verify(self.record)
        self.assertTrue(value['verified'])
        destination = self.base / '.worktrees' / 'restored'
        closeout.restore(self.repo, self.record, destination)
        self.assertEqual(closeout.changes(destination)[0], closeout.changes(self.work)[0])
        self.assertEqual((destination / 'code.txt').read_bytes(), (self.work / 'code.txt').read_bytes())
        self.assertEqual(self.git(destination, 'show', ':code.txt'), b'staged\n')
        self.assertFalse((destination / 'deleted.txt').exists())
        self.assertTrue((destination / 'renamed.txt').exists())
        self.assertEqual((destination / 'binary.dat').read_bytes(), b'\0changed\xff\0')
        self.assertEqual((destination / self.special).read_text(), 'untracked source\n')
        self.assertEqual((destination / 'private.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual((destination / 'local').stat().st_mode & 0o777, 0o750)
        self.assertEqual(os.readlink(destination / 'local/link'), str(self.base / 'external-target'))
        self.assertFalse((destination / 'node_modules').exists())

    def test_verified_unfinished_checkout_can_be_retired_and_recovered(self):
        original = closeout.changes(self.work)[0]
        value = self.snapshot()
        closeout.verify(self.record)
        with patch.object(closeout, 'references', return_value=[]):
            result = closeout.retire(self.record, [])
        self.assertTrue(result['retired'])
        self.assertFalse(self.work.exists())
        self.assertEqual(self.git(self.repo, 'rev-parse', 'refs/heads/unfinished').decode().strip(), value['head'])
        closeout.restore(self.repo, self.record, self.work)
        self.assertEqual(closeout.changes(self.work)[0], original)

    def test_restore_refuses_existing_destination(self):
        self.snapshot()
        with self.assertRaisesRegex(ValueError, 'destination exists'):
            closeout.restore(self.repo, self.record, self.work)

    def test_archive_must_live_outside_primary_and_source_checkout(self):
        for destination in [self.repo / 'private-archive', self.work / 'private-archive']:
            with self.subTest(destination=destination):
                with self.assertRaises(ValueError):
                    closeout.snapshot(self.repo, self.work, destination)
                self.assertFalse(destination.exists())

    def test_snapshot_does_not_overwrite_an_existing_record(self):
        self.snapshot()
        original = (self.record / 'record.json').read_bytes()
        with self.assertRaises(ValueError):
            self.snapshot()
        self.assertEqual((self.record / 'record.json').read_bytes(), original)

    def test_linked_repo_argument_does_not_allow_archive_inside_primary(self):
        destination = self.repo / 'private-archive'
        with self.assertRaises(ValueError):
            closeout.snapshot(self.work, self.work, destination)
        self.assertFalse(destination.exists())

    def test_archive_cannot_live_inside_a_sibling_linked_checkout(self):
        sibling = self.base / '.worktrees/sibling'
        self.git(self.repo, 'worktree', 'add', '--quiet', '-b', 'sibling', str(sibling))
        destination = sibling / 'private-archive'
        with self.assertRaises(ValueError):
            closeout.snapshot(self.work, self.work, destination)
        self.assertFalse(destination.exists())

    def test_private_file_keeps_restrictive_parent_containing_tracked_source(self):
        parent = self.work / 'restricted'
        parent.mkdir(mode=0o700)
        (parent / 'source.txt').write_text('tracked source')
        self.git(self.work, 'add', 'restricted/source.txt')
        self.git(self.work, 'commit', '--quiet', '-m', 'Source in private directory')
        self.git(self.work, 'config', 'core.sharedRepository', 'false')
        with (self.repo / '.git/info/exclude').open('a') as stream:
            stream.write('/restricted/private.env\n')
        (parent / 'private.env').write_text('private evidence')
        (parent / 'private.env').chmod(0o644)
        self.snapshot()
        closeout.verify(self.record)
        target = self.base / '.worktrees/restored'
        closeout.restore(self.repo, self.record, target)
        self.assertEqual((target / 'restricted').stat().st_mode & 0o777, 0o700)
        self.assertEqual((target / 'restricted/private.env').stat().st_mode & 0o777, 0o644)

    def test_resolved_uncommitted_merge_is_refused_before_snapshot(self):
        self.git(self.repo, 'checkout', '--quiet', '-b', 'merge-peer', self.base_head)
        (self.repo / 'merge-peer.txt').write_text('peer source')
        self.git(self.repo, 'add', 'merge-peer.txt')
        self.git(self.repo, 'commit', '--quiet', '-m', 'Peer change')
        # Clear setup edits only in this disposable fixture before starting its merge.
        self.git(self.work, 'reset', '--hard', 'HEAD')
        self.git(self.work, 'merge', '--no-ff', '--no-commit', 'merge-peer')
        self.assertFalse(self.git(self.work, 'ls-files', '--unmerged'))
        with self.assertRaisesRegex(ValueError, 'In-progress Git operation'):
            self.snapshot()
        self.assertTrue(self.work.exists())

    def test_deleted_tracked_directory_keeps_its_empty_parent_and_mode(self):
        parent = self.work / 'private-parent'
        parent.mkdir(mode=0o700)
        (parent / 'source.txt').write_text('previous source')
        self.git(self.work, 'add', 'private-parent/source.txt')
        self.git(self.work, 'commit', '--quiet', '-m', 'Directory source')
        (parent / 'source.txt').unlink()
        self.snapshot()
        closeout.verify(self.record)
        target = self.base / '.worktrees/restored'
        closeout.restore(self.repo, self.record, target)
        self.assertTrue((target / 'private-parent').is_dir())
        self.assertFalse((target / 'private-parent/source.txt').exists())
        self.assertEqual((target / 'private-parent').stat().st_mode & 0o777, 0o700)

    def test_new_operation_after_snapshot_blocks_retirement(self):
        value = self.snapshot()
        closeout.verify(self.record)
        merge_head = Path(self.git(self.work, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD').decode().strip())
        merge_head.write_text(value['head'] + '\n')
        with patch.object(closeout, 'references', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'In-progress Git operation'):
                closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())

    def test_sparse_checkout_patterns_and_settings_survive_recovery(self):
        self.git(self.work, 'reset', '--hard', 'HEAD')
        self.git(self.work, 'sparse-checkout', 'set', '--no-cone', 'code.txt')
        patterns = self.git(self.work, 'sparse-checkout', 'list')
        self.snapshot()
        closeout.verify(self.record)
        with patch.object(closeout, 'references', return_value=[]):
            closeout.retire(self.record, [])
        closeout.restore(self.repo, self.record, self.work)
        self.assertEqual(self.git(self.work, 'sparse-checkout', 'list'), patterns)
        self.assertEqual(self.git(self.work, 'config', '--worktree', '--get', 'core.sparseCheckout').strip(), b'true')

    def test_unhandled_worktree_configuration_is_refused(self):
        self.git(self.repo, 'config', 'extensions.worktreeConfig', 'true')
        self.git(self.work, 'config', '--worktree', 'core.fsmonitor', 'false')
        with self.assertRaisesRegex(ValueError, 'per-worktree configuration'):
            self.snapshot()

    def test_native_agent_hook_binding_is_preserved_without_running_it(self):
        self.git(self.repo, 'config', 'extensions.worktreeConfig', 'true')
        self.git(self.work, 'config', '--worktree', 'core.longpaths', 'true')
        hooks = self.base / 'archived-hooks'
        hooks.mkdir()
        marker = self.base / 'archived-hook-ran'
        hook = hooks / 'post-checkout'
        hook.write_text('#!/bin/sh\ntouch "' + str(marker) + '"\n')
        hook.chmod(0o755)
        self.git(self.work, 'config', '--worktree', 'core.hooksPath', str(hooks))
        value = self.snapshot()
        closeout.verify(self.record)
        target = self.base / '.worktrees/restored'
        closeout.restore(self.repo, self.record, target)
        self.assertEqual(closeout.worktree_state(target), value['worktree_state'])
        self.assertFalse(marker.exists())

    def test_git_clean_normalized_crlf_file_is_not_silently_certified(self):
        (self.work / '.gitattributes').write_text('normalized.txt text\n')
        (self.work / 'normalized.txt').write_bytes(b'first\nsecond\n')
        self.git(self.work, 'add', '.gitattributes', 'normalized.txt')
        self.git(self.work, 'commit', '--quiet', '-m', 'Normalized text fixture')
        (self.work / 'normalized.txt').write_bytes(b'first\r\nsecond\r\n')
        self.git(self.work, 'add', 'normalized.txt')
        self.assertNotIn(b'normalized.txt', closeout.changes(self.work)[0])
        with self.assertRaisesRegex(ValueError, 'normalization'):
            self.snapshot()

    def test_normalizing_repository_configuration_is_refused(self):
        self.git(self.repo, 'config', 'core.autocrlf', 'input')
        with self.assertRaisesRegex(ValueError, 'normalization'):
            self.snapshot()

    def test_ignored_staged_removal_symlink_in_both_inventories_recovers(self):
        (self.work / 'private.env').unlink()
        (self.work / 'private.env').symlink_to(self.base / 'private-target')
        self.git(self.work, 'add', '--force', 'private.env')
        self.git(self.work, 'commit', '--quiet', '-m', 'Tracked private link fixture')
        self.git(self.work, 'rm', '--cached', 'private.env')
        value = self.snapshot()
        self.assertTrue(any(p['path'] == 'private.env' for p in value['working_files']))
        self.assertTrue(any(p['path'] == 'private.env' for p in value['local_files']))
        closeout.verify(self.record)

    def test_intent_to_add_survives_independent_recovery(self):
        (self.work / 'planned.txt').write_text('planned source')
        self.git(self.work, 'add', '-N', 'planned.txt')
        self.snapshot()
        closeout.verify(self.record)
        target = self.base / '.worktrees/restored'
        closeout.restore(self.repo, self.record, target)
        self.assertEqual(closeout.intent_to_add(target), ['planned.txt'])
        self.assertEqual(closeout.changes(target)[0], closeout.changes(self.work)[0])

    def test_tampered_bundle_or_local_archive_is_rejected(self):
        self.snapshot()
        for name in ['source.bundle', 'local.tar.gz']:
            p = self.record / name
            old = p.read_bytes()
            p.write_bytes(old + b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                closeout.verify(self.record)
            p.write_bytes(old)

    def test_unverified_record_cannot_authorize_retirement(self):
        self.snapshot()
        with self.assertRaisesRegex(ValueError, 'restore verification'):
            closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())

    def test_primary_checkout_cannot_be_retired(self):
        record = self.base / 'archive' / 'primary'
        closeout.snapshot(self.repo, self.repo, record)
        closeout.verify(record)
        with self.assertRaisesRegex(ValueError, 'never the primary'):
            closeout.retire(record, [])
        self.assertTrue(self.repo.exists())

    def test_primary_code_checkpoint_does_not_duplicate_local_data(self):
        record = self.base / 'archive' / 'primary'
        (self.repo / 'private.env').write_text('local primary data stays here')
        with patch.object(closeout, 'ignored_records', side_effect=AssertionError('Do not scan or copy primary local data')):
            value = closeout.snapshot(self.repo, self.repo, record)
        self.assertEqual(value['local_files'], [])
        self.assertEqual(value['local_data_policy'], 'retained_in_primary_checkout')
        self.assertEqual((self.repo / 'private.env').read_text(), 'local primary data stays here')

    def test_ignored_hard_links_are_restorable(self):
        (self.work / 'local/original').write_text('shared inode')
        os.link(self.work / 'local/original', self.work / 'local/second')
        self.snapshot()
        closeout.verify(self.record)
        destination = self.base / '.worktrees' / 'restored'
        closeout.restore(self.repo, self.record, destination)
        self.assertEqual((destination / 'local/original').stat().st_ino, (destination / 'local/second').stat().st_ino)

    def test_snapshot_refuses_a_workspace_alias(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.work, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'not an alias'):
            closeout.snapshot(self.repo, alias, self.record)

    def test_native_agent_worktree_location_is_supported(self):
        native = self.repo / '.claude/worktrees/native-agent'
        self.git(self.repo, 'worktree', 'add', '--quiet', '-b', 'native-agent', str(native))
        (native / 'code.txt').write_text('native agent edit')
        record = self.base / 'archive' / 'native-agent'
        closeout.snapshot(self.repo, native, record)
        closeout.verify(record)
        with patch.object(closeout, 'references', return_value=[]):
            closeout.retire(record, [])
        self.assertFalse(native.exists())
        closeout.restore(self.repo, record, native)
        self.assertEqual((native / 'code.txt').read_text(), 'native agent edit')

    def test_detached_unpublished_source_is_recoverable_without_its_branch(self):
        self.git(self.work, 'checkout', '--quiet', '--detach')
        value = self.snapshot()
        self.assertIsNone(value['branch'])
        closeout.verify(self.record)
        with patch.object(closeout, 'references', return_value=[]):
            closeout.retire(self.record, [])
        self.git(self.repo, 'update-ref', '-d', 'refs/heads/unfinished')
        # This garbage collection runs only inside the disposable fixture.
        self.git(self.repo, 'reflog', 'expire', '--expire=now', '--all')
        self.git(self.repo, 'gc', '--prune=now')
        closeout.verify(self.record)
        closeout.restore(self.repo, self.record, self.work)
        self.assertEqual((self.work / 'branch.txt').read_text(), 'committed branch work\n')
        self.assertEqual((self.work / self.special).read_text(), 'untracked source\n')

    def test_repository_local_ignored_symlink_policy_is_preserved(self):
        (self.repo / '.git/info/exclude').write_text('/private-link\n')
        (self.work / 'private-link').symlink_to(self.base / 'external-target')
        self.assertNotIn(b'private-link', closeout.changes(self.work)[0])
        self.snapshot()
        closeout.verify(self.record)
        self.assertEqual((self.record / 'git-info-exclude').read_text(), '/private-link\n')
        self.assertEqual((self.repo / '.git/info/exclude').read_text(), '/private-link\n')

    def test_recovery_does_not_execute_checkout_hooks(self):
        self.snapshot()
        marker = self.base / 'hook-ran'
        hook = self.repo / '.git/hooks/post-checkout'
        hook.write_text('#!/bin/sh\ntouch "' + str(marker) + '"\n')
        hook.chmod(0o755)
        closeout.restore(self.repo, self.record, self.base / '.worktrees/restored')
        self.assertFalse(marker.exists())

    def test_hidden_edits_are_not_treated_as_clean_committed_content(self):
        self.git(self.work, 'update-index', '--assume-unchanged', 'branch.txt')
        (self.work / 'branch.txt').write_text('hidden unique edit')
        self.assertNotIn(b'branch.txt', closeout.changes(self.work)[0])
        self.snapshot()
        closeout.verify(self.record)
        target = self.base / '.worktrees' / 'restored'
        closeout.restore(self.repo, self.record, target)
        self.assertEqual((target / 'branch.txt').read_text(), 'hidden unique edit')
        self.assertIn('branch.txt', closeout.index_flags(target)['assume_unchanged'])
        self.assertEqual((self.work / 'branch.txt').read_text(), 'hidden unique edit')

    def test_sparse_missing_files_and_flags_are_preserved(self):
        self.git(self.work, 'update-index', '--skip-worktree', 'branch.txt')
        (self.work / 'branch.txt').unlink()
        self.assertNotIn(b'branch.txt', closeout.changes(self.work)[0])
        self.snapshot()
        closeout.verify(self.record)
        target = self.base / '.worktrees' / 'restored'
        closeout.restore(self.repo, self.record, target)
        self.assertFalse((target / 'branch.txt').exists())
        self.assertIn('branch.txt', closeout.index_flags(target)['skip_worktree'])

    def test_changed_working_file_blocks_removal(self):
        self.snapshot()
        closeout.verify(self.record)
        (self.work / 'code.txt').write_text('new unpreserved edit')
        with patch.object(closeout, 'references', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                closeout.retire(self.record, [])
        self.assertEqual((self.work / 'code.txt').read_text(), 'new unpreserved edit')

    def test_changed_staging_with_same_status_and_working_bytes_blocks_removal(self):
        self.snapshot()
        closeout.verify(self.record)
        before = closeout.changes(self.work)[0]
        oid = self.git(self.work, 'hash-object', '-w', '--stdin', data=b'different staged bytes\n').strip()
        self.git(self.work, 'update-index', '--cacheinfo', '100644', oid.decode(), 'code.txt')
        self.assertEqual(closeout.changes(self.work)[0], before)
        with patch.object(closeout, 'references', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'Staging state changed'):
                closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())

    def test_reference_blocks_retirement(self):
        self.snapshot()
        closeout.verify(self.record)
        with patch.object(closeout, 'references', return_value=['active task']):
            with self.assertRaisesRegex(ValueError, 'Referenced checkout'):
                closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())

    def test_new_reference_after_atomic_move_rolls_back(self):
        self.snapshot()
        closeout.verify(self.record)
        with patch.object(closeout, 'references', side_effect=[[], ['new open file']]):
            with self.assertRaisesRegex(ValueError, 'acquired a reference'):
                closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())
        self.assertFalse((self.record / '.retiring').exists())

    def test_late_edit_after_atomic_move_is_kept_and_rolled_back(self):
        self.snapshot()
        closeout.verify(self.record)
        def references(path, protected):
            if Path(path).name == '.retiring':
                (Path(path) / 'code.txt').write_text('late writer')
            return []
        with patch.object(closeout, 'references', side_effect=references):
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                closeout.retire(self.record, [])
        self.assertEqual((self.work / 'code.txt').read_text(), 'late writer')

    def test_explicit_protection_does_not_require_process_inspection(self):
        self.assertEqual(closeout.references(self.work, [str(self.work)]), ['explicitly protected task'])

    def test_protected_descendant_keeps_the_whole_checkout(self):
        self.assertEqual(closeout.references(self.work, [str(self.work / 'code.txt')]),
                         ['explicitly protected task'])

    def test_interrupted_quarantine_is_recovered_before_registry_validation(self):
        self.snapshot()
        value = closeout.verify(self.record)
        quarantine = self.record / '.retiring'
        value['retirement_pending'] = {'original': value['workspace'], 'preserved_path': str(quarantine.resolve())}
        closeout.write_json(self.record / 'record.json', value)
        self.git(self.repo, 'worktree', 'move', str(self.work), str(quarantine))
        with patch.object(closeout, 'references', return_value=['active task']):
            with self.assertRaisesRegex(ValueError, 'Referenced checkout'):
                closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())
        self.assertFalse(quarantine.exists())
        self.assertNotIn('retirement_pending', closeout.read_json(self.record / 'record.json'))

    def test_changed_ignored_evidence_blocks_retirement(self):
        self.snapshot()
        closeout.verify(self.record)
        (self.work / 'local/evidence.json').write_text('new evidence')
        with patch.object(closeout, 'references', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                closeout.retire(self.record, [])
        self.assertTrue(self.work.exists())

    def test_unsafe_or_symlink_parent_path_is_rejected(self):
        (self.work / 'outside').symlink_to(self.base, target_is_directory=True)
        for path in ['../outside', '/absolute', '.git/config', 'outside/secret']:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    closeout.local_path(self.work, path)

    def test_conflict_stages_are_not_silently_flattened(self):
        oid = self.git(self.work, 'hash-object', '-w', '--stdin', data=b'conflict').strip()
        self.git(self.work, 'update-index', '--force-remove', 'code.txt')
        line = b'100644 ' + oid + b' 1\tcode.txt\0'
        self.git(self.work, 'update-index', '-z', '--index-info', data=line)
        with self.assertRaisesRegex(ValueError, 'Unmerged index'):
            self.snapshot()
        self.assertTrue(self.work.exists())

    def test_filter_payload_is_not_mistaken_for_archived_file_bytes(self):
        (self.work / '.gitattributes').write_text('code.txt filter=missing-reader\n')
        with self.assertRaisesRegex(ValueError, 'Git filter payload'):
            self.snapshot()

    def test_fresh_cli_snapshot_and_verify(self):
        args = [sys.executable, str(SCRIPT), 'snapshot', '--repo', str(self.repo),
                '--workspace', str(self.work), '--record', str(self.record)]
        result = subprocess.run(args, cwd=self.base, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([sys.executable, str(SCRIPT), 'verify', '--record', str(self.record)],
                                cwd=self.base, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['verified'])


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Regression checks for the manual-knowledge writer's read-only boundary."""
import contextlib
import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


# The tests never connect. Stub only the optional database driver's import.
psycopg2 = types.ModuleType('psycopg2')
psycopg2.OperationalError = Exception
extras = types.ModuleType('psycopg2.extras')
extras.RealDictCursor = object
psycopg2.extras = extras
with mock.patch.dict(sys.modules, {'psycopg2': psycopg2, 'psycopg2.extras': extras}):
    spec = importlib.util.spec_from_file_location('extract_condition_knowledge',
        Path(__file__).with_name('extract-condition-knowledge.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class FakeCursor:
    def __init__(self, statements):
        self.statements = statements

    def execute(self, sql, params=None):
        if not sql.lstrip().upper().startswith('SELECT'):
            raise AssertionError('Dry-run attempted a non-SELECT statement')
        self.statements.append((sql, params))

    def fetchall(self):
        return []

    def close(self):
        pass


class FakeConnection:
    def __init__(self):
        self.statements = []
        self.session = None
        self.closed = False

    def set_session(self, **kwargs):
        self.session = kwargs

    def cursor(self, **kwargs):
        return FakeCursor(self.statements)

    def commit(self):
        raise AssertionError('Dry-run attempted to commit')

    def close(self):
        self.closed = True


class ConditionKnowledgeSafetyTest(unittest.TestCase):
    def test_default_execution_refuses_before_connection(self):
        with mock.patch.object(sys, 'argv', ['extract-condition-knowledge.py']), \
             mock.patch.object(module, 'get_connection') as connect, \
             contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                module.main()
        self.assertNotEqual(error.exception.code, 0)
        connect.assert_not_called()

    def test_dry_run_reads_without_delete_or_commit(self):
        connection = FakeConnection()
        with mock.patch.object(sys, 'argv', ['extract-condition-knowledge.py', '--dry-run', '--limit', '3', '--doc-id', 'example']), \
             mock.patch.object(module, 'get_connection', return_value=connection), \
             mock.patch.object(module.os, 'chdir'), \
             mock.patch.dict(module.os.environ, {}, clear=True), \
             contextlib.redirect_stdout(io.StringIO()):
            module.main()
        self.assertEqual(connection.session, {'readonly': True, 'autocommit': False})
        self.assertEqual(len(connection.statements), 1)
        self.assertEqual(connection.statements[0][1], ['example'])
        self.assertTrue(connection.closed)

    def test_direct_legacy_writer_refuses_before_opening_a_cursor(self):
        connection = mock.Mock()
        with self.assertRaisesRegex(RuntimeError, 'source-qualified'):
            module.write_entries(connection, [{'component': 'body_mount'}])
        connection.cursor.assert_not_called()
        connection.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()

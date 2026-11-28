#!/usr/bin/env python3
"""Protect retained manual identities and chunks until a safe writer exists."""
import contextlib
import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

psycopg2 = types.ModuleType('psycopg2')
psycopg2.OperationalError = Exception
extras = types.ModuleType('psycopg2.extras')
extras.RealDictCursor = object
psycopg2.extras = extras
with mock.patch.dict(sys.modules, {'psycopg2':psycopg2,'psycopg2.extras':extras,'PyPDF2':types.ModuleType('PyPDF2')}):
    spec = importlib.util.spec_from_file_location('ingest_service_manual', Path(__file__).with_name('ingest-service-manual.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class Cursor:
    def __init__(self): self.statements = []
    def execute(self, sql, params=None):
        if not sql.lstrip().upper().startswith('SELECT'):
            raise AssertionError('List attempted a write')
        self.statements.append((sql,params))
    def fetchall(self): return []
    def close(self): pass


class Connection:
    def __init__(self): self.session=None; self.cur=Cursor(); self.closed=False
    def set_session(self, **kwargs): self.session=kwargs
    def cursor(self, **kwargs): return self.cur
    def commit(self): raise AssertionError('List attempted a commit')
    def close(self): self.closed=True


class ManualSafetyTest(unittest.TestCase):
    def test_ingestion_refused_before_database_or_pdf_access(self):
        for argv in (['ingest-service-manual.py'], ['ingest-service-manual.py','example.pdf','--title','same title']):
            with mock.patch.object(sys,'argv',argv), mock.patch.object(module,'get_connection') as connect, \
                 mock.patch.object(module,'parse_pdf') as parse, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result: module.main()
            self.assertNotEqual(result.exception.code,0)
            connect.assert_not_called()
            parse.assert_not_called()

    def test_list_uses_read_only_transaction(self):
        conn=Connection()
        with mock.patch.object(sys,'argv',['ingest-service-manual.py','--list']), \
             mock.patch.object(module,'get_connection',return_value=conn), \
             mock.patch.object(module.os,'chdir'), contextlib.redirect_stdout(io.StringIO()):
            module.main()
        self.assertEqual(conn.session,{'readonly':True,'autocommit':False})
        self.assertEqual(len(conn.cur.statements),1)
        self.assertTrue(conn.closed)

    def test_direct_legacy_writers_refuse_before_cursor(self):
        conn=mock.Mock()
        with self.assertRaisesRegex(RuntimeError,'source-qualified'):
            module.register_document(conn,'example.pdf','Example')
        with self.assertRaisesRegex(RuntimeError,'restart-safe'):
            module.ingest_chunks(conn,'example',[])
        conn.cursor.assert_not_called()
        conn.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()

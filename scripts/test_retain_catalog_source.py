#!/usr/bin/env python3
"""Tests for source-byte verification before the service-only catalog intake."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location('retain_catalog_source', Path(__file__).with_name('retain-catalog-source.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceClientTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pdf = self.root/'source.pdf'
        self.pdf_bytes = b'%PDF-1.4\nsynthetic\n'
        self.pdf.write_bytes(self.pdf_bytes)
        self.manifest = self.root/'manifest.json'
        self.manifest.write_text(json.dumps({'catalog_id':'00000000-0000-4000-8000-000000000002',
            'object_id':'00000000-0000-4000-8000-000000000001','object_version':'v1',
            'object_name':'test catalog/a.pdf','local_pdf':str(self.pdf),
            'expected_pdf_sha256':hashlib.sha256(self.pdf_bytes).hexdigest(),
            'chunk_count':2,'reader_actor':'agent:test','reader_run_id':'test'}))
        self.requests = []
        self.remote_bytes = self.pdf_bytes
        self.mutate_after_extract = False

    def tearDown(self):
        self.temp.cleanup()

    def fake_urlopen(self, request, timeout):
        self.requests.append(request)
        if request.get_method() == 'GET':
            return io.BytesIO(self.remote_bytes)
        return io.BytesIO(json.dumps({'success':True,'source_pages_only':True,'page_count':1,
            'pdf_hash_status':'client_attested_not_server_rehashed'}).encode())

    def fake_run(self, args, **kwargs):
        if args[0] == 'pdfinfo':
            return types.SimpleNamespace(stdout='Pages: 1\n')
        if self.mutate_after_extract:
            self.pdf.write_bytes(b'%PDF-changed')
        return types.SimpleNamespace(stdout=b'source text\x0c')

    def run_client(self, execute=False):
        output = io.StringIO()
        with mock.patch.object(sys, 'argv', ['retain-catalog-source.py', str(self.manifest)] + (['--execute'] if execute else [])), \
             mock.patch.dict(os.environ, {'VITE_SUPABASE_URL':'https://sample.supabase.co',
                                         'SUPABASE_SERVICE_ROLE_KEY':'sb_secret_test'}, clear=True), \
             mock.patch.object(module, 'urlopen', side_effect=self.fake_urlopen), \
             mock.patch.object(module, 'open_service_request', side_effect=lambda req:self.fake_urlopen(req,60)), \
             mock.patch.object(module.subprocess, 'run', side_effect=self.fake_run), \
             contextlib.redirect_stdout(output):
            module.main()
        return json.loads(output.getvalue())

    def test_default_verifies_without_sending_credentials_or_writing(self):
        result = self.run_client()
        self.assertEqual(result['status'], 'verified_no_write')
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0].get_method(), 'GET')
        self.assertNotIn('Authorization', self.requests[0].headers)
        self.assertNotIn('Apikey', self.requests[0].headers)

    def test_execute_sends_only_after_matching_both_sources(self):
        result = self.run_client(execute=True)
        self.assertTrue(result['source_pages_only'])
        self.assertEqual([r.get_method() for r in self.requests], ['GET','POST'])
        self.assertEqual(self.requests[1].full_url, 'https://sample.supabase.co/functions/v1/index-reference-document')
        sent = json.loads(self.requests[1].data)
        self.assertEqual(sent['source']['pdf_sha256'], hashlib.sha256(self.pdf_bytes).hexdigest())
        self.assertEqual(sent['source']['text_sha256'], hashlib.sha256(b'source text\x0c').hexdigest())

    def test_changed_stored_bytes_prevent_intake(self):
        self.remote_bytes = b'%PDF-other'
        with self.assertRaisesRegex(RuntimeError, 'Stored object bytes differ'):
            self.run_client(execute=True)
        self.assertEqual([r.get_method() for r in self.requests], ['GET'])

    def test_local_file_change_during_extraction_prevents_intake(self):
        self.mutate_after_extract = True
        with self.assertRaisesRegex(RuntimeError, 'Local PDF changed'):
            self.run_client(execute=True)
        self.assertEqual([r.get_method() for r in self.requests], ['GET'])

    def test_service_credential_is_not_followed_to_a_redirect(self):
        request = module.Request('https://sample.supabase.co/functions/v1/index-reference-document',
                                 headers={'Authorization':'Bearer sb_secret_test'}, method='POST')
        self.assertIsNone(module.NoRedirect().redirect_request(request,None,302,'redirect',{},'https://other.example'))


if __name__ == '__main__':
    unittest.main()

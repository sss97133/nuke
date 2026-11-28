#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name('retain-public-catalog-pdf.py')
spec = importlib.util.spec_from_file_location('retain_public_catalog_pdf', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Response:
    def __init__(self, headers=None): self.headers = headers or {}
    def __enter__(self): return self
    def __exit__(self, *args): return False


class FakeTus:
    def __init__(self):
        self.offset = 0
        self.posts = 0
        self.patch_failures = 0
        self.patch_after_commit_failure = False
        self.url = 'https://example.storage.supabase.co/storage/v1/upload/resumable/test-upload'

    def open(self, request):
        self.assert_origin(request.full_url)
        if request.get_method() == 'POST':
            self.posts += 1
            return Response({'Location': self.url})
        if request.get_method() == 'HEAD':
            return Response({'Upload-Offset': str(self.offset)})
        if request.get_method() == 'PATCH':
            if self.patch_failures:
                self.patch_failures -= 1
                raise urllib.error.URLError('synthetic interruption')
            assert int(request.get_header('Upload-offset')) == self.offset
            self.offset += len(request.data)
            if self.patch_after_commit_failure:
                self.patch_after_commit_failure = False
                raise urllib.error.URLError('acknowledgement lost')
            return Response({'Upload-Offset': str(self.offset)})
        raise AssertionError('Unexpected request')

    def assert_origin(self, url):
        assert url.startswith('https://example.storage.supabase.co/storage/v1/upload/resumable')


class RetainPublicCatalogTests(unittest.TestCase):
    def test_tus_resumes_after_lost_acknowledgement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'test.pdf'
            source.write_bytes(b'%PDF-example-data')
            state = root / 'state.json'
            server = FakeTus()
            server.patch_after_commit_failure = True
            with mock.patch.object(module, 'open_service', side_effect=server.open), mock.patch.object(module, 'CHUNK', 4):
                module.upload_tus(source, 'https://example.storage.supabase.co', 'sb_secret_test', 'catalog-public/a.pdf',
                                  'a' * 64, source.stat().st_size, state)
            self.assertEqual(server.offset, source.stat().st_size)
            self.assertEqual(server.posts, 1)
            self.assertTrue(state.exists())
            self.assertEqual(state.stat().st_mode & 0o777, 0o600)

    def test_tus_interruption_keeps_state_for_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'test.pdf'
            source.write_bytes(b'%PDF-example-data')
            state = root / 'state.json'
            server = FakeTus()
            server.patch_failures = 2
            with mock.patch.object(module, 'open_service', side_effect=server.open), mock.patch.object(module, 'CHUNK', 4):
                with self.assertRaisesRegex(RuntimeError, 'interrupted twice'):
                    module.upload_tus(source, 'https://example.storage.supabase.co', 'sb_secret_test', 'catalog-public/a.pdf',
                                      'a' * 64, source.stat().st_size, state)
                module.upload_tus(source, 'https://example.storage.supabase.co', 'sb_secret_test', 'catalog-public/a.pdf',
                                  'a' * 64, source.stat().st_size, state)
            self.assertEqual(server.offset, source.stat().st_size)
            self.assertEqual(server.posts, 1)

    def test_untrusted_upload_location_is_refused_without_forwarding_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'test.pdf'
            source.write_bytes(b'%PDF-data')
            calls = []
            def open_redirect(request):
                calls.append(request.full_url)
                return Response({'Location': 'https://other.example/upload'})
            with mock.patch.object(module, 'open_service', side_effect=open_redirect):
                with self.assertRaisesRegex(RuntimeError, 'response URL is invalid'):
                    module.upload_tus(source, 'https://example.storage.supabase.co', 'sb_secret_test', 'catalog-public/a.pdf',
                                      'a' * 64, source.stat().st_size, root / 'state.json')
            self.assertEqual(calls, ['https://example.storage.supabase.co/storage/v1/upload/resumable'])

    def test_only_explicit_missing_object_response_permits_upload(self):
        url = 'https://example.supabase.co/storage/v1/object/info/public/reference-docs/catalog-public/a.pdf'
        missing = urllib.error.HTTPError(url, 400, 'Bad request', {}, io.BytesIO(
            b'{"statusCode":"404","error":"not_found","code":"NoSuchKey"}'))
        with mock.patch.object(module.urllib.request, 'urlopen', side_effect=missing):
            self.assertIsNone(module.public_info('https://example.supabase.co', 'catalog-public/a.pdf'))
        other = urllib.error.HTTPError(url, 400, 'Bad request', {}, io.BytesIO(
            b'{"statusCode":"400","error":"bad_request","code":"InvalidKey"}'))
        with mock.patch.object(module.urllib.request, 'urlopen', side_effect=other):
            with self.assertRaisesRegex(RuntimeError, 'Storage info refused HTTP 400'):
                module.public_info('https://example.supabase.co', 'catalog-public/a.pdf')

    def test_read_only_mode_has_no_upload_or_admission(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'test.pdf'
            source.write_bytes(b'%PDF-source')
            digest, size = module.digest_file(source)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'title': 'Catalog', 'source_url': 'https://example.com/catalog.pdf',
                'local_pdf': str(source), 'expected_pdf_sha256': digest, 'expected_pages': 2,
                'reader_actor': 'agent:test', 'reader_run_id': 'test'}))
            def run(args, **kwargs):
                return mock.Mock(stdout='Pages: 2\n' if args[0] == 'pdfinfo' else b'first\x0c\x0c')
            output = io.StringIO()
            with mock.patch('sys.argv', ['retain', str(manifest)]), \
                 mock.patch.dict('os.environ', {'VITE_SUPABASE_URL': 'https://example.supabase.co'}), \
                 mock.patch.object(module, 'digest_public', return_value=(digest, size)), \
                 mock.patch.object(module.subprocess, 'run', side_effect=run), \
                 mock.patch.object(module, 'open_service', side_effect=AssertionError('unexpected write')), \
                 contextlib.redirect_stdout(output):
                module.main()
            self.assertEqual(json.loads(output.getvalue())['status'], 'verified_no_write')

    def test_different_public_bytes_hold_before_any_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'test.pdf'
            source.write_bytes(b'%PDF-source')
            digest, size = module.digest_file(source)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'title': 'Catalog', 'source_url': 'https://example.com/catalog.pdf',
                'local_pdf': str(source), 'expected_pdf_sha256': digest, 'expected_pages': 2,
                'reader_actor': 'agent:test', 'reader_run_id': 'test'}))
            with mock.patch('sys.argv', ['retain', str(manifest), '--execute']), \
                 mock.patch.dict('os.environ', {'VITE_SUPABASE_URL': 'https://example.supabase.co'}), \
                 mock.patch.object(module, 'digest_public', return_value=('f' * 64, size)), \
                 mock.patch.object(module, 'open_service', side_effect=AssertionError('unexpected write')):
                with self.assertRaisesRegex(RuntimeError, 'public source bytes differ'):
                    module.main()


if __name__ == '__main__':
    unittest.main()

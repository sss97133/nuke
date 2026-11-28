#!/usr/bin/env python3
"""Verify an existing stored catalog and prepare its unreviewed page intake.

The JSON manifest names an existing catalog source/object/version, local PDF,
expected PDF SHA-256 and chunk count. Default mode performs no write. --execute
calls the service-only index-reference-document mode after the local and stored
PDF bytes and the local text transcript have been verified. It never uploads,
overwrites a file, runs a model, or admits a listing or vehicle claim.

Run in the project's dotenvx environment:
  dotenvx run -q -- python3 scripts/retain-catalog-source.py manifest.json
  dotenvx run -q -- python3 scripts/retain-catalog-source.py manifest.json --execute

The manifest has exactly: catalog_id, object_id, object_version, object_name,
local_pdf, expected_pdf_sha256, chunk_count, reader_actor and reader_run_id.
The object must already be public in reference-docs; this tool does not handle
private manuals or create a catalog source. The database checks source metadata
and transcript inside its admission transaction, not the PDF bytes themselves.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        require(stream.read(5) == b'%PDF-', 'Local source does not have a PDF signature')
        stream.seek(0)
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    expected = {'catalog_id', 'object_id', 'object_version', 'object_name', 'local_pdf',
                'expected_pdf_sha256', 'chunk_count', 'reader_actor', 'reader_run_id'}
    require(isinstance(manifest, dict) and set(manifest) == expected, 'Unexpected manifest fields')
    require(re.fullmatch(r'[a-f0-9]{64}', manifest['expected_pdf_sha256']) is not None, 'Invalid PDF hash')
    name = manifest['object_name']
    require(isinstance(name, str) and name and not name.startswith('/') and '\\' not in name and
            all(x not in ('', '.', '..') for x in name.split('/')), 'Invalid storage object name')
    origin = os.environ.get('VITE_SUPABASE_URL', '').rstrip('/')
    parsed = urlsplit(origin)
    require(parsed.scheme == 'https' and parsed.netloc.endswith('.supabase.co') and not parsed.username and
            not parsed.password and not parsed.path and not parsed.query and not parsed.fragment, 'Invalid configured project URL')
    local = Path(manifest['local_pdf']).expanduser()
    local_hash = sha256_file(local)
    require(local_hash == manifest['expected_pdf_sha256'], 'Local PDF hash differs from expected source')
    url = origin + '/storage/v1/object/public/reference-docs/' + quote(name, safe='/')
    digest = hashlib.sha256()
    size = 0
    with urlopen(Request(url, headers={'Accept-Encoding': 'identity'}), timeout=90) as response:
        for block in iter(lambda: response.read(1024 * 1024), b''):
            digest.update(block)
            size += len(block)
    require(digest.hexdigest() == local_hash and size == local.stat().st_size, 'Stored object bytes differ from local source')
    info = subprocess.run(['pdfinfo', str(local)], check=True, text=True, capture_output=True).stdout
    match = re.search(r'^Pages:\s+(\d+)\s*$', info, re.MULTILINE)
    require(match is not None, 'Could not read PDF page count')
    page_count = int(match.group(1))
    transcript = subprocess.run(['pdftotext', str(local), '-'], check=True, capture_output=True).stdout
    require(transcript.endswith(b'\x0c') and transcript.count(b'\x0c') == page_count, 'Text page boundaries differ from PDF')
    transcript.decode('utf-8')
    require(sha256_file(local) == local_hash, 'Local PDF changed during extraction')
    source = {'catalog_id': manifest['catalog_id'], 'object_id': manifest['object_id'],
              'object_version': manifest['object_version'], 'object_name': name,
              'pdf_sha256': local_hash, 'text_sha256': hashlib.sha256(transcript).hexdigest(),
              'page_count': page_count, 'chunk_count': manifest['chunk_count'],
              'reader_actor': manifest['reader_actor'], 'reader_method': 'client_sha256_and_pdftotext_default_replay_v1',
              'reader_run_id': manifest['reader_run_id'],
              'reader_verified_at': datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}
    if not args.execute:
        print(json.dumps({'status': 'verified_no_write', 'source': source, 'source_bytes': size,
                          'notice': 'Database validates the source version and text on admission; PDF hash is client-attested.'}))
        return
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    require(key.startswith('sb_secret_'), 'Use the configured dotenvx service environment')
    request = Request(origin + '/functions/v1/index-reference-document',
                      data=json.dumps({'mode': 'retained_catalog_text', 'source': source}).encode(),
                      headers={'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key}, method='POST')
    try:
        with urlopen(request, timeout=60) as response:
            result = json.load(response)
    except HTTPError as error:
        raise RuntimeError(f'Catalog source intake refused HTTP {error.code}') from None
    require(result.get('success') is True and result.get('source_pages_only') is True and
            result.get('page_count') == page_count and result.get('pdf_hash_status') == 'client_attested_not_server_rehashed',
            'Catalog source intake returned an unexpected receipt')
    print(json.dumps(result))


if __name__ == '__main__':
    main()

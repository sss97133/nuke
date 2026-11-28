#!/usr/bin/env python3
"""Verify and retain a public catalog PDF and its unreviewed page text.

Default mode is read-only: verify the local PDF, the current public source,
and page boundaries. --execute resumes an immutable TUS upload when needed,
rechecks stored bytes, then invokes the service-only reference-document owner.
It creates no catalog parts, fitment, vehicle, assembly, or diagram claims.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CHUNK = 6 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_service(request):
    # Service credentials must never follow a redirect to another origin.
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=120)


def digest_stream(stream):
    digest = hashlib.sha256()
    size = 0
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(block)
        size += len(block)
    return digest.hexdigest(), size


def digest_file(path):
    with path.open('rb') as stream:
        require(stream.read(5) == b'%PDF-', 'Local source is not a PDF')
        stream.seek(0)
        return digest_stream(stream)


def digest_public(url):
    # No credentials are sent to the publisher or public object download.
    request = urllib.request.Request(url, headers={'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return digest_stream(response)


def valid_upload_url(url, origin):
    parsed = urllib.parse.urlsplit(url)
    return (parsed.scheme == 'https' and parsed.netloc == urllib.parse.urlsplit(origin).netloc
            and parsed.path.startswith('/storage/v1/upload/resumable/')
            and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)


def metadata_header(values):
    return ','.join(key + ' ' + base64.b64encode(value.encode()).decode() for key, value in values.items())


def save_state(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
    os.replace(temp, path)


def tus_offset(upload_url, headers):
    request = urllib.request.Request(upload_url, method='HEAD', headers=headers)
    with open_service(request) as response:
        offset = response.headers.get('Upload-Offset', '')
    require(re.fullmatch(r'[0-9]+', offset) is not None, 'Upload offset unavailable')
    return int(offset)


def upload_tus(path, storage_origin, key, name, expected_hash, size, state_file):
    headers = {'Tus-Resumable': '1.0.0', 'Authorization': 'Bearer ' + key, 'apikey': key}
    endpoint = storage_origin + '/storage/v1/upload/resumable'
    expected = {'object_name': name, 'pdf_sha256': expected_hash, 'pdf_size': size}
    upload_url = None
    if state_file.exists():
        state = json.loads(state_file.read_text())
        require(all(state.get(k) == v for k, v in expected.items()), 'Upload state differs from source')
        upload_url = state.get('upload_url')
        require(isinstance(upload_url, str) and valid_upload_url(upload_url, storage_origin), 'Upload state URL is invalid')
        try:
            offset = tus_offset(upload_url, headers)
        except urllib.error.HTTPError as error:
            if error.code not in (404, 410):
                raise RuntimeError(f'Upload resume refused HTTP {error.code}') from None
            upload_url = None
    if upload_url is None:
        create_headers = {**headers, 'Upload-Length': str(size), 'x-upsert': 'false',
                          'Upload-Metadata': metadata_header({'bucketName': 'reference-docs',
                              'objectName': name, 'contentType': 'application/pdf', 'cacheControl': '3600'})}
        try:
            with open_service(urllib.request.Request(endpoint, data=b'', method='POST', headers=create_headers)) as response:
                location = response.headers.get('Location', '')
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Upload creation refused HTTP {error.code}') from None
        upload_url = urllib.parse.urljoin(endpoint + '/', location)
        require(valid_upload_url(upload_url, storage_origin), 'Upload response URL is invalid')
        save_state(state_file, {**expected, 'upload_url': upload_url})
        offset = tus_offset(upload_url, headers)
    require(0 <= offset <= size, 'Upload offset is outside the source')
    failures = 0
    with path.open('rb') as stream:
        while offset < size:
            stream.seek(offset)
            block = stream.read(min(CHUNK, size - offset))
            require(bool(block), 'Source ended during upload')
            request = urllib.request.Request(upload_url, data=block, method='PATCH', headers={**headers,
                'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': str(offset)})
            try:
                with open_service(request) as response:
                    returned = response.headers.get('Upload-Offset', '')
                require(returned.isdigit() and int(returned) == offset + len(block), 'Upload offset acknowledgement differs')
                offset = int(returned)
                failures = 0
            except (urllib.error.URLError, TimeoutError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code not in (409, 429, 500, 502, 503, 504):
                    raise RuntimeError(f'Upload chunk refused HTTP {error.code}') from None
                failures += 1
                if failures >= 2:
                    raise RuntimeError('Upload interrupted twice; resume from the saved state') from None
                offset = tus_offset(upload_url, headers)
                require(0 <= offset <= size, 'Upload resume offset is outside the source')
    # Retain state until object metadata and bytes have been verified by the caller.


def public_info(origin, name):
    url = origin + '/storage/v1/object/info/public/reference-docs/' + urllib.parse.quote(name, safe='/')
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            if error.code == 404:
                return None
            # Supabase's public object-info endpoint currently wraps NoSuchKey
            # in HTTP 400 while the JSON body retains a 404 status. Other 400s
            # are not evidence that the object is absent.
            if error.code == 400:
                try:
                    body = json.loads(error.read(4096))
                except (ValueError, UnicodeDecodeError):
                    body = {}
                if str(body.get('statusCode')) == '404' and body.get('code') == 'NoSuchKey':
                    return None
            raise RuntimeError(f'Storage info refused HTTP {error.code}') from None
        finally:
            error.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    expected = {'title', 'source_url', 'local_pdf', 'expected_pdf_sha256', 'expected_pages', 'reader_actor', 'reader_run_id'}
    require(isinstance(manifest, dict) and set(manifest) == expected, 'Unexpected manifest fields')
    require(re.fullmatch(r'[a-f0-9]{64}', manifest['expected_pdf_sha256']) is not None, 'Invalid expected PDF hash')
    source_url = urllib.parse.urlsplit(manifest['source_url'])
    require(source_url.scheme == 'https' and source_url.hostname and source_url.path not in ('', '/')
            and not source_url.username and not source_url.password and not source_url.query and not source_url.fragment,
            'Source URL must be a public HTTPS document URL')
    origin = os.environ.get('VITE_SUPABASE_URL', '').rstrip('/')
    parsed = urllib.parse.urlsplit(origin)
    require(parsed.scheme == 'https' and re.fullmatch(r'[a-z0-9-]+\.supabase\.co', parsed.netloc or '')
            and not parsed.path and not parsed.query and not parsed.fragment, 'Invalid configured project URL')
    storage_origin = 'https://' + parsed.netloc.removesuffix('.supabase.co') + '.storage.supabase.co'
    path = Path(manifest['local_pdf']).expanduser()
    local_hash, size = digest_file(path)
    require(local_hash == manifest['expected_pdf_sha256'], 'Local PDF differs from expected source')
    source_hash, source_size = digest_public(manifest['source_url'])
    require((source_hash, source_size) == (local_hash, size), 'Current public source bytes differ from local PDF')
    info = subprocess.run(['pdfinfo', str(path)], check=True, text=True, capture_output=True).stdout
    match = re.search(r'^Pages:\s+(\d+)\s*$', info, re.MULTILINE)
    require(match is not None and int(match.group(1)) == manifest['expected_pages'], 'PDF page count differs')
    transcript = subprocess.run(['pdftotext', str(path), '-'], check=True, capture_output=True).stdout
    require(transcript.endswith(b'\x0c') and transcript.count(b'\x0c') == manifest['expected_pages'], 'Text page boundaries differ')
    pages = [page.decode('utf-8') for page in transcript.split(b'\x0c')[:-1]]
    require(digest_file(path) == (local_hash, size), 'Local PDF changed during verification')
    text_hash = hashlib.sha256(transcript).hexdigest()
    name = f'catalog-public/{local_hash}.pdf'
    result = {'status': 'verified_no_write', 'pdf_sha256': local_hash, 'pdf_bytes': size,
              'page_count': len(pages), 'text_sha256': text_hash, 'source_url': manifest['source_url'],
              'notice': 'PDF and current public source matched locally; source text and diagrams remain unreviewed.'}
    if not args.execute:
        print(json.dumps(result))
        return
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    require(key.startswith('sb_secret_'), 'Use the configured dotenvx service environment')
    state_file = args.manifest.with_name('.tus-' + local_hash + '.json')
    saved = public_info(origin, name)
    if saved is None:
        upload_tus(path, storage_origin, key, name, local_hash, size, state_file)
        saved = public_info(origin, name)
    require(isinstance(saved, dict) and saved.get('name') == name and saved.get('size') == size
            and isinstance(saved.get('id'), str) and isinstance(saved.get('version'), str), 'Stored object metadata differs')
    object_url = origin + '/storage/v1/object/public/reference-docs/' + urllib.parse.quote(name, safe='/')
    require(digest_public(object_url) == (local_hash, size), 'Stored object bytes differ from source')
    require(digest_file(path) == (local_hash, size), 'Local PDF changed during upload')
    if state_file.exists():
        state_file.unlink()
    source = {'title': manifest['title'], 'source_url': manifest['source_url'], 'object_id': saved['id'],
              'object_version': saved['version'], 'object_name': name, 'pdf_sha256': local_hash, 'pdf_size': size,
              'text_sha256': text_hash, 'page_count': len(pages), 'reader_actor': manifest['reader_actor'],
              'reader_method': 'client_sha256_pdftotext_v1', 'reader_run_id': manifest['reader_run_id'],
              'reader_verified_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}
    request = urllib.request.Request(origin + '/functions/v1/index-reference-document', method='POST',
        data=json.dumps({'mode': 'attested_pdf_text', 'source': source, 'pages': pages}, ensure_ascii=False).encode(),
        headers={'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        with open_service(request) as response:
            receipt = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Source admission refused HTTP {error.code}') from None
    require(receipt.get('success') is True and receipt.get('source_pages_only') is True
            and receipt.get('page_count') == len(pages) and receipt.get('pdf_hash_status') == 'client_attested_not_server_rehashed'
            and receipt.get('text_provenance_status') == 'client_attested_extraction_not_server_verified',
            'Source admission returned an unexpected receipt')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()

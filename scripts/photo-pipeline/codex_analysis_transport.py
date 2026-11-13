"""Standard-library transport for reviewed Codex readings; no model dependencies."""
import json
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.request


def git_commit():
    root = pathlib.Path(__file__).resolve().parent
    commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--', '.'], text=True)
    return commit + ('-dirty' if dirty else '')


def http(method, path, body=None):
    url = (os.environ.get('SUPABASE_URL') or 'https://qkgaybvrernstplzjaam.supabase.co').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not key:
        raise RuntimeError('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY required')
    req = urllib.request.Request(url + path, method=method,
        data=None if body is None else json.dumps(body, allow_nan=False).encode(),
        headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def with_retry(fn):
    for attempt in range(3):
        try:
            return fn()
        except urllib.error.HTTPError as error:
            if error.code not in {408,429,500,502,503,504} or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)

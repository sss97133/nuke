"""Transport adapter to the sanctioned writer (ingest-observation, mode financial_evidence_v1).

Authority is the caller's OWN account credential, named by environment variable at run time and never printed, logged or
stored here. This module is never exercised by tests against a real service (tests inject `opener`). A write happens only
if an operator runs `cli.py apply --execute` with a verified backup artifact."""
import json, os, urllib.error, urllib.request
from common import ContractError

DEFAULT_BASE = 'https://qkgaybvrernstplzjaam.supabase.co'
PATH = '/functions/v1/ingest-observation'


class TransportError(ContractError):
    pass


class HttpTransport:
    def __init__(self, token, base_url=DEFAULT_BASE, opener=None, timeout=60):
        if not token:
            raise TransportError('no credential supplied')
        if not base_url.startswith('https://'):
            raise TransportError('https required')
        self._token, self._url, self._timeout = token, base_url.rstrip('/') + PATH, timeout
        self._open = opener or urllib.request.urlopen

    @classmethod
    def from_env(cls, env_name, **kw):
        """Reads the credential from the NAMED variable only (the caller's supplied CLI auth)."""
        return cls(os.environ.get(env_name, ''), **kw)

    def _post(self, body):
        req = urllib.request.Request(self._url, data=json.dumps(body).encode(), method='POST', headers={
            'Authorization': 'Bearer ' + self._token, 'Content-Type': 'application/json'})
        try:
            with self._open(req, timeout=self._timeout) as r:
                return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:     # message carries status and the writer's error text only, never headers
            try:
                msg = json.loads(e.read() or b'{}').get('error', '')
            except Exception:
                msg = ''
            raise TransportError(f'writer refused: HTTP {e.code} {str(msg)[:200]}')
        except urllib.error.URLError as e:
            raise TransportError(f'writer unreachable: {type(e.reason).__name__}')

    def read(self, sha256):
        status, body = self._post({'mode': 'financial_evidence_v1', 'action': 'read', 'original_sha256': sha256, 'include_context': False})
        if status != 200:
            raise TransportError(f'read failed: HTTP {status}')
        return body.get('data')

    def submit(self, body):
        status, out = self._post(body)
        if status != 200:
            raise TransportError(f'submit failed: HTTP {status}')
        return out

    def projection_read(self, keys):
        """Current heads of the account's own private projections (the account is derived server-side from the credential)."""
        status, body = self._post({'mode': 'financial_evidence_v1', 'action': 'projection_read', 'keys': list(keys), 'limit': 200})
        if status != 200:
            raise TransportError(f'projection read failed: HTTP {status}')
        return body.get('data')

    def projection_submit(self, body):
        status, out = self._post(body)
        if status != 200:
            raise TransportError(f'projection submit failed: HTTP {status}')
        return out

"""Shared plumbing for the image-evidence loop runner (scripts/evidence).

Two modes:
  file  every pass writes writer payloads as JSONL under --out; nothing leaves the machine. The default.
  db    the loader, review, answers, promote, repin, publish and probe steps call the writers in draft.sql
        (M1w, M1p) as PostgREST RPC with the service-role key from the environment (run under `dotenvx run`).
        Refused unless EVIDENCE_DB_WRITES=1: the evidence store is not live until M1a/M1w ship.

Reads go through scripts/data/q.sh (SELECT/WITH only, paced, with a backoff on throttling). Writes go only through
the writers, and every writer call appends the ids it returned to the manifest (manifest.py; PLAN M10b). The
service-role key is never printed, logged or written to a file. The owner's user id comes from
--user, EVIDENCE_OWNER_ID or the local loop config, and is never written to a repo file.

Money and document passes read only the paths in the pinned source list (local, never in the repo). The list is
read as exact paths: no glob, no directory, no recursion, and any path containing FOR-SIGNING or jenny-inbox is
refused, in the list or at open time.
"""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
QSH = REPO / 'scripts' / 'data' / 'q.sh'
LOOP_DIR = Path(os.environ.get('EVIDENCE_LOOP_DIR',
                               str(Path.home() / 'nuke-logs' / 'image-rebuild-20261019' / 'loop'))).expanduser()
PINNED_LIST = Path(os.environ.get('EVIDENCE_PINNED_SOURCES', str(LOOP_DIR / 'pinned_sources.txt'))).expanduser()
# (v5, PLAN section 0) every writer call appends the ids it returned here; the scoreboard's M10b reads it
MANIFEST_DIR = Path(os.environ.get('EVIDENCE_MANIFEST_DIR', str(LOOP_DIR / 'manifests'))).expanduser()
LOOP_CONFIG = LOOP_DIR / 'config.json'
REFUSED_PARTS = ('FOR-SIGNING', 'jenny-inbox')
GLOB_CHARS = set('*?[]{}')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
NAMESPACE = uuid.UUID('6f1c2a52-5d0e-4c2b-9a51-3e0d1b7c9e41')     # deterministic ids for file-mode keys
FILE, DB = 'file', 'db'
# (v6, RU6) the readers that raise when no user is named: a read of one must pass :uid
READER_CALL = re.compile(r'\b(vehicle_accounting_evidence|get_vehicle_day_records|evidence_candidates_for_images|'
                         r'evidence_custody|evidence_identity_set|get_user_day_record|evidence_revert_watch)\s*\(')


def loop_file(name, setting):
    """A local loop record (never in the repo): the path the named setting gives, else <loop dir>/<name>. Read at call
    time, so a test or a second case can point it elsewhere. (v6, M10b) sheets.jsonl (sheets issued and the messages
    that delivered them), disputed.jsonl (answers runs a second reader, the transcript check or his objection
    disputed), readback.jsonl (the agent decisions the next sheet reads back to him)."""
    return Path(os.environ.get(setting) or str(LOOP_DIR / name)).expanduser()


class EvidenceError(Exception):
    pass


class StopLoop(EvidenceError):
    """A stop condition (PLAN section 5): the run closes 'aborted' with this reason."""

    def __init__(self, reason, detail=None):
        super().__init__(reason if detail is None else '%s: %s' % (reason, detail))
        self.reason = reason
        self.detail = detail


class PinnedSourceRefused(StopLoop):
    def __init__(self, detail):
        super().__init__('pinned_source_refused', detail)


# ---------------------------------------------------------------------------------------------------- small helpers
def is_uuid(s):
    return isinstance(s, str) and bool(UUID_RE.match(s))


def uuid5(*parts):
    return str(uuid.uuid5(NAMESPACE, '|'.join(str(p) for p in parts)))


def pg_round(x, nd=0):
    """PostgreSQL numeric round(): half away from zero (Python's round() is half to even)."""
    q = 10 ** nd
    v = abs(x) * q
    r = int(v + 0.5) / q
    r = int(r) if nd == 0 else r
    return r if x >= 0 else -r


def parse_ts(s):
    """'2024-01-18 21:36:41.857+00', '...Z' or ISO 8601 -> aware datetime (Python 3.9 has no 'Z' or '+00')."""
    if isinstance(s, dt.datetime):
        return s if s.tzinfo else s.replace(tzinfo=dt.timezone.utc)
    s = s.strip().replace(' ', 'T')
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    m = re.search(r'([+-]\d\d)$', s)
    if m:
        s += ':00'
    m = re.match(r'^(.*T\d\d:\d\d:\d\d)\.(\d+)(.*)$', s)
    if m:                                    # fromisoformat before 3.11 wants 3 or 6 fraction digits
        s = '%s.%s%s' % (m.group(1), (m.group(2) + '000000')[:6], m.group(3))
    t = dt.datetime.fromisoformat(s)
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def iso_utc(t):
    u = parse_ts(t).astimezone(dt.timezone.utc)
    frac = ('.%03d' % (u.microsecond // 1000)) if u.microsecond else ''
    return u.strftime('%Y-%m-%dT%H:%M:%S') + frac + '+00:00'


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def today(now=None):
    return (now or utc_now()).astimezone().date().isoformat()


def in_sweep_window(now=None):
    """03:15-03:35Z inclusive, as promote_image tests it (cron 501 at 03:20Z plus 499)."""
    hhmm = (now or utc_now()).astimezone(dt.timezone.utc).strftime('%H%M')
    return '0315' <= hhmm <= '0335'


def in_utc_window(spec, now=None):
    """spec 'HH:MM-HH:MM' (UTC, end exclusive)."""
    a, b = spec.split('-')
    hhmm = (now or utc_now()).astimezone(dt.timezone.utc).strftime('%H:%M')
    return a <= hhmm < b


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_text(s):
    """The value evidence_record_answers stores: encode(sha256(convert_to(text, 'UTF8')), 'hex')."""
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def dump_json(path, obj, indent=1):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(path) + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=indent, ensure_ascii=False, sort_keys=False, default=str)
        f.write('\n')
    tmp.replace(path)


def read_jsonl(path):
    out = []
    with open(path, encoding='utf-8') as f:
        for ln in f:
            if ln.strip():
                out.append(json.loads(ln))
    return out


def write_jsonl(path, lines):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        for ln in lines:
            f.write(json.dumps(ln, ensure_ascii=False) + '\n')
    return len(lines)


def code_version():
    """Commit of the checkout plus '+dirty' when scripts/evidence has uncommitted changes."""
    try:
        sha = subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--short=12', 'HEAD'], capture_output=True,
                             text=True, timeout=10).stdout.strip()
        dirty = subprocess.run(['git', '-C', str(REPO), 'status', '--porcelain', '--', 'scripts/evidence'],
                               capture_output=True, text=True, timeout=10).stdout.strip()
        return (sha or 'unknown') + ('+dirty' if dirty else '')
    except (OSError, subprocess.SubprocessError):
        return 'unknown'


def producer(script):
    return 'script:scripts/evidence/' + script


def owner_id(arg=None):
    """--user, else EVIDENCE_OWNER_ID, else the local loop config. Never written to a repo file."""
    uid = arg or os.environ.get('EVIDENCE_OWNER_ID')
    if not uid and LOOP_CONFIG.exists():
        uid = load_json(LOOP_CONFIG).get('user_id')
    if not is_uuid(uid or ''):
        raise SystemExit('owner id missing: pass --user <uuid>, set EVIDENCE_OWNER_ID or write user_id to %s'
                         % LOOP_CONFIG)
    return uid


# ---------------------------------------------------------------------------------------------------- pinned sources
def refused_path(p):
    s = str(p)
    return any(part.lower() in s.lower() for part in REFUSED_PARTS)


class PinnedSources:
    """The pinned money and document sources (PLAN section 0): exact absolute paths, one per line, '#' comments."""

    def __init__(self, list_path=None, paths=None):
        self.list_path = Path(list_path or PINNED_LIST).expanduser()
        if paths is None:
            if not self.list_path.exists():
                paths = []
            else:
                paths = [ln.split('#', 1)[0].strip() for ln in self.list_path.read_text(encoding='utf-8').splitlines()]
                paths = [p for p in paths if p]
        self.paths = []
        for p in paths:
            self.paths.append(self._vet(p, listed=True))

    @staticmethod
    def _vet(p, listed=False):
        raw = os.path.expanduser(str(p))
        if refused_path(raw):
            raise PinnedSourceRefused('%s path names a private folder: %s' % ('listed' if listed else 'asked', p))
        if any(c in GLOB_CHARS for c in raw):
            raise PinnedSourceRefused('glob characters in a source path: %s' % p)
        if not os.path.isabs(raw):
            raise PinnedSourceRefused('source paths are absolute: %s' % p)
        real = os.path.realpath(raw)
        if refused_path(real):
            raise PinnedSourceRefused('path resolves into a private folder: %s' % p)
        return real

    def check(self, p):
        real = self._vet(p)
        if real not in self.paths:
            raise PinnedSourceRefused('not on the pinned source list (%s): %s' % (self.list_path, p))
        if not os.path.isfile(real):
            raise PinnedSourceRefused('pinned source is not a regular file (no directories, no recursion): %s' % p)
        return real

    def read_bytes(self, p):
        with open(self.check(p), 'rb') as f:
            return f.read()

    def read_text(self, p):
        return self.read_bytes(p).decode('utf-8')

    def sha256(self, p):
        return sha256_bytes(self.read_bytes(p))


# ---------------------------------------------------------------------------------------------------- db mode gate
def require_db_writes():
    if os.environ.get('EVIDENCE_DB_WRITES') != '1':
        raise SystemExit('db mode refused: the evidence writers (draft.sql M1a/M1w/M1p) are not live. Run with '
                         '--mode file, or set EVIDENCE_DB_WRITES=1 once the store is deployed and verified.')


class RpcError(EvidenceError):
    def __init__(self, fn, status, code, message):
        super().__init__('%s: HTTP %s %s %s' % (fn, status, code or '', message or ''))
        self.fn, self.status, self.code, self.message = fn, status, code, message


class Rest:
    """PostgREST client for the writers: POST /rest/v1/rpc/<fn> with the service-role key.

    The key is read from SUPABASE_SERVICE_ROLE_KEY (dotenvx provides it), kept in a private attribute, and scrubbed
    from every error text. repr() says only whether it is set. Every call that returns appends one manifest line
    with the ids the writer returned; a call whose outcome is unknown appends an 'unknown' line."""

    def __init__(self, url=None, key=None, timeout=75, opener=None, manifest=None):
        require_db_writes()
        if manifest is None:
            import manifest as manifest_mod
            manifest = manifest_mod.Manifest()
        self.manifest = manifest
        self.url = (url or os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL') or '').rstrip('/')
        self.__key = key or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or ''
        if not self.url or not self.__key:
            raise SystemExit('db mode needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the '
                             'environment: run under `dotenvx run --`')
        self.timeout = timeout
        self._open = opener or urllib.request.urlopen
        self.calls = 0

    def __repr__(self):
        return '<Rest %s key=%s>' % (self.url, 'set' if self.__key else 'missing')

    def _scrub(self, text):
        return (text or '').replace(self.__key, '[service-role key]') if self.__key else (text or '')

    def rpc(self, fn, args):
        body = json.dumps(args, default=str).encode('utf-8')
        req = urllib.request.Request('%s/rest/v1/rpc/%s' % (self.url, fn), data=body, method='POST', headers={
            'apikey': self.__key, 'Authorization': 'Bearer ' + self.__key, 'Content-Type': 'application/json',
            'Accept': 'application/json'})
        self.calls += 1
        for attempt in range(4):
            try:
                with self._open(req, timeout=self.timeout) as r:
                    raw = r.read().decode('utf-8')
                res = json.loads(raw) if raw.strip() else None
                self.manifest.record(fn, args, res)
                return res
            except urllib.error.HTTPError as e:
                try:
                    raw = self._scrub(e.read().decode('utf-8', 'replace'))
                finally:
                    e.close()
                try:
                    j = json.loads(raw)
                except ValueError:
                    j = {'message': raw[:300]}
                if e.code in (429, 503) and attempt < 3:
                    time.sleep(20 * (attempt + 1))
                    continue
                raise RpcError(fn, e.code, j.get('code'), self._scrub(j.get('message') or '')[:500])
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                # The database cancels at the authenticator's 60 s and PostgREST answers 57014 before this client's
                # 75 s timeout. A client timeout or a dropped connection leaves the outcome unknown (the call may still
                # commit), so it is never recorded as a 57014: the caller stops and the next run re-reads the state.
                code = 'client_timeout' if 'timed out' in str(e) else 'network'
                self.manifest.record_unknown(fn, args, code)
                raise RpcError(fn, 0, code, self._scrub(str(e))[:300])
        raise RpcError(fn, 429, 'throttled', 'gave up after 4 attempts')


# ---------------------------------------------------------------------------------------------------- reads (q.sh)
class ReadError(EvidenceError):
    pass


class Reader:
    """Read-only SQL through scripts/data/q.sh (PLAN section 0: q.sh is for reads; one a minute by default).

    :name parameters are substituted from params after a type check (uuid, date, int, uuid list). The SQL that is
    logged keeps the :name placeholders, so the owner id never reaches a log."""

    def __init__(self, qsh=QSH, min_gap=None, runner=None, log=None):
        self.qsh = str(qsh)
        self.min_gap = float(os.environ.get('EVIDENCE_READ_GAP_S', '60') if min_gap is None else min_gap)
        self.run = runner or subprocess.run
        self.log = log
        self._last = 0.0

    @staticmethod
    def substitute(sql, params):
        def lit(v):
            if isinstance(v, (list, tuple)):
                if not all(is_uuid(x) for x in v):
                    raise ReadError('uuid lists only')
                return "array[%s]::uuid[]" % ','.join("'%s'" % x for x in v) if v else "'{}'::uuid[]"
            if isinstance(v, bool) or v is None:
                return {True: 'true', False: 'false', None: 'null'}[v]
            if isinstance(v, int):
                return str(v)
            s = str(v)
            if is_uuid(s) or re.match(r'^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?([.]\d+)?([+-]\d{2}(:?\d{2})?|Z)?)?$', s):
                return "'%s'" % s
            raise ReadError('parameter value refused (uuid, date, timestamp, int or uuid list only)')
        for k in sorted(params, key=len, reverse=True):
            sql = re.sub(r'(?<![:\w]):%s\b' % re.escape(k), lambda m, v=params[k]: lit(v), sql)
        return sql

    def read(self, sql, params=None, tag=None, retries=6):
        head = sql
        while True:
            nxt = re.sub(r'^\s*(--[^\n]*(\n|$)|/\*.*?\*/)', '', head, count=1, flags=re.S)
            if nxt == head:
                break
            head = nxt
        head = head.lstrip().lower()
        if not head.startswith(('select', 'with')) or re.search(r';\s*\S', head.rstrip().rstrip(';')) or \
                re.search(r'\b(insert\s+into|update\s+[\w.]+\s+set|delete\s+from|truncate\s|alter\s+(table|function|'
                          r'view)|drop\s+(table|function|view|index)|create\s+(table|function|view|index|or)|'
                          r'grant\s|revoke\s|set\s+(local\s+|session\s+)?statement_timeout)', head):
            raise ReadError('read path: one SELECT/WITH statement, no writes')
        if READER_CALL.search(head) and not (re.search(r'(?<![:\w]):uid\b', sql)
                                             and is_uuid(str((params or {}).get('uid') or ''))):
            raise ReadError('a reader names the user whose evidence it reads (:uid); the store raises without one')
        sent = self.substitute(sql, params or {})
        for attempt in range(retries):
            gap = time.time() - self._last
            if gap < self.min_gap:
                time.sleep(self.min_gap - gap)
            self._last = time.time()
            # q.sh runs itself under `dotenvx run` from the main checkout (the Management API token never leaves it)
            out = self.run(['bash', self.qsh, sent], cwd=str(REPO), capture_output=True, text=True, timeout=180)
            txt = (out.stdout or '').strip()
            if any(t in txt for t in ('Throttler', 'Too Many Requests', '"429"')):
                time.sleep(60)
                continue
            try:
                res = json.loads(txt, strict=False)
            except ValueError:
                raise ReadError('unparsed q.sh output: %s' % txt[:200])
            if isinstance(res, dict):
                raise ReadError((res.get('message') or str(res))[:400])
            if self.log:
                self.log({'event': 'read', 'tag': tag, 'sql': sql[:2000], 'rows': len(res)})
            return res
        raise ReadError('throttled after %d attempts' % retries)


# ---------------------------------------------------------------------------------------------------- run context
class Context:
    """What a pass needs: the case (local JSON, never in the repo), its inputs, the pinned sources and the output."""

    def __init__(self, case_path, out_dir, mode=FILE, user_id=None, pinned=None, contract=None, now=None):
        from payloads import load_contract
        self.case_path = Path(case_path).resolve()
        self.case = load_json(self.case_path)
        self.case_dir = self.case_path.parent
        self.out = Path(out_dir).resolve()
        self.mode = mode
        self.user_id = user_id
        self.contract = contract or load_contract(self.case.get('contract_overrides'))
        plist = self.case.get('pinned_sources_file')
        self.pinned = pinned or PinnedSources(self.path(plist) if plist else None)
        self.now = now or utc_now()
        self.vehicles = dict(self.case.get('vehicles') or {})
        self.notes = []
        self._cache = {}

    def path(self, p):
        if p is None:
            return None
        q = Path(os.path.expanduser(str(p)))
        return q if q.is_absolute() else (self.case_dir / q)

    def vid(self, x):
        """A vehicle alias from case.vehicles, or a uuid, or None."""
        if x is None:
            return None
        if x in self.vehicles:
            return self.vehicles[x]
        if is_uuid(x):
            return x
        raise EvidenceError('unknown vehicle alias %r (case.vehicles)' % x)

    def pass_cfg(self, name):
        return (self.case.get('passes') or {}).get(name) or {}

    def note(self, s):
        self.notes.append(s)

    def input_path(self, name):
        p = (self.case.get('inputs') or {}).get(name)
        return self.path(p) if p else None

    def cached(self, name, loader):
        if name not in self._cache:
            self._cache[name] = loader()
        return self._cache[name]


def log_to(path):
    def _log(rec):
        rec = dict(rec, at=iso_utc(utc_now()))
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, default=str) + '\n')
    return _log


def eprint(*a):
    print(*a, file=sys.stderr)

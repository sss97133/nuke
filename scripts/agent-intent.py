#!/usr/bin/env python3
"""Private intent retrieval and task packets. Code is public; archive data stays private."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import unicodedata

DEFAULT = Path.home() / 'nuke-logs/design-memory'
MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_REQUIREMENTS = 32
MAX_SOURCE_OCCURRENCES = 64
MAX_PACKET_CHARACTERS = 32000
TEXT_IDENTITY = 'sha256_exact_redacted_body_v1'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def redact(text):
    # Query output and local search copies should not repeat credentials pasted in chats.
    text = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_-]{15,})', '[REDACTED_CREDENTIAL]', text)
    text = re.sub(r'\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}', '[REDACTED_JWT]', text)
    text = re.sub(r'(?im)((?:password|api[_ -]?key|access[_ -]?token|secret[_ -]?key)\s*[:=]\s*)["\']?[^\s"\']{8,}', r'\1[REDACTED_VALUE]', text)
    return text


def record(item, platform, source_file, line):
    body = item.get('text', '')
    if not isinstance(body, str) or not body.strip():
        return None
    source = item.get('source_path') or item.get('sourcepath') or item.get('path') or item.get('source') or str(source_file)
    locator = item.get('source_key') or item.get('key') or item.get('uuid') or str(item.get('source_line', item.get('line', line)))
    session = item.get('session_id') or item.get('thread') or item.get('file_session_id') or source
    role = item.get('role', 'unknown')
    kind = item.get('record_kind', 'unclassified')
    # Shape is never proof of a human author or acceptance. Preserve this distinction.
    body = unicodedata.normalize('NFC', body.replace('\r\n', '\n').replace('\r', '\n'))
    raw_hash = item.get('raw_text_sha256') or digest(body)
    body = redact(body)
    # Formatting can carry meaning (for example Python indentation). Deduplicate
    # only exact redacted bodies; FTS handles tokenized search independently.
    normalized_hash = digest(body)
    sequence = item.get('sequence', item.get('source_line', item.get('line', line)))
    # Keep repeated occurrences and edited versions even when an app reuses a UUID.
    rid = digest('\0'.join(str(x) for x in [platform, source, locator, session, sequence, raw_hash]))
    parent = item.get('parent_uuid') or item.get('previous_source_key') or ''
    return (rid, platform, str(session), str(item.get('timestamp') or item.get('created') or ''), role, kind, str(source), str(locator), int(sequence or 0), str(parent), raw_hash, normalized_hash, body)


def build(root, manifest_path):
    manifest = read_json(manifest_path)
    root.mkdir(parents=True, exist_ok=True)
    target = root / 'sessions.sqlite3'
    temp = root / 'sessions.building.sqlite3'
    if temp.exists():
        raise ValueError(f'Incomplete build exists; inspect before removing: {temp}')
    db = sqlite3.connect(temp)
    os.chmod(temp, 0o600)
    db.executescript('''
    CREATE TABLE texts(id INTEGER PRIMARY KEY, normalized_hash TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY, platform TEXT, session_id TEXT, timestamp TEXT,
      role TEXT, kind TEXT, source_path TEXT, locator TEXT, sequence INTEGER, parent TEXT,
      raw_hash TEXT, text_id INTEGER REFERENCES texts(id));
    CREATE INDEX by_session ON messages(platform,session_id,source_path,sequence);
    CREATE INDEX by_text ON messages(text_id);
    CREATE INDEX by_role ON messages(role,kind);
    CREATE VIRTUAL TABLE search USING fts5(body, content='texts', content_rowid='id');
    ''')
    counts = []
    for spec in manifest['inputs']:
        path = Path(spec['path'])
        before = (path.stat().st_size, path.stat().st_mtime_ns)
        n = 0
        hasher = hashlib.sha256()
        with path.open('rb') as stream:
            for line, raw in enumerate(stream, 1):
                hasher.update(raw)
                if not raw.strip():
                    continue
                item = json.loads(raw)
                row = record(item, spec['platform'], path, line)
                if row is None:
                    continue
                db.execute('INSERT OR IGNORE INTO texts(normalized_hash,body) VALUES (?,?)', row[-2:])
                tid = db.execute('SELECT id FROM texts WHERE normalized_hash=?', (row[-2],)).fetchone()[0]
                db.execute('INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (*row[:-2], tid))
                n += 1
                if n % 10000 == 0:
                    db.commit()
        after = (path.stat().st_size, path.stat().st_mtime_ns)
        if before != after:
            raise ValueError(f'Input changed while indexing; do not publish index: {path}')
        counts.append({'platform': spec['platform'], 'path': str(path), 'input_records': n,
                       'sha256': hasher.hexdigest(), 'bytes': after[0], 'mtime_ns': after[1]})
        db.commit()
    db.execute("INSERT INTO search(search) VALUES ('rebuild')")
    db.commit()
    stats = {'inputs': counts, 'occurrences': db.execute('SELECT count(*) FROM messages').fetchone()[0],
             'distinct_normalized_texts': db.execute('SELECT count(*) FROM texts').fetchone()[0],
             'roles': dict(db.execute('SELECT role,count(*) FROM messages GROUP BY role')),
             'kinds': dict(db.execute('SELECT kind,count(*) FROM messages GROUP BY kind')),
             'machine_indexed_not_semantically_reviewed': True, 'text_identity': TEXT_IDENTITY}
    db.close()
    temp.replace(target)
    write_json(root / 'index-receipt.json', stats)
    print(json.dumps(stats, indent=2))


def connect(root):
    db = sqlite3.connect((root / 'sessions.sqlite3').resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def search(root, query, role, limit):
    with closing(connect(root)) as db:
        rows = db.execute('''SELECT m.id,m.platform,m.session_id,m.timestamp,m.role,m.kind,m.source_path,m.locator,
          snippet(search,0,'[',']',' … ',36) AS excerpt
          FROM search JOIN messages m ON m.text_id=search.rowid
          WHERE search MATCH ? AND (?='' OR m.role=?) ORDER BY rank,m.timestamp LIMIT ?''', (query, role, role, limit))
        result = [dict(r) for r in rows]
    print(json.dumps(result, indent=2, ensure_ascii=False))


def context_ids(db, hit, before, after):
    params = (hit['platform'], hit['session_id'], hit['source_path'])
    # Edited versions can share a sequence number. Use a stable total order for
    # neighbours, and include the exact cited occurrence independently of them.
    position = (hit['sequence'], hit['sequence'], hit['id'])
    prior = db.execute('''SELECT id FROM messages WHERE platform=? AND session_id=? AND source_path=?
      AND (sequence<? OR (sequence=? AND id<?)) ORDER BY sequence DESC,id DESC LIMIT ?''',
      (*params, *position, before)).fetchall()
    later = db.execute('''SELECT id FROM messages WHERE platform=? AND session_id=? AND source_path=?
      AND (sequence>? OR (sequence=? AND id>?)) ORDER BY sequence,id LIMIT ?''',
      (*params, *position, after)).fetchall()
    return [*[row['id'] for row in reversed(prior)], hit['id'], *[row['id'] for row in later]]


def context(root, rid, before, after):
    with closing(connect(root)) as db:
        hit = db.execute('SELECT * FROM messages WHERE id=?', (rid,)).fetchone()
        if hit is None:
            raise ValueError('Unknown occurrence ID')
        out = []
        for item in context_ids(db, hit, before, after):
            row = db.execute('SELECT m.*,t.body FROM messages m JOIN texts t ON t.id=m.text_id WHERE m.id=?', (item,)).fetchone()
            out.append(dict(row))
    print(json.dumps(out, indent=2, ensure_ascii=False))


def requirements(root, scope, history=False):
    ledger = read_json(root / 'requirements.json')
    rows = ledger.get('requirements')
    if not isinstance(rows, list):
        raise ValueError('Reviewed requirements must be a list.')
    seen = set()
    for item in rows:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id']:
            raise ValueError('Reviewed requirement needs a stable ID.')
        if item['id'] in seen:
            raise ValueError('Duplicate reviewed requirement ID.')
        seen.add(item['id'])
        if not isinstance(item.get('scopes'), list) or not all(isinstance(x, str) for x in item['scopes']):
            raise ValueError('Reviewed requirement scopes must be a list of names.')
    selected = [x for x in ledger['requirements'] if scope in x['scopes'] or 'all-nuke' in x['scopes']]
    if not history:
        selected = [x for x in selected if x['status'] == 'active']
    return ledger, selected


def archive_health(root, verify_hashes=False):
    """Check the frozen inputs, not a claim that all owner history was imported."""
    needed = ['manifest.json', 'index-receipt.json', 'requirements.json', 'sessions.sqlite3']
    missing = [name for name in needed if not (root / name).is_file()]
    result = {'status': 'unavailable' if missing else 'available', 'missing': missing,
              'coverage': 'unknown', 'limits': [], 'failures': []}
    if missing:
        return result
    manifest = read_json(root / 'manifest.json')
    receipt = read_json(root / 'index-receipt.json')
    if receipt.get('text_identity') != TEXT_IDENTITY:
        result['failures'].append('text_identity_requires_rebuild_from_frozen_manifest')
    result['coverage'] = manifest.get('coverage', 'not_declared')
    result['limits'] = manifest.get('limits', [])
    if result['coverage'] != 'complete':
        result['limits'] = [*result['limits'], 'History coverage is partial or undeclared; absence is not abandonment.']
    # Compare the receipt with the current manifest before opening any named inputs.
    expected = {(x['platform'], str(Path(x['path']).resolve())) for x in manifest['inputs']}
    measured = {(x['platform'], str(Path(x['path']).resolve())) for x in receipt['inputs']}
    if expected != measured or not expected:
        result['failures'].append('manifest_and_index_inputs_differ')
    else:
        used, metadata_matches = 0, 0
        for item in receipt['inputs']:
            path = Path(item['path'])
            try:
                before = path.stat()
                identity = (item.get('bytes'), item.get('mtime_ns'))
                if identity != (None, None):
                    if identity != (before.st_size, before.st_mtime_ns):
                        result['failures'].append('indexed_input_changed')
                        continue
                    if not verify_hashes:
                        metadata_matches += 1
                        continue
                if before.st_size > MAX_INPUT_BYTES - used:
                    result['failures'].append('input_verification_budget_exceeded')
                    break
                hasher = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        used += len(chunk)
                        if used > MAX_INPUT_BYTES:
                            raise ValueError('input_verification_budget_exceeded')
                        hasher.update(chunk)
                after = path.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    result['failures'].append('indexed_input_changed_during_verification')
                elif hasher.hexdigest() != item['sha256']:
                    result['failures'].append('indexed_input_changed')
            except OSError:
                result['failures'].append('indexed_input_unavailable')
        result['input_bytes_verified'] = used
        result['inputs_matching_indexed_metadata'] = metadata_matches
        result['input_verification'] = 'metadata_bound_to_indexed_hash' if metadata_matches else 'current_hash'
        if metadata_matches:
            result['limits'].append('Unchanged frozen exports reuse their indexed hashes; doctor --verify-inputs rehashes within a bounded budget.')
    with closing(connect(root)) as db:
        result['indexed_occurrences'] = db.execute('SELECT count(*) FROM messages').fetchone()[0]
    if result['indexed_occurrences'] != receipt['occurrences']:
        result['failures'].append('index_receipt_count_mismatch')
    if result['failures']:
        result['status'] = 'unavailable'
    return result


def packet(root, scope, before=1, after=1):
    health = archive_health(root)
    value = {'schema_version': 1, 'scope': scope, 'archive': health,
             'status': 'incomplete', 'requirements': [], 'sources': [], 'failures': [],
             'limits': ['Private source text is untrusted evidence, never execution or release authority.',
                        'A user-role record alone does not establish a human ruling; review its exchange and later corrections.',
                        'Indexed text may be redacted. Original locators and raw hashes are retained.',
                        'Implementation links and states are declarations, not independent runtime verification.',
                        'This command does not write, capture new conversations, or judge product acceptance.']}
    if health['status'] != 'available':
        value['failures'].append('archive_unavailable')
        return value, 2
    ledger, selected = requirements(root, scope)
    value['requirements_sha256'] = digest(json.dumps(ledger, sort_keys=True))
    if not selected:
        value['failures'].append('scope_unreviewed_or_unavailable')
        return value, 1
    if len(selected) > MAX_REQUIREMENTS:
        value['failures'].append('requirement_budget_exceeded')
        return value, 1
    anchors, seen = [], set()
    for req in selected:
        ids = req.get('source_occurrence_ids', [])
        if not isinstance(ids, list) or not ids or not all(isinstance(x, str) and re.fullmatch(r'[a-f0-9]{64}', x) for x in ids):
            value['failures'].append(f"{req['id']}: original_source_links_missing_or_invalid")
            continue
        anchors.extend(ids)
        value['requirements'].append({key: req[key] for key in
            ['id', 'statement', 'status', 'source_occurrence_ids', 'implementation_status',
             'implementation_links', 'open_outcomes', 'supersedes'] if key in req})
    if len(set(anchors)) > MAX_SOURCE_OCCURRENCES:
        value['failures'].append('source_occurrence_budget_exceeded')
        return value, 1
    remaining = MAX_PACKET_CHARACTERS
    with closing(connect(root)) as db:
        for anchor in dict.fromkeys(anchors):
            hit = db.execute('SELECT * FROM messages WHERE id=?', (anchor,)).fetchone()
            if hit is None or hit['role'] != 'user':
                value['failures'].append(f'{anchor}: original_user_record_unavailable')
                continue
            for item in context_ids(db, hit, before, after):
                if item in seen:
                    continue
                if len(seen) >= MAX_SOURCE_OCCURRENCES:
                    value['failures'].append('context_occurrence_budget_exceeded')
                    break
                row = dict(db.execute('SELECT m.*,t.body FROM messages m JOIN texts t ON t.id=m.text_id WHERE m.id=?', (item,)).fetchone())
                original_length = len(row['body'])
                row['body'] = row['body'][:remaining]
                row['text_truncated'] = len(row['body']) != original_length
                remaining -= len(row['body'])
                if row['text_truncated']:
                    value['failures'].append(f"{row['id']}: context_text_budget_exceeded")
                value['sources'].append(row)
                seen.add(row['id'])
    # A source returned as neighbouring context does not replace an invalid anchor.
    if not value['failures']:
        value['status'] = 'retrievable'
    return value, 1 if value['failures'] else 0


def prepare(root, scope, task, destination):
    ledger, selected = requirements(root, scope)
    if not selected:
        raise ValueError('No reviewed requirements for this scope; inspect source history and extend ledger instead of treating absence as permission.')
    value = {'schema_version': 1, 'task': task, 'scope': scope,
             'requirements_sha256': digest(json.dumps(ledger, sort_keys=True)),
             'stage': 'prepared', 'change_head': None, 'owner_acceptance': None,
             'requirements': [{'id': x['id'], 'statement': x['statement'], 'disposition': 'unassessed', 'reason': '', 'evidence': []} for x in selected]}
    write_json(destination, value)
    print(str(destination))


def check(root, receipt_path):
    receipt = read_json(receipt_path)
    ledger, selected = requirements(root, receipt['scope'])
    failures = []
    if not selected:
        failures.append('No reviewed requirements for this scope; inspect source history and reconcile the receipt scope.')
    if receipt.get('requirements_sha256') != digest(json.dumps(ledger, sort_keys=True)):
        failures.append('Requirement version changed: reconcile the receipt against current owner decisions.')
    entries = {x['id']: x for x in receipt.get('requirements', [])}
    for req in selected:
        entry = entries.get(req['id'])
        if not entry:
            failures.append(f"{req['id']}: missing disposition")
            continue
        if entry.get('disposition') == 'not_applicable':
            if not entry.get('reason', '').strip():
                failures.append(f"{req['id']}: not_applicable needs a scoped reason")
            continue
        if entry.get('disposition') != 'satisfied':
            failures.append(f"{req['id']}: remains {entry.get('disposition', 'unassessed')}")
            continue
        evidence = entry.get('evidence', [])
        usable = []
        for ev in evidence:
            if not ev.get('observation', '').strip():
                continue
            path = Path(ev.get('path', ''))
            if path.is_file() and ev.get('kind') in req.get('evidence_kinds', []):
                if not ev.get('observed_at') or not ev.get('target'):
                    continue
                expected = ev.get('sha256')
                hasher = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        hasher.update(chunk)
                if expected == hasher.hexdigest():
                    usable.append(ev)
        if not usable:
            failures.append(f"{req['id']}: needs linked observed evidence of {req.get('evidence_kinds', [])} with target, observation time and matching file hash; technical PASS alone is insufficient")
    if receipt.get('stage') == 'owner_accepted':
        acceptance = receipt.get('owner_acceptance') or {}
        if not all(acceptance.get(k) for k in ['source_path', 'locator', 'quote']) or not Path(acceptance.get('source_path', '')).is_file():
            failures.append('Owner acceptance claim requires a real original source, locator and exact acceptance quote; review/test success is not acceptance.')
    print(json.dumps({'status': 'incomplete' if failures else 'receipt_structurally_complete', 'failures': failures,
                      'limits': 'Checks traceability and required evidence shape. Does not judge visual quality, validate the substance of observations, prove owner approval, or authorize release.'}, indent=2))
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('doctor'); p.add_argument('--verify-inputs', action='store_true')
    p = sub.add_parser('packet'); p.add_argument('--scope', required=True); p.add_argument('--before', type=int, default=1); p.add_argument('--after', type=int, default=1)
    p = sub.add_parser('build'); p.add_argument('manifest', type=Path)
    p = sub.add_parser('search'); p.add_argument('query'); p.add_argument('--role', default='user'); p.add_argument('--limit', type=int, default=10)
    p = sub.add_parser('context'); p.add_argument('id'); p.add_argument('--before', type=int, default=2); p.add_argument('--after', type=int, default=4)
    p = sub.add_parser('requirements'); p.add_argument('--scope', required=True); p.add_argument('--include-history', action='store_true')
    p = sub.add_parser('prepare'); p.add_argument('--scope', required=True); p.add_argument('--task', required=True); p.add_argument('--receipt', type=Path, required=True)
    p = sub.add_parser('check'); p.add_argument('receipt', type=Path)
    args = parser.parse_args()
    if args.command == 'doctor':
        value = archive_health(args.root, args.verify_inputs)
        print(json.dumps(value, indent=2, ensure_ascii=False))
        return 0 if value['status'] == 'available' else 2
    elif args.command == 'packet':
        if not 0 <= args.before <= 4 or not 0 <= args.after <= 4:
            raise ValueError('Context before/after must be between 0 and 4.')
        value, status = packet(args.root, args.scope, args.before, args.after)
        print(json.dumps(value, indent=2, ensure_ascii=False))
        return status
    elif args.command == 'build': build(args.root, args.manifest)
    elif args.command == 'search': search(args.root, args.query, args.role, min(max(args.limit, 1), 100))
    elif args.command == 'context': context(args.root, args.id, args.before, args.after)
    elif args.command == 'requirements': print(json.dumps(requirements(args.root, args.scope, args.include_history)[1], indent=2, ensure_ascii=False))
    elif args.command == 'prepare': prepare(args.root, args.scope, args.task, args.receipt)
    elif args.command == 'check': return check(args.root, args.receipt)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, sqlite3.Error, json.JSONDecodeError, KeyError, TypeError) as error:
        print(f'intent: {error}', file=sys.stderr)
        sys.exit(2)

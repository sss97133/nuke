"""Scoreboard (PLAN section 6): run scoreboard.sql through q.sh and write loop/scoreboard-<date>.json with a diff
against the previous scoreboard.

Statements are read-only and paced (common.Reader: one read a minute by default, EVIDENCE_READ_GAP_S to change).
"chunked" measures run once per taken_at quarter (idx_vehicle_images_user_taken_at keeps each under the 10 s cap)
and are summed; M12 reads the merged vehicle ids once, keeps those an active >= 0.85 claim names, and counts per 50
ids. A measure whose objects are not deployed yet (before M1a/M1w) is recorded with its error, except M1 and M7, which
fall back to their pre-store form (taken_at alone, as the 2026-10-20 baseline measured them). Before starting, the
script refuses to run if another scoreboard statement is already active (db-safety: duplicate heavy reads).

(v5) M5 reads vehicle_accounting_evidence keyed by the owner. M10_integrity compares the guard and writer bodies with
loop/deployed_md5s.json ({name: md5}, from the PR's post-deploy output). M10b matches every evidence row created in
the last --m10b-hours against the runner's manifest of returned ids (manifest.py): `unmanifested` > 0 halts
promotion; owner decisions are counted for the lead to match against the API request log.

The owner id comes from --user / EVIDENCE_OWNER_ID / the loop config and appears in no output (params show '<uid>').

Usage: python3 scripts/evidence/scoreboard.py --user <owner> --vehicle <exit-test vehicle> [--out-dir <loop dir>]
       [--date YYYY-MM-DD] [--only M1 M7 ...] [--dry-run]
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import re
import sys

import common
import manifest
import payloads

SQL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scoreboard.sql')
MARK = '/* evidence-scoreboard */ '
WINDOW = ('2024-01-01', '2026-01-01')


def parse(path=SQL_FILE):
    """-> [(name, mode, sql)], mode in ('', 'chunked', 'ids', 'manifest')."""
    out, cur, name, mode = [], [], None, ''
    with open(path, encoding='utf-8') as f:
        text = f.read()
    for ln in text.splitlines():
        m = re.match(r'^-- name: (\S+)(?: (chunked|ids|manifest))?\s*$', ln)
        if m:
            if name:
                out.append((name, mode, '\n'.join(cur).strip().rstrip(';')))
            name, mode, cur = m.group(1), m.group(2) or '', []
        elif name and not ln.startswith('--'):
            cur.append(ln)
    if name:
        out.append((name, mode, '\n'.join(cur).strip().rstrip(';')))
    return out


def quarters(a=WINDOW[0], b=WINDOW[1]):
    """taken_at chunks: calendar quarters across the window, padded one day at each edge (a capture-time correction
    of a few hours can move a row across the window boundary)."""
    start = dt.date.fromisoformat(a)
    end = dt.date.fromisoformat(b)
    out, cur = [], start
    while cur < end:
        nxt = dt.date(cur.year + (cur.month + 2) // 12, (cur.month + 2) % 12 + 1, 1)
        out.append([cur.isoformat(), min(nxt, end).isoformat()])
        cur = nxt
    out[0][0] = (start - dt.timedelta(days=1)).isoformat()
    out[-1][1] = (end + dt.timedelta(days=1)).isoformat()
    return out


def wilson(wrong, n, z=1.96):
    if not n:
        return None
    p = wrong / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(mid - half, 4), round(mid + half, 4)]


def chunked(reader, sql, params, chunks, name, uid, dry_run, printer):
    total = 0
    for a, b in chunks:
        p = dict(params, chunk_from=a, chunk_to=b)
        if dry_run:
            printer('-- %s %s..%s\n%s;' % (name, a, b, common.Reader.substitute(sql, p).replace(uid, '<uid>')))
            continue
        total += int(reader.read(sql, p, tag=name)[0]['n'])
    return total


def _json(v):
    return json.loads(v) if isinstance(v, str) else v


def integrity(row, deployed):
    """M10_integrity: guard triggers firing ALWAYS, and bodies that differ from the deployed md5s."""
    md5s = _json(row.get('md5s')) or {}
    drifted = sorted(n for n, m in md5s.items() if deployed.get(n) and deployed[n] != m) if deployed else None
    return {'always_on': int(row.get('always_on') or 0), 'total': int(row.get('total') or 0), 'drifted': drifted,
            'bodies': len(md5s), 'md5_basis': 'deployed_md5s' if deployed else 'no deployed md5s file: not compared'}


def integrity_failed(m):
    """The stop condition (PLAN section 5): fewer guard triggers firing ALWAYS than deployed, or a drifted body."""
    if not isinstance(m, dict) or 'error' in m:
        return None
    want = payloads.C['guard_triggers']
    if m['always_on'] < want or m['always_on'] != m['total']:
        return '%d of %d guard triggers fire ALWAYS (want %d)' % (m['always_on'], m['total'], want)
    if m.get('drifted'):
        return 'bodies differ from the deployed md5s: %s' % ', '.join(m['drifted'])
    return None


def run(reader, uid, vehicle, statements=None, dry_run=False, printer=print, only=None, manifest_dir=None,
        since=None, deployed_md5s=None):
    since = since or common.iso_utc(common.utc_now() - dt.timedelta(hours=24))
    params = {'uid': uid, 'vehicle_id': vehicle, 'window_from': WINDOW[0], 'window_to': WINDOW[1], 'since': since}
    out = {}
    statements = statements or parse()
    if not dry_run:
        active = reader.read("select left(query, 80) q from pg_stat_activity where state = 'active' and "
                             "pid <> pg_backend_pid() and query like '%evidence-scoreboard%' "
                             "and query not like '%pg_stat_activity%'", tag='scoreboard_dupes')
        if active:
            raise common.StopLoop('scoreboard_already_running', '%d active scoreboard statement(s)' % len(active))
    by = {n: (m, s) for n, m, s in statements}
    for name, mode, sql in statements:
        if name in ('M12_merged_ids', 'M12_claimed_vehicle_ids') or name.endswith('_pre') or \
                (only and name not in only):
            continue
        sql = MARK + sql
        try:
            if mode == 'chunked':
                chunks = quarters()
                try:
                    total = chunked(reader, sql, params, chunks, name, uid, dry_run, printer)
                    basis = None
                except common.ReadError as e:
                    if '42P01' not in str(e) or name + '_pre' not in by:
                        raise
                    # the evidence store is not deployed yet: the pre-store form (taken_at alone), as the baseline
                    total = chunked(reader, MARK + by[name + '_pre'][1], params, chunks, name + '_pre', uid, dry_run,
                                    printer)
                    basis = 'pre-store: taken_at alone (v_image_capture_time not deployed)'
                out[name] = {'value': total, 'chunks': len(chunks)}
                if basis:
                    out[name]['basis'] = basis
            elif mode == 'ids':
                if dry_run:
                    printer('-- %s (per 50 merged ids an active claim names)\n%s;' % (name, sql))
                    continue
                merged = {r['id'] for r in reader.read(MARK + by['M12_merged_ids'][1], {}, tag='M12_merged_ids')}
                claimed = {r['vehicle_id'] for r in reader.read(MARK + by['M12_claimed_vehicle_ids'][1], {},
                                                                tag='M12_claimed')}
                ids = sorted(merged & claimed)
                total = 0
                for k in range(0, len(ids), 50):
                    total += int(reader.read(sql, dict(params, ids=ids[k:k + 50]), tag=name)[0]['n'])
                out[name] = {'value': total, 'merged_vehicle_ids': len(merged), 'named_by_a_claim': len(ids)}
            elif mode == 'manifest':
                if dry_run:
                    printer('-- %s (matched against the manifest)\n%s;' % (
                        name, common.Reader.substitute(sql, params).replace(uid, '<uid>')))
                    continue
                created = {r['t']: _json(r['x']) for r in reader.read(sql, params, tag=name)}
                lines = manifest.load(manifest_dir or common.MANIFEST_DIR, since)
                out[name] = dict(manifest.reconcile(created, lines), since=since)
            else:
                if dry_run:
                    printer('-- %s\n%s;' % (name, common.Reader.substitute(sql, params).replace(uid, '<uid>')))
                    continue
                rows = reader.read(sql, params, tag=name)
                if name == 'M2' and rows:
                    w, n = int(rows[0]['wrong'] or 0), int(rows[0]['decided'] or 0)
                    out[name] = {'wrong': w, 'decided': n, 'rate': round(w / n, 4) if n else None,
                                 'wilson95': wilson(w, n)}
                elif name == 'M5':
                    out[name] = _json(rows[0].get('m5')) if rows else None
                elif name == 'M10_integrity' and rows:
                    out[name] = integrity(rows[0], deployed_md5s)
                else:
                    out[name] = {'rows': rows}
        except (common.ReadError, common.EvidenceError) as e:
            out[name] = {'error': str(e)[:300]}
    return out


def scalar(v):
    if isinstance(v, dict) and 'value' in v:
        return v['value']
    if isinstance(v, dict) and 'unmanifested' in v:
        return v['unmanifested']
    if isinstance(v, dict) and 'rate' in v:
        return v['rate']
    return None


def diff(prev, cur):
    out = {}
    for k, v in cur.items():
        a, b = scalar((prev or {}).get(k)), scalar(v)
        if a is not None or b is not None:
            out[k] = {'previous': a, 'now': b, 'change': (b - a) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else None}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--user')
    ap.add_argument('--vehicle', required=True, help='the exit-test vehicle (M5)')
    ap.add_argument('--out-dir', default=str(common.LOOP_DIR))
    ap.add_argument('--date')
    ap.add_argument('--dry-run', action='store_true', help='print the statements (owner id shown as <uid>); no reads')
    ap.add_argument('--gap', type=float, help='seconds between reads (default EVIDENCE_READ_GAP_S or 60)')
    ap.add_argument('--only', nargs='*', help='measures to run (default: all)')
    ap.add_argument('--m10b-hours', type=float, default=24, help='M10b window (rows created in the last N hours)')
    ap.add_argument('--manifest-dir', default=str(common.MANIFEST_DIR))
    ap.add_argument('--deployed-md5s', default=str(common.LOOP_DIR / 'deployed_md5s.json'))
    a = ap.parse_args()
    uid = common.owner_id(a.user)
    if not common.is_uuid(a.vehicle):
        raise SystemExit('--vehicle must be a uuid')
    if a.dry_run:
        run(None, uid, a.vehicle, dry_run=True)
        return 0
    reader = common.Reader(min_gap=a.gap)
    date = a.date or common.today()
    deployed = common.load_json(a.deployed_md5s) if os.path.exists(a.deployed_md5s) else None
    since = common.iso_utc(common.utc_now() - dt.timedelta(hours=a.m10b_hours))
    try:
        measures = run(reader, uid, a.vehicle, only=a.only, manifest_dir=a.manifest_dir, since=since,
                       deployed_md5s=deployed)
    except common.StopLoop as e:
        common.eprint('STOP: %s' % e)
        return 3
    prev_files = sorted(p for p in glob.glob(os.path.join(a.out_dir, 'scoreboard-*.json'))
                        if os.path.basename(p) < 'scoreboard-%s.json' % date)
    prev = common.load_json(prev_files[-1])['measures'] if prev_files else None
    rec = {'date': date, 'taken': common.iso_utc(common.utc_now()), 'params': {'uid': '<uid>', 'vehicle_id': a.vehicle,
           'window': list(WINDOW), 'chunks': 'taken_at quarters'}, 'measures': measures,
           'diff': diff(prev, measures), 'previous': os.path.basename(prev_files[-1]) if prev_files else None}
    path = os.path.join(a.out_dir, 'scoreboard-%s.json' % date)
    common.dump_json(path, rec)
    print('scoreboard -> %s' % path)
    for k, v in rec['diff'].items():
        print('  %-6s %s -> %s' % (k, v['previous'], v['now']))
    return 0


if __name__ == '__main__':
    sys.exit(main())

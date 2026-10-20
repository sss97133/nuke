"""Exit test (PLAN pilot step 8, section 6 M5): assert a fixture of ids against the vehicle_accounting_evidence read.

file mode  the read is readers.accounting() over the payload files (every row proposed; capture times confirmed the
           way the writer confirms them). Confirmed-level assertions are also evaluated with the decisions they name
           (the owner's answer, simulated) and reported as simulated.
db mode    the read is `select public.vehicle_accounting_evidence(<vehicle>, NULL, NULL, <owner>)` through q.sh (v5:
           the reader is keyed by user, so a service-role read equals his own); database ids are mapped back to line
           keys through the loader's manifest. The result is stored as an exit_test run (evidence_open_run +
           evidence_close_run, per-assertion results, ids only).
(v5, RD4-10) Assertions read the JSON keys the fixture names in the full read, not only the M5 tuples.

Results: pass, fail, open (an owner answer is still missing), blocked (the fixture names what blocks it).
"Structural pass" = every evidence-level assertion that is not blocked passes.

Fixture: {"vehicle_id", "assertions": [{"id", "level": "evidence"|"confirmed", "expect": {...}, "decisions": [...],
"blocked_on", "note"}]}. Expect keys: identity_contains, identity_excludes, claim, open_question,
open_question_refs, contradictions, custody, work_days_exact, not_in_work_days, not_in_outside, outside_contains,
payment_keys_once, band_of, not_summed, band_keys_exact, bands_exact, payment_links_contain, other_vehicles,
unpaid_labels_contain, unpaid_refs_contain, unpaid_refs_exact, unpaid_refs_exclude, read_keys_absent,
work_performed_contains, listings_exact, sale_trade_in, income_contains (v5: [payment_key, band, from_account_ref,
to_account_ref, payer, payee]), outside tuples [day, side, own_photos, document_photos], open_question_values
({q: {field: [values]}}), read_equals ({"a.b": value}), read_contains ({"a.b": [items]}), photos_items_total,
image_class_count, counts. None inside a tuple matches anything.

Usage: python3 scripts/evidence/exit_test.py --fixture <exit-expected.json> --dir <payload dir> [--mode file|db]
       [--case <case.json>] [--user <owner>]
"""
import argparse
import collections
import json
import os
import sys
from pathlib import Path

import common
import payloads
import readers

SUMMED = ('confirmed', 'high', 'med', 'low')


def _match(want, got):
    return len(want) == len(got) and all(w is None or w == g for w, g in zip(want, got))


def _contains(rows, want):
    return any(_match(want, r) for r in rows)


def at(read, path):
    """The value at a dotted path of the read ('custody.acquired_by', 'money_sources_cover_to')."""
    cur = read
    for part in path.split('.'):
        if isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _has(items, want):
    if isinstance(want, dict):
        return any(isinstance(x, dict) and all(x.get(k) == v for k, v in want.items()) for x in items or [])
    return want in (items or [])


def evaluate(expect, m5, read, files):
    """-> (ok, detail) for one assertion's expect block."""
    fails = []
    bands = m5['bands']
    band_of = {pk: b for b, pks in bands.items() for pk in pks if pk and pk.split(':', 1)[0] in
               ('bank', 'ledger', 'payment_event', 'qb', 'owner')}
    oq = m5['open_questions']
    for k, e in expect.items():
        if k == 'identity_contains':
            if not set(e) <= set(m5['identity'] or []):
                fails.append('identity %s lacks %s' % (m5['identity'], sorted(set(e) - set(m5['identity'] or []))))
        elif k == 'identity_excludes':
            if set(e) & set(m5['identity'] or []):
                fails.append('identity holds %s' % sorted(set(e) & set(m5['identity'])))
        elif k == 'claim':
            c = m5['claims'].get(e['key'])
            if not c:
                fails.append('no live %s claim %s' % (e.get('kind'), e['key']))
                continue
            for f2, f1 in (('from', 'occurred_from'), ('to', 'occurred_to'), ('kind', 'kind'),
                           ('related_vehicle_id', 'related_vehicle_id')):
                if f2 in e and c.get(f1) != e[f2]:
                    fails.append('%s %s=%r, want %r' % (e['key'], f1, c.get(f1), e[f2]))
            if 'trade_in_set' in e and (c.get('trade_in_cents') is not None) != e['trade_in_set']:
                fails.append('%s trade_in_cents set=%s' % (e['key'], c.get('trade_in_cents') is not None))
            sup = {(s['id'], s['stance'], s['about']) for s in c.get('support') or []}
            for key, about in e.get('supports', []):
                if (key, 'supports', about) not in sup:
                    fails.append('%s lacks support %s about %s' % (e['key'], key, about))
            for key, about in e.get('contradicts', []):
                if (key, 'contradicts', about) not in sup:
                    fails.append('%s lacks contradiction %s about %s' % (e['key'], key, about))
            kinds = collections.Counter(s['kind'] for s in c.get('support') or [] if s['stance'] == 'supports')
            for kind, n in (e.get('supports_kind_count') or {}).items():
                if kinds.get(kind, 0) != n:
                    fails.append('%s has %d %s supports, want %d' % (e['key'], kinds.get(kind, 0), kind, n))
        elif k == 'open_question':
            hit = [q for q in oq if q.get('q') == e['q']
                   and ('claim_key' not in e or q.get('claim_id') == e['claim_key'])
                   and ('payment_key' not in e or q.get('payment_key') == e['payment_key'])
                   and ('account_ref' not in e or q.get('account_ref') == e['account_ref'])]
            if not hit:
                fails.append('no open question %s' % e)
        elif k == 'open_question_refs':
            got = sorted(q.get('account_ref') for q in oq if q.get('q') == e['q'])
            if got != sorted(e['account_refs']):
                fails.append('%s refs %s' % (e['q'], got))
        elif k == 'contradictions':
            got = {q['claim_id']: sorted(q.get('about') or []) for q in oq if q.get('q') == 'contradiction'}
            if got != {a: sorted(b) for a, b in e.items()}:
                fails.append('contradictions %s' % got)
        elif k == 'custody':
            cu = m5['custody'] or {}
            bad = {f: cu.get(f) for f in e if cu.get(f) != e[f]}
            if bad:
                fails.append('custody %s' % bad)
        elif k == 'work_days_exact':
            if m5['work_days'] != e:
                fails.append('work_days %s' % m5['work_days'])
        elif k == 'not_in_work_days':
            if set(e) & set(m5['work_days']):
                fails.append('in work_days: %s' % sorted(set(e) & set(m5['work_days'])))
        elif k == 'not_in_outside':
            od = {x[0] for x in m5['outside']}
            if set(e) & od:
                fails.append('in photo_days_outside_custody: %s' % sorted(set(e) & od))
        elif k == 'outside_contains':
            for w in e:
                if not _contains(m5['outside'], w):
                    fails.append('outside lacks %s (got %s)' % (w, m5['outside']))
        elif k == 'days_anywhere':
            alld = set(m5['work_days']) | {x[0] for x in m5['outside']} | set(m5['custody_unknown_days'])
            if not set(e) <= alld:
                fails.append('days missing: %s' % sorted(set(e) - alld))
        elif k == 'payment_keys_once':
            allpk = [pk for b, pks in bands.items() if b != 'asserted_unpaid' for pk in pks]
            dup = sorted(pk for pk, n in collections.Counter(allpk).items() if n > 1)
            if dup:
                fails.append('payment keys in two bands: %s' % dup)
        elif k == 'band_of':
            for pk, b in e.items():
                if band_of.get(pk) != b:
                    fails.append('%s is %s, want %s' % (pk, band_of.get(pk), b))
        elif k == 'not_summed':
            for pk in e:
                if band_of.get(pk) in SUMMED:
                    fails.append('%s is summed (%s)' % (pk, band_of.get(pk)))
        elif k == 'band_keys_exact':
            got = sorted(pk for b in e['bands'] for pk in bands.get(b, []))
            if got != sorted(e['keys']):
                fails.append('bands %s: extra %s missing %s' % ('/'.join(e['bands']), sorted(set(got) - set(e['keys'])),
                                                                sorted(set(e['keys']) - set(got))))
        elif k == 'bands_exact':
            for b, pks in e.items():
                if sorted(bands.get(b, [])) != sorted(pks):
                    fails.append('band %s = %s' % (b, sorted(bands.get(b, []))))
        elif k == 'other_vehicles':
            for pk, want in e.items():
                got = sorted(m5['other_vehicles'].get(pk) or [])
                if got != sorted(want):
                    fails.append('%s other_vehicles %s' % (pk, got))
        elif k == 'unpaid_refs_exact':
            if sorted(m5['unpaid_refs']) != sorted(e):
                fails.append('asserted_unpaid refs %s' % sorted(m5['unpaid_refs']))
        elif k == 'unpaid_refs_exclude':
            if set(e) & set(m5['unpaid_refs']):
                fails.append('asserted_unpaid holds %s' % sorted(set(e) & set(m5['unpaid_refs'])))
        elif k == 'open_question_values':
            for q, fields in e.items():
                for fld, want in fields.items():
                    got = sorted(str(x.get(fld)) for x in oq if x.get('q') == q)
                    if got != sorted(str(w) for w in want):
                        fails.append('open questions %s.%s = %s' % (q, fld, got))
        elif k == 'read_equals':
            for path, want in e.items():
                if at(read, path) != want:
                    fails.append('%s = %r, want %r' % (path, at(read, path), want))
        elif k == 'read_contains':
            for path, wants in e.items():
                for w in wants:
                    if not _has(at(read, path), w):
                        fails.append('%s lacks %s' % (path, w))
        elif k == 'photos_items_total':
            got = sum(int(x.get('items') or 0) for x in read.get('photos_items_not_in_nuke') or [])
            if got != e:
                fails.append('photos_items_not_in_nuke total %d, want %d' % (got, e))
        elif k == 'payment_links_contain':
            for pk, refs in e.items():
                got = set(m5['band_links'].get(pk) or [])
                if not set(refs) <= got:
                    fails.append('%s links lack %s' % (pk, sorted(set(refs) - got)))
        elif k == 'unpaid_labels_contain':
            if not set(e) <= set(m5['unpaid_labels']):
                fails.append('asserted_unpaid labels lack %s' % sorted(set(e) - set(m5['unpaid_labels'])))
        elif k == 'unpaid_refs_contain':
            if not set(e) <= set(m5['unpaid_refs']):
                fails.append('asserted_unpaid refs lack %s' % sorted(set(e) - set(m5['unpaid_refs'])))
        elif k == 'read_keys_absent':
            if set(e) & set(m5['keys']):
                fails.append('read carries %s' % sorted(set(e) & set(m5['keys'])))
        elif k == 'work_performed_contains':
            for w in e:
                if not _contains(m5['work_performed'], w):
                    fails.append('work_performed lacks %s (got %s)' % (w, m5['work_performed']))
        elif k == 'listings_exact':
            if sorted(m5['listings']) != sorted(e):
                fails.append('listings %s' % m5['listings'])
        elif k == 'sale_trade_in':
            if m5['sale_trade_in'] != e:
                fails.append('sale trade-in %s' % m5['sale_trade_in'])
        elif k == 'income_contains':
            for w in e:
                if not _contains(m5['income'], w):
                    fails.append('income lacks %s (got %s)' % (w, m5['income']))
        elif k == 'image_class_count':
            got = collections.Counter((ln['row'].get('image_class') or 'own') for ln in files.get('candidates.combined.jsonl', []))
            for cls, n in e.items():
                if got.get(cls, 0) != n:
                    fails.append('%d combined rows of class %s, want %d' % (got.get(cls, 0), cls, n))
        elif k == 'counts':
            for f, n in e.items():
                if len(files.get(f, [])) != n:
                    fails.append('%s has %d lines, want %d' % (f, len(files.get(f, [])), n))
        else:
            fails.append('unknown expectation %s' % k)
    return (not fails), '; '.join(fails)


def remap(obj, inv):
    """Replace database ids with line keys (db mode) throughout a read."""
    if isinstance(obj, dict):
        return {k: remap(v, inv) for k, v in obj.items()}
    if isinstance(obj, list):
        return [remap(v, inv) for v in obj]
    if isinstance(obj, str) and obj in inv:
        return inv[obj]
    return obj


def run(fixture, files, read_fn, mode=common.FILE):
    """read_fn(decisions) -> a read; returns the per-assertion results and a summary."""
    base = read_fn(None)
    m5 = readers.extract_m5(base)
    out = []
    for a in fixture['assertions']:
        res = {'id': a['id'], 'level': a.get('level', 'evidence')}
        if a.get('blocked_on'):
            ok, detail = evaluate(a['expect'], m5, base, files)
            res.update(result='pass' if ok else 'blocked', detail=detail if not ok else '',
                       blocked_on=a['blocked_on'])
        elif res['level'] == 'evidence':
            ok, detail = evaluate(a['expect'], m5, base, files)
            res.update(result='pass' if ok else 'fail', detail=detail)
        else:
            res['result'] = 'open'
            res['owner_question'] = a.get('owner_question')
            if mode == common.FILE and a.get('decisions'):
                sim = read_fn(a['decisions'])
                ok, detail = evaluate(a['expect'], readers.extract_m5(sim), sim, files)
                res['simulated'] = 'pass' if ok else 'fail'
                if not ok:
                    res['detail'] = detail
            ev = a.get('evidence_level_expect')
            if ev:
                ok, detail = evaluate(ev, m5, base, files)
                res['evidence_level'] = 'pass' if ok else 'fail: ' + detail
        out.append(res)
    c = collections.Counter(r['result'] for r in out)
    structural = all(r['result'] in ('pass', 'blocked') for r in out if r['level'] == 'evidence')
    sims = collections.Counter(r.get('simulated') for r in out if r.get('simulated'))
    return out, {'pass': c['pass'], 'fail': c['fail'], 'open': c['open'], 'blocked': c['blocked'],
                 'structural_pass': structural, 'simulated_confirmed': dict(sims)}


def db_read(vehicle, uid, manifest_path, reader=None):
    """The one read, keyed by the owner (v5: p_user_id is the 4th argument)."""
    reader = reader or common.Reader()
    rows = reader.read('select public.vehicle_accounting_evidence(:vehicle, NULL, NULL, :uid) v',
                       {'vehicle': vehicle, 'uid': uid}, tag='exit_test')
    v = rows[0]['v'] if rows else None
    if isinstance(v, str):
        v = json.loads(v)
    inv = {}
    if manifest_path and os.path.exists(manifest_path):
        inv = {i: k for k, i in (common.load_json(manifest_path).get('ids') or {}).items()}
    return remap(v, inv)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--fixture', required=True)
    ap.add_argument('--dir', required=True, help='payload dir (file mode: the read is computed from it)')
    ap.add_argument('--mode', choices=[common.FILE, common.DB], default=common.FILE)
    ap.add_argument('--vehicle', help='defaults to the fixture vehicle_id')
    ap.add_argument('--manifest', help='db mode: the loader manifest (key -> id)')
    ap.add_argument('--decisions', help='file mode: decisions applied to every read')
    ap.add_argument('--out', help='results file (default <dir>/exit-test-<date>.json)')
    ap.add_argument('--user', help='db mode: owner uuid')
    ap.add_argument('--case', help='file mode: the case file (its work sessions feed session_days)')
    a = ap.parse_args()
    fx = common.load_json(a.fixture)
    vehicle = a.vehicle or fx['vehicle_id']
    files = readers.load_files(a.dir)
    extra = common.load_json(a.decisions) if a.decisions else []
    sessions = readers.sessions_of(common.Context(a.case, a.dir)) if a.case else None
    if a.mode == common.FILE:
        def read_fn(dec):
            return readers.accounting(files, vehicle, extra + (dec or []), sessions=sessions)
    else:
        common.require_db_writes()
        snap = db_read(vehicle, common.owner_id(a.user), a.manifest or os.path.join(a.dir, 'load-manifest.json'))

        def read_fn(_dec):
            return snap
    results, summary = run(fx, files, read_fn, a.mode)
    rec = {'mode': a.mode, 'vehicle_id': vehicle, 'fixture_sha256': common.sha256_bytes(Path(a.fixture).read_bytes()),
           'at': common.iso_utc(common.utc_now()), 'summary': summary, 'results': results}
    if a.mode == common.DB:
        rest = common.Rest()
        uid = common.owner_id(a.user)
        run_id = rest.rpc('evidence_open_run', payloads.open_run(
            uid, 'exit_test', 'exit_test', common.producer('exit_test.py'), common.code_version(),
            {'fixture_sha256': rec['fixture_sha256'], 'vehicle_id': vehicle}))
        rest.rpc('evidence_close_run', payloads.close_run(run_id, 'done', {'summary': summary, 'results': [
            {k: r.get(k) for k in ('id', 'level', 'result')} for r in results]}))
        rec['run_id'] = run_id
    out = a.out or os.path.join(a.dir, 'exit-test-%s.json' % common.today())
    common.dump_json(out, rec)
    for r in results:
        print('  %-28s %-8s%s%s' % (r['id'], r['result'], (' simulated=' + r['simulated']) if r.get('simulated') else '',
                                    ('  ' + r['detail']) if r.get('detail') else ''))
    print('summary: %s' % json.dumps(summary))
    return 0 if summary['structural_pass'] else 1


if __name__ == '__main__':
    sys.exit(main())

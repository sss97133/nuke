#!/usr/bin/env python3
"""Offline contracts for the image-evidence runner: every pass in file mode on synthetic K30-shaped inputs (no real
id, amount, path or name), the v3 CHECK rules, the exit test against the file-mode read, the loader's batching and
gates, db-mode refusal and stop conditions against a fake PostgREST, the pinned-source refusals, promotion guards,
review answers, the scoreboard SQL and the read path. No network, no database, no Photos library.

Run: python3 scripts/evidence/test_evidence.py
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import checks  # noqa: E402
import common  # noqa: E402
import dbops  # noqa: E402
import exit_test  # noqa: E402
import loader  # noqa: E402
import loop  # noqa: E402
import money  # noqa: E402
import passlib  # noqa: E402
import payloads  # noqa: E402
import photos_join  # noqa: E402
import promote  # noqa: E402
import readers  # noqa: E402
import record_answers  # noqa: E402
import repin  # noqa: E402
import review_sheet  # noqa: E402
import scoreboard  # noqa: E402
import testdata  # noqa: E402

EXPECTED = {'time_claims.jsonl': 133, 'links.album.jsonl': 1, 'candidates.photos_album.jsonl': 99,
            'candidates.combined.jsonl': 133, 'day_context.jsonl': 23, 'account_entities.jsonl': 3,
            'candidates.listing_class.jsonl': 1006,
            # v2's 42 links, less the ledger->second-truck copy of the painter line, plus the P&L allocation of it,
            # the job allocation of the 00737 analogue (subject_key) and the Messages contradicts link
            'links.jsonl': 44,
            # v2's 7 claims plus the painter's work_performed claim
            'change_claims.jsonl': 8}


def build(case_path, out):
    ctx = common.Context(case_path, out, user_id=testdata.OWNER)
    payloads.use_contract(ctx.contract)
    built = passlib.build_all(ctx)
    counts = passlib.write_built(ctx, built, ctx.user_id)
    return ctx, built, counts


class SyntheticCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='evidence-test-')
        cls.td = testdata.make_case(os.path.join(cls.tmp, 'case'))
        cls.out = os.path.join(cls.tmp, 'out')
        cls.ctx, cls.built, cls.counts = build(cls.td['case'], cls.out)
        cls.files = readers.load_files(cls.out)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        payloads.use_contract(payloads.CONTRACT)


class PassCounts(SyntheticCase):
    def test_counts_match_the_k30_file_mode_run(self):
        self.assertEqual({f: self.counts.get(f, 0) for f in EXPECTED}, EXPECTED)

    def test_time_claims_all_machine_confirmable(self):
        rep = checks.validate_dir(self.out, self.ctx, money.Sources(self.ctx))
        self.assertEqual(rep.would_confirm, 133)

    def test_every_payload_passes_the_v3_checks(self):
        rep = checks.validate_dir(self.out, self.ctx, money.Sources(self.ctx))
        self.assertEqual(rep.total, 0, json.dumps(rep.as_dict()['by_file'], indent=1)[:3000])

    def test_runs_cover_every_pass_with_lines(self):
        run = common.load_json(os.path.join(self.out, 'run.json'))
        passes = {r['args']['p_pass'] for r in run['runs']}
        used = {ln['p_run_id'][5:] for f in self.files for ln in self.files[f]}
        self.assertLessEqual(used, passes)
        self.assertIn('pnl_allocation', passes)
        self.assertIn('messages_mention', passes)
        self.assertEqual(run['config']['user_id'], testdata.OWNER)
        self.assertTrue(all(r['args']['p_user_id'] == '@config.user_id' for r in run['runs']))

    def test_v3_shapes(self):
        links = self.files['links.jsonl'] + self.files['links.album.jsonl']
        roles = {ln['row']['role'] for ln in links}
        self.assertLessEqual(roles, set(payloads.CONTRACT['roles']))
        self.assertFalse(any('account_ref' in ln['row'] for ln in links))
        self.assertFalse(any(ln['row'].get(f) == 'unknown' for ln in links for f in ('payer_entity', 'payee_entity')))
        cats = {ln['row'].get('cost_category') for ln in links} - {None}
        self.assertLessEqual(cats, set(payloads.CONTRACT['cost_categories']))
        for ln in links:
            for f in ('amount_cents', 'allocated_cents'):
                v = ln['row'].get(f)
                self.assertTrue(v is None or str(v).startswith('@amount:'), ln['key'])
        pnl = [ln for ln in links if ln['row']['source_kind'] == 'pnl_line']
        self.assertEqual(len(pnl), 2)
        job = [ln for ln in pnl if ln['row'].get('subject_key')]
        self.assertEqual(job[0]['row']['subject_key'], 'label:JOB-K10')
        self.assertNotIn('vehicle_id', job[0]['row'])
        msg = [ln for ln in links if ln['row']['role'] == 'contradicts' and ln['row'].get('payment_key')]
        self.assertEqual(len(msg), 1)
        unjoined = [ln for ln in links if ln['row']['source_kind'] == 'gmail_order' and ln['row']['role'] == 'assertion']
        self.assertEqual(len(unjoined), 2)
        self.assertFalse(any('amount_cents' in ln['row'] or 'payment_key' in ln['row'] for ln in unjoined))
        card = [ln for ln in links if ln['row'].get('transaction_on')]
        self.assertTrue(card)
        claims = {ln['key']: ln['p_claim'] for ln in self.files['change_claims.jsonl']}
        wp = [c for c in claims.values() if c['kind'] == 'work_performed'][0]
        self.assertEqual((wp['party_entity'], wp['occurred_from'], wp['occurred_to']),
                         ('third_party:painter', '2031-05-11', '2031-05-11'))
        trade = claims['claim:acquisition:%s' % testdata.V['TRADE'][:8]]
        self.assertTrue(trade['asserted_value']['trade_in_acv_cents'].startswith('@amount:'))
        self.assertNotIn('amount_cents', trade)
        for ln in self.files['time_claims.jsonl']:
            self.assertEqual(ln['row']['offset_seconds'] % 3600, 0)

    def test_no_message_text_and_no_owner_id_outside_config(self):
        blob = ''.join(Path(self.out, f).read_text() for f in os.listdir(self.out) if f.endswith('.jsonl'))
        self.assertNotIn('synthetic text', blob)
        self.assertNotIn(testdata.OWNER, blob)

    def test_listing_keepers_follow_the_dedupe_rule(self):
        rows = self.files['candidates.listing_class.jsonl']
        copies = sum(len([e for e in ln['row']['evidence'] if e['kind'] == 'url_copies_on_vehicle'][0]['duplicate_row_ids'])
                     for ln in rows)
        self.assertEqual(copies, 4534 - 1006)
        first = [ln for ln in rows if ln['row']['confidence'] == 0.98]
        self.assertEqual(len(first), 502)

    def test_custody_bounds_leaves_a_vehicle_with_claims_alone(self):
        self.assertTrue(any('acquisition claim present' in n for n in self.ctx.notes))


class Validator(SyntheticCase):
    def planted(self, mutate):
        d = os.path.join(self.tmp, 'planted')
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(self.out, d)
        p = os.path.join(d, 'links.jsonl')
        lines = common.read_jsonl(p)
        mutate(lines)
        common.write_jsonl(p, lines)
        return checks.validate_dir(d, self.ctx, money.Sources(self.ctx))

    def assertCaught(self, mutate, needle):
        rep = self.planted(mutate)
        msgs = [m for v in rep.by_file.values() for m in v]
        self.assertTrue(any(needle in m for m in msgs), '%s not in %s' % (needle, msgs[:5]))

    def test_amount_written_as_a_number(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(amount_cents=12010), 'must be an @amount: placeholder')

    def test_amount_text_in_a_summary(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(summary='paid 120.10 for glass'), 'input amount')

    def test_v2_role_and_account_ref(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(role='cost'), 'role')
        self.assertCaught(lambda ls: ls[0]['row'].update(account_ref='bank_account:x'), 'account_ref is v2')

    def test_literal_unknown_entity(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(payer_entity='unknown'), 'blocks the account map')

    def test_contact_details_and_owner_id(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(summary='call 702-555-0100'), 'phone number')
        self.assertCaught(lambda ls: ls[0]['row'].update(summary='mail a@example.test'), 'e-mail')
        self.assertCaught(lambda ls: ls[0]['row'].update(summary=testdata.OWNER), 'owner id outside')
        self.assertCaught(lambda ls: ls[0]['row'].update(summary='from FOR-SIGNING folder'), 'refused private path')
        self.assertCaught(lambda ls: ls[0]['row'].update(summary='Zorblat said so'), "person's name")

    def test_unresolved_placeholder_and_scope(self):
        self.assertCaught(lambda ls: ls[0]['row']['evidence'].append({'ref': '@key:nowhere'}), 'unresolved placeholder')
        self.assertCaught(lambda ls: ls[0]['row'].update(vehicle_id=testdata.U('vehicle', 'stranger')), 'not in scope')
        self.assertCaught(lambda ls: ls[0]['row'].update(cost_category='own_labour'), 'physical kinds only')


class ExitTest(SyntheticCase):
    def results(self):
        fx = common.load_json(self.td['fixture'])
        return exit_test.run(fx, self.files, lambda dec: readers.accounting(self.files, fx['vehicle_id'], dec))

    def test_structural_pass_with_the_job_allocation_blocked(self):
        res, summary = self.results()
        by = {r['id']: r for r in res}
        self.assertTrue(summary['structural_pass'], [r for r in res if r['result'] == 'fail'])
        self.assertEqual(summary['fail'], 0)
        self.assertEqual(by['job_contested']['result'], 'blocked')        # a subject_key link never contests
        self.assertEqual(by['painter_contested']['result'], 'pass')
        self.assertEqual(by['disputed']['result'], 'pass')

    def test_confirmed_level_simulated_from_the_answers(self):
        res, summary = self.results()
        by = {r['id']: r for r in res}
        self.assertEqual(by['painter_answered']['result'], 'open')
        self.assertEqual(by['painter_answered']['simulated'], 'pass')
        self.assertEqual(by['identity_pair_confirmed']['simulated'], 'pass')

    def test_m5_extraction_keys(self):
        v = readers.accounting(self.files, testdata.V['TRUCK'])
        m5 = readers.extract_m5(v)
        self.assertEqual(m5['work_days'], sorted(testdata.ALBUM_DAYS))
        self.assertNotIn('own_labour_asserted', v)
        self.assertEqual(v['costs']['contested']['cents'], None)


class Loader(SyntheticCase):
    def test_file_plan_batches_and_dedupe_gate(self):
        ld = loader.Loader(self.ctx, common.FILE)
        ld.load_dir(self.out)
        man = ld.manifest()
        self.assertLessEqual(man['max_rows_in_a_call'], 500)
        self.assertEqual(man['skipped_by_reason'], {'dedupe_pending': 1006})
        writers = [c['writer'] for c in ld.calls]
        self.assertEqual(writers[:len(common.load_json(os.path.join(self.out, 'run.json'))['runs'])],
                         ['evidence_open_run'] * len(common.load_json(os.path.join(self.out, 'run.json'))['runs']))
        self.assertLess(max(i for i, w in enumerate(writers) if w == 'propose_evidence_links'),
                        min(i for i, w in enumerate(writers) if w == 'propose_change_claim'))

    def test_listing_waits_for_the_dedupe_then_drops_copies(self):
        d = os.path.join(self.tmp, 'dedupe-case')
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(os.path.dirname(self.td['case']), d)
        Path(d, 'dedupe_done.txt').write_text(testdata.V['TRUCK'] + '\n')
        rows = common.load_json(os.path.join(d, 'listing_rows.json'))
        keepers = [ln['row']['image_id'] for ln in self.files['candidates.listing_class.jsonl']][:3]
        for r in rows:
            if r['id'] in keepers:
                r['dup'] = True                              # the dedupe marked them after the files were built
        common.dump_json(os.path.join(d, 'listing_rows.json'), rows)
        ctx = common.Context(os.path.join(d, 'case.json'), self.out, user_id=testdata.OWNER)
        ld = loader.Loader(ctx, common.FILE)
        ld.load_dir(self.out)
        man = ld.manifest()
        self.assertEqual(man['skipped_by_reason'], {'is_duplicate_now': 3})
        sizes = [c['rows'] for c in ld.calls if c.get('file') == 'candidates.listing_class.jsonl']
        self.assertEqual(sizes, [497, 500, 6])


class FakeRest:
    """Stands in for PostgREST: answers each writer the way draft.sql does, records every call."""

    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail or {}
        self.n = 0

    def rpc(self, fn, args):
        self.calls.append((fn, args))
        if fn in self.fail:
            raise self.fail[fn]
        self.n += 1
        new = '00000000-0000-4000-8000-%012d' % self.n
        if fn in ('evidence_open_run', 'propose_change_claim', 'record_promotion_failure'):
            return new
        if fn == 'propose_image_candidates':
            return {'proposed': len(args['p_rows']), 'items': [
                {'image_id': r['image_id'], 'result': 'proposed', 'candidate_id': '%s-%d' % (new, i)}
                for i, r in enumerate(args['p_rows'])]}
        if fn == 'propose_evidence_links':
            return {'proposed': len(args['p_rows']), 'items': [
                {'ref': payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'),
                                            r.get('anchor')), 'result': 'proposed', 'link_id': '%s-%d' % (new, i)}
                for i, r in enumerate(args['p_rows'])]}
        if fn in ('propose_capture_time_claims', 'record_day_context', 'propose_account_entities'):
            return {'proposed': len(args['p_rows'])}
        return {}


class FakeReader:
    def __init__(self, io_n=0, locks=0, watch=None):
        self.io_n, self.locks, self.watch_rows = io_n, locks, watch or []
        self.sql = []

    def read(self, sql, params=None, tag=None):
        self.sql.append((tag, sql))
        if tag == 'io_gate':
            return [{'n': self.io_n}]
        if tag == 'lock_check':
            return [{'n': self.locks}]
        if tag == 'daily_cap':
            return [{'n': 0}]
        if tag in ('revert_watch', 'repin_first'):
            return self.watch_rows
        return []


@mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'})
class DbMode(SyntheticCase):
    def loader(self, rest, reader=None):
        ctx = common.Context(self.td['case'], self.out, mode=common.DB, user_id=testdata.OWNER)
        payloads.use_contract(ctx.contract)
        return loader.Loader(ctx, common.DB, rest, reader or FakeReader(), sleep=lambda s: None)

    def test_amounts_resolve_only_in_memory_and_runs_close(self):
        rest = FakeRest()
        ld = self.loader(rest)
        ld.load_dir(self.out)
        sent = [a for fn, a in rest.calls if fn == 'propose_evidence_links']
        amts = [r['amount_cents'] for a in sent for r in a['p_rows'] if 'amount_cents' in r]
        self.assertTrue(amts and all(isinstance(x, int) for x in amts))
        opened = [fn for fn, _a in rest.calls if fn == 'evidence_open_run']
        closed = [a for fn, a in rest.calls if fn == 'evidence_close_run']
        self.assertEqual(len(closed), len(opened))
        self.assertTrue(all(c['p_status'] == 'done' for c in closed))
        self.assertTrue(all(len(a['p_rows']) <= 500 for fn, a in rest.calls if 'p_rows' in a))
        claim = [a for fn, a in rest.calls if fn == 'propose_change_claim'][0]
        self.assertTrue(all(common.is_uuid(s['evidence_id'][:36]) for s in claim['p_support']))

    def test_42501_stops_and_aborts_every_open_run(self):
        rest = FakeRest(fail={'propose_evidence_links': common.RpcError(
            'propose_evidence_links', 403, '42501', 'evidence writers: inspection jobs through the API only')})
        ld = self.loader(rest)
        with self.assertRaises(common.StopLoop) as cm:
            ld.load_dir(self.out)
        self.assertEqual(cm.exception.reason, 'writer_refused_42501')
        closed = [a for fn, a in rest.calls if fn == 'evidence_close_run']
        self.assertTrue(closed and all(c['p_status'] == 'aborted' for c in closed))
        self.assertEqual(closed[0]['p_counts']['stop_reason'], 'writer_refused_42501')

    def test_a_writer_error_closes_every_run_failed(self):
        rest = FakeRest(fail={'propose_evidence_links': common.RpcError(
            'propose_evidence_links', 400, '23514', 'new row violates check constraint')})
        with self.assertRaises(common.RpcError):
            self.loader(rest).load_dir(self.out)
        closed = [a for fn, a in rest.calls if fn == 'evidence_close_run']
        opened = [fn for fn, _a in rest.calls if fn == 'evidence_open_run']
        self.assertEqual(len(closed), len(opened))
        self.assertTrue(all(c['p_status'] == 'failed' for c in closed))

    def test_guard_and_io_pressure_stop(self):
        rest = FakeRest(fail={'propose_capture_time_claims': common.RpcError(
            'propose_capture_time_claims', 403, '42501', 'image_capture_time_claims: rows are written only by the '
                                                         'evidence writers through the API (session postgres)')})
        with self.assertRaises(common.StopLoop) as cm:
            self.loader(rest).load_dir(self.out)
        self.assertEqual(cm.exception.reason, 'guard_fired')
        clock = iter(range(0, 10000, 61))
        ld = self.loader(FakeRest(), FakeReader(io_n=7))
        ld.clock = lambda: next(clock)
        with self.assertRaises(common.StopLoop) as cm:
            ld.load_dir(self.out)
        self.assertEqual(cm.exception.reason, 'io_pressure')
        with self.assertRaises(common.StopLoop) as cm:
            self.loader(FakeRest(), FakeReader(locks=2)).load_dir(self.out)
        self.assertEqual(cm.exception.reason, 'lock_waiters_after_batch')


class DbGate(unittest.TestCase):
    def test_db_mode_refused_without_the_flag(self):
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '', 'SUPABASE_URL': 'https://example.test',
                                          'SUPABASE_SERVICE_ROLE_KEY': 'k' * 40}):
            with self.assertRaises(SystemExit) as cm:
                common.Rest()
            self.assertIn('db mode refused', str(cm.exception))

    def test_key_never_shown(self):
        key = 'synthetic-service-key-' + 'x' * 30
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1', 'SUPABASE_URL': 'https://example.test',
                                          'SUPABASE_SERVICE_ROLE_KEY': key}):
            import urllib.error

            def opener(req, timeout=None):
                raise urllib.error.HTTPError(req.full_url, 401, 'no', {}, io.BytesIO(
                    json.dumps({'code': 'PGRST301', 'message': 'bad jwt ' + key}).encode()))
            r = common.Rest(opener=opener)
            self.assertNotIn(key, repr(r))
            with self.assertRaises(common.RpcError) as cm:
                r.rpc('evidence_open_run', {})
            self.assertNotIn(key, str(cm.exception))
            self.assertIn('[service-role key]', str(cm.exception))

    def test_loop_db_mode_exits_without_flag(self):
        p = subprocess.run([sys.executable, str(HERE / 'loop.py'), '--case', '/nonexistent.json', '--out', '/tmp/x',
                            '--mode', 'db', '--user', testdata.OWNER], capture_output=True, text=True,
                           env=dict(os.environ, EVIDENCE_DB_WRITES='0'))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('db mode refused', p.stderr + p.stdout)


class Pinned(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        self.ok = os.path.join(self.d, 'ledger.csv')
        Path(self.ok).write_text('a,b\n')

    def lst(self, *paths):
        p = os.path.join(self.d, 'list.txt')
        Path(p).write_text('\n'.join(paths) + '\n')
        return p

    def test_refusals(self):
        for bad in ('/x/FOR-SIGNING/a.csv', '/x/jenny-inbox/a.csv', '/x/*.csv', 'relative.csv'):
            with self.assertRaises(common.PinnedSourceRefused):
                common.PinnedSources(self.lst(self.ok, bad))
        ps = common.PinnedSources(self.lst(self.ok))
        self.assertEqual(ps.read_text(self.ok), 'a,b\n')
        other = os.path.join(self.d, 'other.csv')
        Path(other).write_text('x')
        with self.assertRaises(common.PinnedSourceRefused):
            ps.read_text(other)
        priv = os.path.join(self.d, 'FOR-SIGNING')
        os.makedirs(priv)
        Path(priv, 'a.csv').write_text('secret')
        link = os.path.join(self.d, 'innocent.csv')
        os.symlink(os.path.join(priv, 'a.csv'), link)
        with self.assertRaises(common.PinnedSourceRefused):
            common.PinnedSources(self.lst(link))
        with self.assertRaises(common.PinnedSourceRefused):
            common.PinnedSources(self.lst(self.d)).read_text(self.d)
        with self.assertRaises(common.StopLoop):
            common.PinnedSources(self.lst('/x/jenny-inbox/a.csv'))


class Contract(unittest.TestCase):
    def tearDown(self):
        payloads.use_contract(payloads.CONTRACT)

    def test_whole_hour_rule(self):
        self.assertEqual(payloads.whole_hour_offset('2031-01-01T10:00:00+00:00', '2031-01-01T13:00:00.917+00:00')[0], -10800)
        self.assertEqual(payloads.whole_hour_offset('2031-01-01T10:00:00+00:00', '2031-01-01T13:00:01.000+00:00')[0], -10801)
        self.assertEqual(payloads.whole_hour_offset('2031-01-01T10:00:00.5+00:00', '2031-01-01T10:00:00+00:00')[0], 0)

    def test_override_renames_a_field(self):
        c = payloads.load_contract({'renames': {'propose_evidence_links': {'from_account_ref': 'payer_account_ref'}},
                                    'roles': payloads.CONTRACT['roles'] + ['refund']})
        payloads.use_contract(c)
        row = payloads.evidence_link(None, 'note', 'refund', 'j', 0.5, [{'k': 1}], external_ref='x',
                                     from_account_ref='bank_account:a')
        self.assertEqual(row['payer_account_ref'], 'bank_account:a')
        self.assertNotIn('from_account_ref', row)

    def test_builders_refuse_unknown_fields_and_v2_runs(self):
        with self.assertRaises(ValueError):
            payloads._clean('link', {'bogus': 1})
        with self.assertRaises(ValueError):
            payloads.open_run('u', 'probe', 'probe', 'p', 'v', {})
        with self.assertRaises(ValueError):
            payloads.decide('image_candidate', ['a'], 'confirmed', 'r', 's', 1, 'a', 'o', 'lead-1')


class Guards(unittest.TestCase):
    def test_promote_refuses_the_sweep_window(self):
        at = lambda: common.parse_ts('2031-01-01T03:20:00Z')  # noqa: E731
        with self.assertRaises(common.StopLoop) as cm:
            promote.promote(FakeRest(), FakeReader(), testdata.OWNER, [testdata.U('i')], now=at)
        self.assertEqual(cm.exception.reason, 'sweep_window')
        self.assertTrue(common.in_sweep_window(common.parse_ts('2031-01-01T03:35:59Z')))
        self.assertFalse(common.in_sweep_window(common.parse_ts('2031-01-01T03:36:00Z')))

    def test_promote_records_57014_and_stops_on_a_halting_watch(self):
        at = lambda: common.parse_ts('2031-01-01T12:00:00Z')  # noqa: E731
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'}):
            rest = FakeRest(fail={'promote_image': common.RpcError('promote_image', 500, '57014', 'canceling statement')})
            c = promote.promote(rest, FakeReader(), testdata.OWNER, [testdata.U('i')], now=at)
            self.assertEqual(c['recorded_57014'], 1)
            fails = [a for fn, a in rest.calls if fn == 'record_promotion_failure']
            self.assertEqual((fails[0]['p_sqlstate'], fails[0]['p_step']), ('57014', 'promote'))

            class Halting(FakeRest):
                def rpc(self, fn, args):
                    if fn == 'promote_image':
                        self.calls.append((fn, args))
                        return {'result': 'halted', 'why': 'revert_watch', 'halting_images': 2}
                    return super().rpc(fn, args)
            h = Halting()
            with self.assertRaises(common.StopLoop) as cm:
                promote.promote(h, FakeReader(), testdata.OWNER, [testdata.U('i')], now=at)
            self.assertEqual(cm.exception.reason, 'halting_watch_row')
            self.assertEqual([a for fn, a in h.calls if fn == 'evidence_close_run'][0]['p_status'], 'aborted')

    def test_repin_names_the_image_after_a_single_image_timeout(self):
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'}):
            img = testdata.U('watch-image')
            rest = FakeRest(fail={'evidence_repin_after_merge': common.RpcError('evidence_repin_after_merge', 500,
                                                                                  '57014', 'canceling statement')})
            out = repin.repin(rest, FakeReader(watch=[{'image_id': img}]), testdata.OWNER, limit=5)
            self.assertEqual(out['timeouts'], 1)
            fails = [a for fn, a in rest.calls if fn == 'record_promotion_failure']
            self.assertEqual((fails[0]['p_image_id'], fails[0]['p_step']), (img, 'repin'))

    def test_io_gate_waits_then_stops(self):
        t = iter([0, 120, 700])
        with self.assertRaises(common.StopLoop):
            dbops.io_gate(FakeReader(io_n=5), sleep=lambda s: None, clock=lambda: next(t))
        self.assertEqual(dbops.io_gate(FakeReader(io_n=3)), 3)


class StopFiles(SyntheticCase):
    def test_stop_file_and_dedupe_log(self):
        stop = os.path.join(self.tmp, 'STOP')
        log = os.path.join(self.tmp, 'job.log')
        self.ctx.case['stop_checks'] = {'files': [stop], 'dedupe_log': log}
        loop.stop_files(self.ctx)                       # nothing there
        Path(stop).write_text(testdata.U('vehicle', 'unrelated') + '\n')
        loop.stop_files(self.ctx)                       # a STOP for a vehicle out of scope
        Path(stop).write_text(testdata.V['TRUCK'] + '\n')
        with self.assertRaises(common.StopLoop):
            loop.stop_files(self.ctx)
        os.remove(stop)
        now = common.parse_ts('2031-06-01T12:00:00Z')
        Path(log).write_text('2031-06-01T11:55:00Z vehicle %s batch done\n' % testdata.V['TRUCK'])
        with self.assertRaises(common.StopLoop):
            loop.stop_files(self.ctx, now=now)
        loop.stop_files(self.ctx, now=common.parse_ts('2031-06-02T12:00:00Z'))
        self.ctx.case.pop('stop_checks')


class ReviewAndAnswers(SyntheticCase):
    def test_sheet_answers_and_decisions(self):
        read = readers.accounting(self.files, testdata.V['TRUCK'])
        rows = review_sheet.build_rows(self.ctx, self.files, read)
        md = review_sheet.render(self.ctx, rows, '2031-06-01')
        self.assertNotIn('http', md)
        self.assertNotIn('120.10', md)
        sheet = {'sheet': os.path.join(self.out, 'review.md'), 'sheet_sha256': common.sha256_bytes(md.encode()),
                 'items': len(rows), 'date': '2031-06-01', 'sheet_run': None, 'rows': rows}
        sp = os.path.join(self.out, 'review-2031-06-01.json')
        common.dump_json(sp, sheet)
        contested = [r for r in rows if 'also on' in r['question']][0]
        ap = os.path.join(self.tmp, 'answers.json')
        common.dump_json(ap, {str(contested['row']): 'that one was the second truck'})
        args = mock.Mock(sheet=sp, answers=ap, message_ref='session-1:msg-1', mode=common.FILE, user=None)
        with contextlib.redirect_stdout(io.StringIO()):
            record_answers.store(args, self.ctx)
        rc = common.load_json(os.path.join(self.out, 'answers-2031-06-01.json'))
        self.assertEqual(rc['rows'][str(contested['row'])]['sha256'], common.sha256_text('that one was the second truck'))
        self.assertNotIn('that one', json.dumps(rc))
        with self.assertRaises(SystemExit):
            record_answers.validate_answers(sheet, {str(len(rows) + 1): 'x'})
        with self.assertRaises(SystemExit):
            record_answers.validate_answers(sheet, {'1': '  '})
        plan = os.path.join(self.tmp, 'plan.json')
        k30_link = [t['key'] for t in contested['targets'] if t['key'].startswith('link:ledger')][0]
        common.dump_json(plan, [{'row': contested['row'], 'target_kind': 'evidence_link', 'targets': [k30_link],
                                 'decision': 'rejected', 'reassign_vehicle': 'SUB'}])
        dargs = mock.Mock(sheet=sp, receipt=os.path.join(self.out, 'answers-2031-06-01.json'), plan=plan,
                          agent_session='lead-session-1', manifest=None, mode=common.FILE, user=None)
        with contextlib.redirect_stdout(io.StringIO()):
            record_answers.decide(dargs, self.ctx)
        dec = common.load_json(os.path.join(self.out, 'decisions-2031-06-01.json'))
        self.assertEqual(dec[0]['reassign_to'], 'link:pnl:disposition:R000000000206@%s' % testdata.V['SUB'][:8])
        after = readers.extract_m5(readers.accounting(self.files, testdata.V['TRUCK'], dec))
        self.assertIn('bank:2032-BANK-00206', after['bands']['rejected'])
        common.dump_json(plan, [{'row': 1, 'target_kind': 'evidence_link', 'targets': [k30_link], 'decision': 'rejected'}])
        with self.assertRaises(SystemExit):                 # row 1 has no stored answer
            record_answers.decide(dargs, self.ctx)


class ReadPath(unittest.TestCase):
    def test_reader_refuses_writes_and_keeps_the_owner_out_of_logs(self):
        r = common.Reader(min_gap=0, runner=lambda *a, **k: mock.Mock(stdout='[{"n": 1}]'), log=None)
        for bad in ('update vehicles set x = 1', 'select 1; delete from vehicles',
                    'with x as (delete from evidence_runs returning *) select * from x',
                    'set statement_timeout = 0'):
            with self.assertRaises(common.ReadError):
                r.read(bad)
        logged = []
        r.log = logged.append
        self.assertEqual(r.read('/* tag */ select count(*) n from evidence_runs where user_id = :uid',
                                {'uid': testdata.OWNER}), [{'n': 1}])
        self.assertNotIn(testdata.OWNER, json.dumps(logged))
        with self.assertRaises(common.ReadError):
            common.Reader.substitute('select :x', {'x': "1'; drop table vehicles; --"})

    def test_scoreboard_falls_back_before_the_store_exists(self):
        class Pre:
            def read(self, sql, params=None, tag=None):
                if tag == 'scoreboard_dupes':
                    return []
                if 'v_image_capture_time' in sql or 'image_vehicle_candidates' in sql:
                    raise common.ReadError('ERROR:  42P01: relation does not exist')
                return [{'n': 2}]
        out = scoreboard.run(Pre(), testdata.OWNER, testdata.V['TRUCK'], only=['M1', 'M7', 'M2'])
        self.assertEqual(out['M1']['value'], 16)
        self.assertIn('pre-store', out['M1']['basis'])
        self.assertIn('error', out['M2'])

    def test_scoreboard_sql_blocks(self):
        st = scoreboard.parse()
        names = [n for n, _m, _s in st]
        for m in ('M1', 'M2', 'M3', 'M4', 'M4a', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10a', 'M10b', 'M11', 'M12', 'M13'):
            self.assertIn(m, names)
        self.assertEqual({n: m for n, m, _s in st}['M1'], 'chunked')
        out = io.StringIO()
        scoreboard.run(None, testdata.OWNER, testdata.V['TRUCK'], st, dry_run=True, printer=lambda s: out.write(s))
        self.assertNotIn(testdata.OWNER, out.getvalue())
        self.assertIn('<uid>', out.getvalue())
        q = scoreboard.quarters()
        self.assertEqual((q[0][0], q[-1][1], len(q)), ('2023-12-31', '2026-01-02', 8))
        sql = Path(scoreboard.SQL_FILE).read_text()
        self.assertNotRegex(sql, r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


class PhotosJoin(unittest.TestCase):
    def test_strict_offset_stem_match(self):
        idx = [{'photos_uuid': 'A', 'stem': 'IMG_0001', 'date_utc': '2031-01-01T13:00:00.500+00:00',
                'tz_offset_seconds': '-25200', 'albums': 'x', 'album_uuids': 'u'},
               {'photos_uuid': 'B', 'stem': 'IMG_0002', 'date_utc': '2031-01-01T13:00:00+00:00',
                'tz_offset_seconds': '-25200'}]
        for r in idx:
            r['utc'] = common.parse_ts(r['date_utc'])
        by_uuid = {r['photos_uuid']: r for r in idx}
        by_stem = {r['stem']: [r] for r in idx}
        rec = photos_join.match_row({'id': 'i1', 'source': 'user_upload', 'taken_at': '2031-01-01T10:00:00+00:00',
                                     'filename': 'IMG_0001.HEIC'}, by_uuid, by_stem)
        self.assertEqual((rec['photos_uuid'], rec['match_kind'], rec['offset_hours_applied']), ('A', 'stem_time_corrected', 3))
        rec = photos_join.match_row({'id': 'i2', 'source': 'ssd_blast', 'taken_at': '2031-01-01T12:00:00+00:00',
                                     'filename': 'IMG_0002.HEIC'}, by_uuid, by_stem)
        self.assertEqual(rec['match_kind'], 'stem_time_corrected')
        rec = photos_join.match_row({'id': 'i3', 'source': 'user_upload', 'taken_at': '2031-01-05T10:00:00+00:00',
                                     'filename': 'IMG_0001.HEIC'}, by_uuid, by_stem)
        self.assertEqual(rec['match_kind'], 'none')


class LoopCli(SyntheticCase):
    def test_file_mode_loop_end_to_end(self):
        out = os.path.join(self.tmp, 'loop-out')
        with contextlib.redirect_stdout(io.StringIO()):
            with mock.patch.object(sys, 'argv', ['loop.py', '--case', self.td['case'], '--out', out, '--user',
                                                 testdata.OWNER, '--date', '2031-06-01']):
                code = loop.main()
        self.assertEqual(code, 0)
        rep = common.load_json(os.path.join(out, 'loop-report-2031-06-01.json'))
        self.assertEqual(rep['violations'], 0)
        self.assertTrue(rep['exit_test']['structural_pass'])
        self.assertEqual({f: rep['files'].get(f, 0) for f in EXPECTED}, EXPECTED)
        for f in ('checks.json', 'load-plan.json', 'exit-test-2031-06-01.json', 'review-2031-06-01.md'):
            self.assertTrue(os.path.exists(os.path.join(out, f)), f)


class CustodyBounds(SyntheticCase):
    def test_acquisition_from_the_first_own_photo_day(self):
        import pass_custody_bounds
        b = passlib.Built()
        for f, lines in self.built.files.items():
            if f != 'change_claims.jsonl':
                for ln in lines:
                    b.add(f, ln)
        self.ctx.case['passes']['custody_bounds'] = {'vehicles': ['TRUCK']}
        res = pass_custody_bounds.build(self.ctx, b)
        self.assertEqual(res['custody_bounds']['emitted'], 1)
        c = b.claims()[0]['p_claim']
        # the yard visit (flagged) and the seller's frames (third party) do not start custody
        self.assertEqual((c['kind'], c['occurred_from'], c['occurred_to']), ('acquisition', '2031-01-18', '2031-01-18'))


class BatchOffsets(unittest.TestCase):
    def test_unjoined_rows_take_their_batch_offset_and_the_gate_counts(self):
        import csv
        tmp = tempfile.mkdtemp(prefix='evidence-batch-')
        self.addCleanup(shutil.rmtree, tmp, True)
        td = testdata.make_case(os.path.join(tmp, 'case'))
        p = os.path.join(tmp, 'case', 'photos_join.csv')
        with open(p, newline='') as f:
            rows = list(csv.DictReader(f))
        ssd = [r for r in rows if r['source'] == 'ssd_blast'][:2]       # 26 joined: a pooled key under 50
        upl = [r for r in rows if r['source'] == 'user_upload' and r['albums'] == ''][:3]
        for r in ssd + upl:
            r.update(match_kind='none', capture_utc_true='', photos_uuid='', albums='', album_uuids='')
        with open(p, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        ctx, built, counts = build(td['case'], os.path.join(tmp, 'out'))
        rep = checks.validate_dir(str(ctx.out), ctx, money.Sources(ctx))
        self.assertEqual(rep.total, 0, rep.as_dict()['by_file'])
        batch = [ln['row'] for ln in built.files['time_claims.jsonl'] if ln['row']['rule'] == 'batch_offset_v1']
        keys = sorted({r['batch_key'] for r in batch})
        self.assertEqual(len(batch), 5)
        self.assertEqual(keys, ['ssd_blast|pool|2033-0700', 'user_upload|2033-03-01|-0700'])
        self.assertTrue(all(r['offset_seconds'] in (0, -10800) for r in batch))
        gate = [r for r in common.load_json(os.path.join(tmp, 'out', 'run.json'))['runs'] if r['key'] == 'run:time_rule_gate']
        g = gate[0]['close']['counts']['batches']
        self.assertEqual(g['ssd_blast|pool|2033-0700']['joined'], 24)
        self.assertEqual(g['ssd_blast|pool|2033-0700']['worst_day_agreement'], 1.0)
        self.assertEqual(g['user_upload|2033-03-01|-0700']['offset_seconds'], -10800)
        self.assertEqual(counts['candidates.combined.jsonl'], 128)


if __name__ == '__main__':
    unittest.main(verbosity=1)

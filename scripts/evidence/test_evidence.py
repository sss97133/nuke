#!/usr/bin/env python3
"""Offline contracts for the image-evidence runner (draft.sql v5): every pass in file mode on synthetic pilot-shaped
inputs (no real id, amount, path, model, vendor or person name), the v5 CHECK rules, the file-mode readers and the
exit test, the loader's batching, gates and reported outcomes, db-mode refusal and stop conditions against a fake
PostgREST, the manifest of returned ids and its M10b reconciliation, review rows with per-row targets, structured
answers and answer binding, the pinned-source refusals, promotion guards, the scoreboard SQL and the read path.
No network, no database, no Photos library.

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
import urllib.error
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
import manifest  # noqa: E402
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
            # the job allocation of the 00737 analogue (subject_key) and the Messages contradicts link (44); v5: the
            # 12 album items with no image row as photos_item links and one unjoined order
            'links.jsonl': 57,
            # v2's 7 claims plus the painter's work_performed claim
            'change_claims.jsonl': 8}
T = testdata.V['TRUCK']


def build(case_path, out):
    ctx = common.Context(case_path, out, user_id=testdata.OWNER)
    payloads.use_contract(ctx.contract)
    built = passlib.build_all(ctx)
    counts = passlib.write_built(ctx, built, ctx.user_id)
    return ctx, built, counts


def pk(sfx):
    return 'bank:' + testdata.lid(sfx)


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

    def copy_out(self, name):
        d = os.path.join(self.tmp, name)
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(self.out, d)
        return d

    def links(self):
        return self.files['links.jsonl'] + self.files['links.album.jsonl']


class PassCounts(SyntheticCase):
    def test_counts_match_the_pilot_file_mode_run(self):
        self.assertEqual({f: self.counts.get(f, 0) for f in EXPECTED}, EXPECTED)

    def test_time_claims_all_machine_confirmable(self):
        rep = checks.validate_dir(self.out, self.ctx, money.Sources(self.ctx))
        self.assertEqual(rep.would_confirm, 133)

    def test_every_payload_passes_the_v5_checks(self):
        rep = checks.validate_dir(self.out, self.ctx, money.Sources(self.ctx))
        self.assertEqual(rep.total, 0, json.dumps(rep.as_dict()['by_file'], indent=1)[:3000])

    def test_runs_cover_every_pass_and_only_the_ledger_records_coverage(self):
        run = common.load_json(os.path.join(self.out, 'run.json'))
        passes = {r['args']['p_pass'] for r in run['runs']}
        used = {ln['p_run_id'][5:] for f in self.files if f.endswith('.jsonl') for ln in self.files[f]}
        self.assertLessEqual(used, passes)
        self.assertTrue({'pnl_allocation', 'messages_mention', 'photos_join'} <= passes)
        self.assertEqual(run['config']['user_id'], testdata.OWNER)
        self.assertTrue(all(r['args']['p_user_id'] == '@config.user_id' for r in run['runs']))
        cov = {r['args']['p_pass']: r['args']['p_config'] for r in run['runs'] if 'coverage_to' in r['args']['p_config']}
        self.assertEqual(list(cov), ['ledger_vendor_date'])
        self.assertEqual((cov['ledger_vendor_date']['coverage_to'], cov['ledger_vendor_date']['covers_accounts']),
                         (testdata.COVER_TO, [testdata.LEDGER_ACCOUNT]))

    def test_v5_shapes(self):
        links = self.links()
        self.assertLessEqual({ln['row']['role'] for ln in links}, set(payloads.CONTRACT['roles']))
        self.assertFalse(any('account_ref' in ln['row'] for ln in links))
        for ln in links:                                 # a pass names third parties only (RC4-4)
            for f in ('payer_entity', 'payee_entity'):
                self.assertTrue(ln['row'].get(f) is None or ln['row'][f].startswith('third_party:'), ln['key'])
            for f in ('amount_cents', 'allocated_cents'):
                v = ln['row'].get(f)
                self.assertTrue(v is None or str(v).startswith('@amount:'), ln['key'])
        self.assertLessEqual({ln['row'].get('cost_category') for ln in links} - {None},
                             set(payloads.CONTRACT['cost_categories']))
        pnl = [ln for ln in links if ln['row']['source_kind'] == 'pnl_line']
        self.assertEqual(len(pnl), 2)
        job = [ln for ln in pnl if ln['row'].get('subject_key')]
        self.assertEqual(job[0]['row']['subject_key'], 'label:' + testdata.JOB)
        self.assertNotIn('vehicle_id', job[0]['row'])
        self.assertEqual(len([ln for ln in links if ln['row']['role'] == 'contradicts' and ln['row'].get('payment_key')]), 1)
        orders = [ln['row'] for ln in links if ln['row']['source_kind'] == 'gmail_order' and ln['row']['role'] == 'assertion']
        joined = [r for r in orders if r.get('payment_key')]
        self.assertEqual(sorted(r['payment_key'] for r in joined), sorted([pk('00163'), pk('00770')]))
        self.assertTrue(all('amount_cents' not in r and r['payment_join_confidence'] for r in joined))
        self.assertEqual(len([r for r in orders if 'payment_key' not in r and 'amount_cents' not in r]), 1)
        items = [ln['row'] for ln in links if ln['row']['source_kind'] == 'photos_item']
        self.assertEqual(len(items), 12)
        self.assertTrue(all(r['role'] == 'context' and r['external_ref'].startswith('photos:') and
                            r['vehicle_id'] == T for r in items))
        self.assertTrue([ln for ln in links if ln['row'].get('transaction_on')])
        claims = {ln['key']: ln['p_claim'] for ln in self.files['change_claims.jsonl']}
        wp = [c for c in claims.values() if c['kind'] == 'work_performed'][0]
        self.assertEqual((wp['party_entity'], wp['occurred_from'], wp['occurred_to']),
                         ('third_party:painter', '2031-05-11', '2031-05-11'))
        trade = claims['claim:acquisition:%s' % testdata.V['TRADE'][:8]]
        self.assertTrue(trade['asserted_value']['trade_in_acv_cents'].startswith('@amount:'))
        self.assertNotIn('amount_cents', trade)
        for ln in self.files['time_claims.jsonl']:
            self.assertEqual(ln['row']['offset_seconds'] % 3600, 0)
            self.assertEqual(ln['row']['witness']['upload_day'], '2033-03-01')

    def test_no_message_text_and_no_owner_id_outside_config(self):
        blob = ''.join(Path(self.out, f).read_text() for f in os.listdir(self.out) if f.endswith('.jsonl'))
        self.assertNotIn('synthetic text', blob)
        self.assertNotIn(testdata.OWNER, blob)

    def test_listing_keepers_follow_the_dedupe_rule(self):
        rows = self.files['candidates.listing_class.jsonl']
        copies = sum(len([e for e in ln['row']['evidence'] if e['kind'] == 'url_copies_on_vehicle'][0]['duplicate_row_ids'])
                     for ln in rows)
        self.assertEqual(copies, 4534 - 1006)
        self.assertEqual(len([ln for ln in rows if ln['row']['confidence'] == 0.98]), 502)

    def test_custody_bounds_stays_out_where_a_source_dates_the_acquisition(self):
        self.assertTrue(any('a sourced acquisition claim exists' in n for n in self.ctx.notes))
        self.assertFalse([ln for ln in self.files['change_claims.jsonl'] if ln['p_run_id'] == '@run:custody_bounds'])


class Validator(SyntheticCase):
    def planted(self, mutate, f='links.jsonl'):
        d = self.copy_out('planted')
        p = os.path.join(d, f)
        if f == 'run.json':
            obj = common.load_json(p)
            mutate(obj)
            common.dump_json(p, obj)
        else:
            lines = common.read_jsonl(p)
            mutate(lines)
            common.write_jsonl(p, lines)
        return checks.validate_dir(d, self.ctx, money.Sources(self.ctx))

    def assertCaught(self, mutate, needle, f='links.jsonl'):
        rep = self.planted(mutate, f)
        msgs = [m for v in rep.by_file.values() for m in v]
        self.assertTrue(any(needle in m for m in msgs), '%s not in %s' % (needle, msgs[:5]))

    def test_amount_written_as_a_number(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(amount_cents=12010), 'must be an @amount: placeholder')

    def test_amount_text_in_a_summary(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(summary='paid 120.10 for glass'), 'input amount')

    def test_v2_role_and_account_ref(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(role='cost'), 'role')
        self.assertCaught(lambda ls: ls[0]['row'].update(account_ref='bank_account:x'), 'account_ref is v2')

    def test_literal_unknown_and_owner_entities(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(payer_entity='unknown'), 'blocks the account map')
        self.assertCaught(lambda ls: ls[0]['row'].update(payer_entity='owner'), 'el_entity_owner_word')
        self.assertCaught(lambda ls: ls[0]['row'].update(payee_entity='owner_business:x'), 'el_entity_owner_word')

    def test_owner_word_must_cite_his_answer(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(source_kind='owner_statement'), 'el_owner_word_cited')
        self.assertCaught(lambda ls: ls[0]['row'].update(payment_key='owner:he-said-so'), 'el_owner_word_cited')

    def test_joined_assertion_needs_a_join_confidence(self):
        def drop(ls):
            for ln in ls:
                if ln['row']['source_kind'] == 'gmail_order' and ln['row'].get('payment_join_confidence') and \
                        ln['row']['role'] == 'assertion':
                    del ln['row']['payment_join_confidence']
        self.assertCaught(drop, 'el_money_shape')

    def test_coverage_only_on_a_payment_source_run_with_its_accounts(self):
        def on_pnl(run):
            next(r for r in run['runs'] if r['key'] == 'run:pnl_allocation')['args']['p_config']['coverage_to'] = '2032-12-31'
        self.assertCaught(on_pnl, 'er_coverage_source', 'run.json')

        def no_accounts(run):
            next(r for r in run['runs'] if r['key'] == 'run:ledger_vendor_date')['args']['p_config'].pop('covers_accounts')
        self.assertCaught(no_accounts, 'covers_accounts', 'run.json')

    def test_claim_parties_subjects_and_custody_bounds(self):
        acq = 'claim:acquisition:%s' % T[:8]
        self.assertCaught(lambda ls: next(ln for ln in ls if ln['key'] == acq)['p_claim'].update(
            party_entity='owner_business:x'), 'vcc_party_not_entity', 'change_claims.jsonl')
        self.assertCaught(lambda ls: next(ln for ln in ls if ln['key'] == acq)['p_claim'].update(
            subject_key='label:X'), 'vcc_subject', 'change_claims.jsonl')

        def bound_sale(ls):
            ln = next(ln for ln in ls if ln['p_claim']['kind'] == 'sale')
            ln['p_run_id'] = '@run:custody_bounds'
        self.assertCaught(bound_sale, 'custody_bounds proposes only', 'change_claims.jsonl')

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


class Builders(unittest.TestCase):
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

    def test_every_writer_called_is_one_the_guard_admits(self):
        self.assertEqual(set(payloads.CONTRACT['writers']), set(payloads.CONTRACT['writer_names']))

    def test_builders_refuse_unknown_fields_and_own_writer_runs(self):
        with self.assertRaises(ValueError):
            payloads._clean('link', {'bogus': 1})
        with self.assertRaises(ValueError):
            payloads.open_run('u', 'probe', 'probe', 'p', 'v', {})
        with self.assertRaises(ValueError):
            payloads.decide('image_candidate', ['a'], 'confirmed', 'r', 's', 1, 'a', 'o', 'lead-1')

    def test_parties_are_third_parties_or_null(self):
        row = payloads.evidence_link(T, 'ledger_line', 'payment_out', 'j', 0.5, [{'k': 1}], external_ref='x',
                                     amount_cents='@amount:l:1', payer_entity='owner', payee_entity='third_party:shop')
        self.assertNotIn('payer_entity', row)
        self.assertEqual(row['payee_entity'], 'third_party:shop')
        ref = payloads.answer_ref(testdata.U('answers'), 4)
        st = payloads.evidence_link(T, 'owner_statement', 'payment_out', 'j', 0.9, [{'k': 1}], external_ref=ref,
                                    amount_cents='@amount:l:1', payer_entity='owner_business:x',
                                    payment_key=payloads.owner_payment_key(testdata.U('answers'), 4))
        self.assertEqual((st['payer_entity'], st['payment_key']), ('owner_business:x', 'owner:' + ref))
        with self.assertRaises(ValueError):
            payloads.evidence_link(T, 'owner_statement', 'context', 'j', 0.9, [{'k': 1}], external_ref='note:x')
        with self.assertRaises(ValueError):
            payloads.evidence_link(T, 'note', 'context', 'j', 0.9, [{'k': 1}], external_ref='x', payment_key='owner:x')
        self.assertEqual(payloads.change_claim(T, 'custody', 'acquisition', 's', 0.5, party_entity='owner')
                         .get('party_entity'), None)
        self.assertEqual(payloads.change_claim(T, 'physical', 'work_performed', 's', 0.5, party_entity='owner')
                         ['party_entity'], 'owner')
        self.assertEqual(payloads.change_claim(None, 'physical', 'worked_on', 's', 0.5, subject_key='label:JOB')
                         ['subject_key'], 'label:JOB')
        with self.assertRaises(ValueError):
            payloads.change_claim(None, 'custody', 'acquisition', 's', 0.5, subject_key='label:JOB')

    def test_runs_refuse_coverage_off_a_payment_source_and_review_rows_need_targets(self):
        with self.assertRaises(ValueError):
            payloads.open_run('u', 'pilot', 'pnl_allocation', 'p', 'v', {'coverage_to': '2032-12-31',
                                                                       'covers_accounts': ['bank_account:a']})
        with self.assertRaises(ValueError):
            payloads.open_run('u', 'pilot', 'ledger_vendor_date', 'p', 'v', {'coverage_to': '2032-12-31'})
        payloads.open_run('u', 'pilot', 'ledger_vendor_date', 'p', 'v', {'coverage_to': '2032-12-31',
                                                                       'covers_accounts': ['bank_account:a']})
        img = testdata.U('image', 1)
        ok = {'sheet_sha256': 'x', 'items': 2, 'rows': {
            '1': {'targets': [{'kind': 'image_candidate', 'id': testdata.U('c')}, {'kind': 'image', 'id': img}]},
            '2': {'targets': [{'kind': 'payment', 'key': pk('00206')}]}}}
        payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', ok)
        for bad in ({'1': ok['rows']['1']}, dict(ok['rows'], **{'2': {'targets': []}}),
                    dict(ok['rows'], **{'2': {'targets': [{'kind': 'account', 'key': 'my checking'}]}})):
            with self.assertRaises(ValueError):
                payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', dict(ok, rows=bad))

    def test_structured_answers(self):
        good = [{'decision': 'confirmed'}, {'decision': 'rejected', 'vehicle_id': T},
                {'decision': 'confirmed', 'subject_key': 'label:JOB-SIDE'},
                {'decision': 'confirmed', 'entity_key': 'owner_business:synthetic'}, {'decision': 'unsure'}]
        for a in good:
            self.assertIsNone(payloads.answer_problem(a), a)
        bad = [{'decision': 'yes'}, {'decision': 'confirmed', 'vehicle_id': T, 'entity_key': 'owner'},
               {'decision': 'unsure', 'vehicle_id': T}, {'decision': 'confirmed', 'subject_key': 'the job'},
               {'decision': 'confirmed', 'entity_key': 'my business'}, {'decision': 'confirmed', 'note': 'x'}, 'yes']
        for a in bad:
            self.assertIsNotNone(payloads.answer_problem(a), a)
        args = payloads.record_answers('u', 's', 'm', {'3': {'verbatim': 'no, the second truck',
                                                             'answer': {'decision': 'rejected', 'vehicle_id': T}}},
                                       'p', 'v')
        self.assertEqual(args['p_rows']['3']['answer'], {'decision': 'rejected', 'vehicle_id': T})
        with self.assertRaises(ValueError):
            payloads.record_answers('u', 's', 'm', {'3': 'no, the second truck'}, 'p', 'v')
        self.assertEqual(payloads.answer_place({'decision': 'confirmed', 'entity_key': 'owner'}), 'entity:owner')


class Readers(SyntheticCase):
    def files_with(self, claims=(), coverage=None):
        f = dict(self.files)
        f['change_claims.jsonl'] = list(self.files['change_claims.jsonl']) + list(claims)
        if coverage:
            run = json.loads(json.dumps(self.files['run.json']))
            next(r for r in run['runs'] if r['key'] == 'run:ledger_vendor_date')['args']['p_config']['coverage_to'] = coverage
            f['run.json'] = run
        return f

    def test_identity_closes_transitively(self):
        third = testdata.U('vehicle', 'third')
        pair = payloads.claim_line('claim:same:third', 'identity_compare', payloads.change_claim(
            testdata.V['TWIN'], 'record', 'same_vehicle_as', 'pair', 0.6, related_vehicle_id=third), [])
        dec = [{'target': 'claim:same_vehicle_as:%s' % testdata.V['TWIN'][:8], 'decision': 'confirmed'},
               {'target': 'claim:same:third', 'decision': 'confirmed'}]
        v = readers.accounting(self.files_with([pair]), T, dec)
        self.assertEqual(set(v['identity']), {T, testdata.V['TWIN'], third})

    def test_upper_bound_custody_reads_unknown_and_a_day_after_a_sale_is_after(self):
        other = testdata.V['SWB']
        bound = payloads.claim_line('claim:bound', 'custody_bounds', payloads.change_claim(
            other, 'custody', 'acquisition', 'acquired by', 0.3, occurred_to='2031-03-31'), [])
        sale = payloads.claim_line('claim:sold', 'deal_document', payloads.change_claim(
            other, 'custody', 'sale', 'sold', 0.6, occurred_from='2031-03-01', occurred_to='2031-03-02'), [])
        v = readers.accounting(self.files_with([bound]), other)
        self.assertEqual((v['custody']['status'], v['custody']['acquired_by'], v['work_days']),
                         ('unknown', '2031-03-31', 'unknown'))
        self.assertFalse([q for q in v['open_questions'] if q['q'] == 'who_paid'])   # an upper bound is not asked
        st = readers.Store(self.files_with([bound, sale]))
        cust = readers.custody(st, {other})
        self.assertIs(readers.in_custody(cust, '2031-03-31'), False)
        self.assertIsNone(readers.in_custody(cust, '2031-02-01'))

    def test_assertions_after_the_coverage_await_a_statement(self):
        v = readers.accounting(self.files_with(coverage='2032-01-31'), T)
        waiting = sorted(q['ref'] for q in v['open_questions'] if q['q'] == 'awaiting_statement')
        self.assertIn(testdata.JACKET_REF + '#line:paint', waiting)
        self.assertNotIn('gmail:thread:synththread0007', waiting)          # dated before the coverage
        self.assertEqual(v['money_sources_cover_to'], '2032-01-31')

    def test_session_days_without_own_photos(self):
        v = readers.accounting(self.files, T, sessions=readers.sessions_of(self.ctx))
        self.assertEqual([(d['day'], d['sessions'], d['in_custody']) for d in v['session_days']],
                         [(testdata.DOC_DAY, 1, False)])

    def test_a_windowed_read_dates_a_payment_by_its_payment_source(self):
        v = readers.accounting(self.files, T, date_from='2031-05-27', date_to='2031-05-27')
        self.assertEqual(v['payments_outside_window'], [{'payment_key': pk('00770'), 'paid_on': '2031-05-28'}])
        self.assertNotIn(pk('00770'), readers.extract_m5(v)['band_links'])


class ExitTest(SyntheticCase):
    def results(self):
        fx = common.load_json(self.td['fixture'])
        return exit_test.run(fx, self.files, lambda dec: readers.accounting(self.files, fx['vehicle_id'], dec))

    def test_structural_pass_with_the_job_allocation_contested(self):
        res, summary = self.results()
        by = {r['id']: r for r in res}
        self.assertTrue(summary['structural_pass'], [r for r in res if r['result'] == 'fail'])
        self.assertEqual((summary['fail'], summary['blocked']), (0, 0))
        for a in ('job_contested', 'painter_contested', 'disputed', 'joined_orders_in_their_payment', 'coverage',
                  'photos_items', 'proposed_bands', 'income', 'asserted_unpaid'):
            self.assertEqual(by[a]['result'], 'pass', by[a])

    def test_confirmed_level_simulated_from_the_answers(self):
        res, _summary = self.results()
        by = {r['id']: r for r in res}
        self.assertEqual(by['painter_answered']['result'], 'open')
        self.assertEqual(by['painter_answered']['simulated'], 'pass')
        self.assertEqual(by['identity_pair_confirmed']['simulated'], 'pass')

    def test_m5_extraction_keys(self):
        v = readers.accounting(self.files, T)
        m5 = readers.extract_m5(v)
        self.assertEqual(m5['work_days'], sorted(testdata.ALBUM_DAYS))
        self.assertIn([testdata.DOC_DAY, 'after', 0, 1], m5['outside'])
        self.assertEqual(m5['income'], [[pk('00306'), 'med', testdata.SHARE_ACCOUNT, testdata.LEDGER_ACCOUNT,
                                         'unknown', 'unknown']])
        self.assertEqual((m5['cover_to'], m5['undated_own_photos']), (testdata.COVER_TO, 0))
        self.assertEqual(m5['other_vehicles'][pk('00737')], ['label:' + testdata.JOB])
        self.assertNotIn('own_labour_asserted', v)
        self.assertEqual(v['costs']['contested']['cents'], None)

    def test_db_read_passes_the_owner(self):
        class R:
            def read(self, sql, params=None, tag=None):
                self.sql, self.params = sql, params
                return [{'v': json.dumps({'identity': [T]})}]
        r = R()
        v = exit_test.db_read(T, testdata.OWNER, None, reader=r)
        self.assertIn('vehicle_accounting_evidence(:vehicle, NULL, NULL, :uid)', r.sql)
        self.assertEqual(r.params['uid'], testdata.OWNER)
        self.assertEqual(v['identity'], [T])


class Loader(SyntheticCase):
    def test_file_plan_batches_and_dedupe_gate(self):
        ld = loader.Loader(self.ctx, common.FILE)
        ld.load_dir(self.out)
        man = ld.manifest()
        self.assertLessEqual(man['max_rows_in_a_call'], 500)
        self.assertEqual(man['skipped_by_reason'], {'dedupe_pending': 1006})
        writers = [c['writer'] for c in ld.calls]
        n_runs = len(common.load_json(os.path.join(self.out, 'run.json'))['runs'])
        self.assertEqual(writers[:n_runs], ['evidence_open_run'] * n_runs)
        self.assertLess(max(i for i, w in enumerate(writers) if w == 'propose_evidence_links'),
                        min(i for i, w in enumerate(writers) if w == 'propose_change_claim'))

    def test_listing_waits_for_the_dedupe_then_drops_copies(self):
        d = os.path.join(self.tmp, 'dedupe-case')
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(os.path.dirname(self.td['case']), d)
        Path(d, 'dedupe_done.txt').write_text(T + '\n')
        rows = common.load_json(os.path.join(d, 'listing_rows.json'))
        keepers = [ln['row']['image_id'] for ln in self.files['candidates.listing_class.jsonl']][:3]
        for r in rows:
            if r['id'] in keepers:
                r['dup'] = True                              # the dedupe marked them after the files were built
        common.dump_json(os.path.join(d, 'listing_rows.json'), rows)
        ctx = common.Context(os.path.join(d, 'case.json'), self.out, user_id=testdata.OWNER)
        ld = loader.Loader(ctx, common.FILE)
        ld.load_dir(self.out)
        self.assertEqual(ld.manifest()['skipped_by_reason'], {'is_duplicate_now': 3})
        sizes = [c['rows'] for c in ld.calls if c.get('file') == 'candidates.listing_class.jsonl']
        self.assertEqual(sizes, [497, 500, 6])


class FakeRest:
    """Stands in for PostgREST: answers each writer the way draft.sql v5 does, records every call."""

    def __init__(self, fail=None, links=None, decide=None):
        self.calls = []
        self.fail = fail or {}
        self.link_results = links or {}                  # source key -> result for propose_evidence_links
        self.decide_result = decide
        self.n = 0

    def new(self):
        self.n += 1
        return '00000000-0000-4000-8000-%012d' % self.n

    def rpc(self, fn, args):
        self.calls.append((fn, args))
        if fn in self.fail:
            f = self.fail[fn]
            if isinstance(f, Exception):
                raise f
            return f(args)
        if fn in ('evidence_open_run', 'propose_change_claim', 'record_promotion_failure', 'evidence_record_answers'):
            return self.new()
        if fn == 'propose_image_candidates':
            return {'proposed': len(args['p_rows']), 'unchanged': 0, 'items': [
                {'image_id': r['image_id'], 'result': 'proposed', 'candidate_id': self.new()} for r in args['p_rows']]}
        if fn == 'propose_evidence_links':
            items = []
            for r in args['p_rows']:
                ref = payloads.source_key(r.get('source_table'), r.get('source_row_id'), r.get('external_ref'),
                                          r.get('anchor'))
                res = self.link_results.get(ref, 'proposed')
                it = {'ref': ref, 'result': res}
                if res in ('proposed', 'superseded', 'already_decided'):
                    it['link_id'] = self.new()
                items.append(it)
            return {'proposed': sum(1 for i in items if i['result'] == 'proposed'), 'items': items}
        if fn == 'propose_capture_time_claims':
            ids = [self.new() for _r in args['p_rows']]
            return {'proposed': len(ids), 'machine_confirmed': len(ids), 'kept_stronger': 0, 'ids': ids,
                    'decision_ids': [self.new() for _i in ids]}
        if fn == 'record_day_context':
            return {'recorded': len(args['p_rows']), 'skipped': [], 'out_of_scope': [],
                    'ids': [self.new() for _r in args['p_rows']]}
        if fn == 'propose_account_entities':
            return {'proposed': len(args['p_rows']), 'ids': [self.new() for _r in args['p_rows']]}
        if fn == 'propose_claim_support':
            return len(args['p_support'])
        if fn == 'confirm_capture_times_by_rule':
            return {'confirmed': len(args['p_claim_ids']), 'gate_run_id': args['p_gate_run_id'],
                    'decision_ids': [self.new() for _i in args['p_claim_ids']]}
        if fn == 'decide_evidence':
            if self.decide_result:
                return self.decide_result(args)
            return {'items': [{'id': i, 'result': args['p_decision'], 'decision_id': self.new()}
                              for i in args['p_target_ids']]}
        return {}


class FakeReader:
    def __init__(self, io_n=0, locks=0, watch=None):
        self.io_n, self.locks, self.watch_rows = io_n, locks, watch or []
        self.sql = []

    def read(self, sql, params=None, tag=None):
        self.sql.append((tag, sql, params))
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
        cov = [a['p_config'] for fn, a in rest.calls if fn == 'evidence_open_run' and 'coverage_to' in a['p_config']]
        self.assertEqual([c['covers_accounts'] for c in cov], [[testdata.LEDGER_ACCOUNT]])

    def test_reported_outcomes_are_counted_and_never_retried(self):
        refused = testdata.LEDGER_EXT + testdata.lid('00240')
        decided = testdata.LEDGER_EXT + testdata.lid('00268')
        rest = FakeRest(links={refused: 'entity_is_owners_call', decided: 'already_decided'})
        ld = self.loader(rest)
        ld.load_dir(self.out)
        self.assertEqual(ld.outcomes, {'entity_is_owners_call': 1, 'already_decided': 1})
        self.assertEqual(ld.skipped[testdata.lkey(refused, T)], 'entity_is_owners_call')
        self.assertTrue(common.is_uuid(ld.ids[testdata.lkey(decided, T)]))   # the decided row stands
        sent = [r for fn, a in rest.calls if fn == 'propose_evidence_links' for r in a['p_rows']]
        self.assertEqual(sum(1 for r in sent if r.get('external_ref') == refused), 1)
        self.assertEqual(ld.manifest()['outcomes_reported_not_retried'], dict(ld.outcomes))

    def test_custody_bounds_null_is_skipped_with_its_reason(self):
        rest = FakeRest(fail={'propose_change_claim': lambda args: None})
        ld = self.loader(rest)
        ld.load_dir(self.out)
        self.assertTrue(set(ld.skipped.values()) >= {'sourced_acquisition_exists'})

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

    def db_loop(self, watch_error):
        class Reader(FakeReader):
            def read(self, sql, params=None, tag=None):
                if tag == 'revert_watch':
                    raise common.ReadError(watch_error)
                return super().read(sql, params, tag)
        d = self.copy_out('db-loop')
        ctx = common.Context(self.td['case'], d, mode=common.DB, user_id=testdata.OWNER)
        payloads.use_contract(ctx.contract)
        rest, report = FakeRest(), {}
        a = mock.Mock(skip_scoreboard=True, date='2031-06-02')
        return rest, report, lambda: loop.db_steps(ctx, a, report, rest, Reader())

    def test_db_loop_skips_an_undeployed_promotion_path(self):
        rest, report, go = self.db_loop('ERROR:  42883: function public.evidence_revert_watch(unknown) does not exist')
        go()
        fns = [fn for fn, _a in rest.calls]
        self.assertIn('not deployed', report['promotion_path'])
        self.assertFalse({'promote_image', 'publish_image', 'evidence_repin_after_merge'} & set(fns))
        loop_close = [a for fn, a in rest.calls if fn == 'evidence_close_run' and a['p_run_id'] == report['loop_run']]
        self.assertEqual([c['p_status'] for c in loop_close], ['done'])
        self.assertTrue(report['review_sheet']['sheet_run'])               # 53 rows: more than 50, so it is issued

    def test_db_loop_closes_its_run_failed_on_an_error(self):
        rest, report, go = self.db_loop('ERROR:  42P01: relation "x" does not exist')
        with self.assertRaises(common.ReadError):
            go()
        loop_close = [a for fn, a in rest.calls if fn == 'evidence_close_run' and a['p_run_id'] == report['loop_run']]
        self.assertEqual([c['p_status'] for c in loop_close], ['failed'])

    def test_read_backs_are_keyed_by_the_owner(self):
        reader = FakeReader()
        self.loader(FakeRest(), reader).load_dir(self.out)
        backs = [(sql, params) for tag, sql, params in reader.sql if tag == 'read_back' and 'user_id' in sql]
        self.assertTrue(backs and all(p.get('uid') == testdata.OWNER for _s, p in backs))


class Manifest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='evidence-manifest-')
        self.addCleanup(shutil.rmtree, self.d, True)

    def rest(self, answer):
        class Resp:
            def __init__(self, body):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return self.body

        def open_(req, timeout=None):
            if isinstance(answer, Exception):
                raise answer
            return Resp(json.dumps(answer).encode())
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'}):
            return common.Rest(url='https://example.test', key='k' * 40, opener=open_,
                               manifest=manifest.Manifest(self.d))

    def lines(self):
        return [json.loads(x) for p in sorted(Path(self.d).glob('*.jsonl')) for x in p.read_text().splitlines()]

    def test_rest_appends_the_ids_a_writer_returned(self):
        run, a, b = testdata.U('run'), testdata.U('link', 'a'), testdata.U('link', 'b')
        r = self.rest({'proposed': 1, 'items': [{'ref': 'x', 'result': 'proposed', 'link_id': a},
                                                {'ref': 'y', 'result': 'already_decided', 'link_id': b},
                                                {'ref': 'z', 'result': 'entity_is_owners_call'}]})
        r.rpc('propose_evidence_links', {'p_run_id': run, 'p_rows': []})
        ln = self.lines()[0]
        self.assertEqual((ln['writer'], ln['run_id'], ln['ids'], ln['existing']),
                         ('propose_evidence_links', run, [a], [b]))
        self.assertEqual(ln['results'], {'proposed': 1, 'already_decided': 1, 'entity_is_owners_call': 1})

    def test_an_unknown_outcome_is_recorded(self):
        r = self.rest(urllib.error.URLError('timed out'))
        with self.assertRaises(common.RpcError):
            r.rpc('propose_change_claim', {'p_run_id': testdata.U('run'), 'p_claim': {}, 'p_support': []})
        self.assertEqual((self.lines()[0]['outcome'], self.lines()[0]['code']), ('unknown', 'client_timeout'))

    def test_returned_shapes(self):
        u = lambda *x: testdata.U(*x)  # noqa: E731
        res = {'items': [{'id': u('t'), 'result': 'rejected', 'decision_id': u('d1'), 'implied_decision_ids': [u('d2')],
                          'reassigned_to': u('c2'), 'reassign_result': {'items': [
                              {'id': u('c2'), 'result': 'confirmed', 'decision_id': u('d3'),
                               'implied_decision_ids': [u('d4')]}]}},
                         {'id': u('t2'), 'result': 'human_decision_newer'}]}
        r = manifest.returned('decide_evidence', {}, res)
        self.assertEqual(r['decision_ids'], [u('d1'), u('d3')])
        self.assertEqual(r['implied_decision_ids'], [u('d2'), u('d4')])
        self.assertEqual(set(r['ids']), {u('c2'), u('d1'), u('d2'), u('d3'), u('d4')})
        self.assertEqual(r['results']['human_decision_newer'], 1)
        r = manifest.returned('propose_capture_time_claims', {}, {'ids': [u('t1')], 'decision_ids': [u('d9')],
                                                                  'kept_stronger': 2})
        self.assertEqual((r['ids'], r['results']['kept_stronger']), ([u('t1'), u('d9')], 2))
        r = manifest.returned('propose_change_claim', {'p_support': [{}, {}]}, u('k'))
        self.assertEqual((r['ids'], r['support']), ([u('k')], [{'claim_id': u('k'), 'count': 2}]))
        r = manifest.returned('propose_claim_support', {'p_claim_id': u('k')}, 3)
        self.assertEqual(r['support'], [{'claim_id': u('k'), 'count': 3}])
        r = manifest.returned('decide_evidence', {}, {'items': [{'id': u('t'), 'result': 'rejected',
                                                                  'decision_id': u('d5'),
                                                                  'reassign_decision_id': u('d6')}]})
        self.assertEqual(r['reassign_decision_ids'], [u('d6')])

    def test_reconcile_finds_rows_no_call_returned(self):
        u = lambda *x: testdata.U(*x)  # noqa: E731
        lines = [{'writer': 'evidence_open_run', 'ids': [u('run')]},
                 {'writer': 'propose_evidence_links', 'run_id': u('run'), 'ids': [u('l1')]},
                 {'writer': 'propose_change_claim', 'ids': [u('k')], 'support': [{'claim_id': u('k'), 'count': 2}]},
                 {'writer': 'decide_evidence', 'ids': [u('d1'), u('d2')], 'implied_decision_ids': [u('d2')]}]
        created = {'evidence_runs': [u('run')], 'evidence_links': [u('l1'), u('l2')], 'vehicle_change_claims': [u('k')],
                   'vehicle_change_claim_support': {u('k'): 3},
                   'evidence_decisions': [{'id': u('d1'), 'by': 'agent:lead-1'},
                                          {'id': u('d2'), 'by': 'implied:' + u('d1')},
                                          {'id': u('d3'), 'by': 'implied:' + u('d1')},
                                          {'id': u('h'), 'by': 'human:' + u('owner')},
                                          {'id': u('p'), 'by': 'writer:promote_image', 'run': u('run')}]}
        m = manifest.reconcile(created, lines)
        self.assertEqual(m['by_table'], {'evidence_links': 1, 'evidence_decisions': 1})
        self.assertEqual(m['unmanifested'], 3)                    # l2, d3 and the support count
        self.assertEqual(m['support_mismatch'], [{'claim_id': u('k'), 'rows': 3, 'manifest': 2}])
        self.assertEqual(m['human_decisions_to_match_request_log'], 1)

    def test_a_manifest_that_cannot_be_written_stops(self):
        blocker = os.path.join(self.d, 'not-a-dir')
        Path(blocker).write_text('x')
        with self.assertRaises(common.StopLoop) as cm:
            manifest.Manifest(blocker).record('evidence_open_run', {}, testdata.U('run'))
        self.assertEqual(cm.exception.reason, 'manifest_write_failed')


class DbGate(unittest.TestCase):
    def test_db_mode_refused_without_the_flag(self):
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '', 'SUPABASE_URL': 'https://example.test',
                                          'SUPABASE_SERVICE_ROLE_KEY': 'k' * 40}):
            with self.assertRaises(SystemExit) as cm:
                common.Rest()
            self.assertIn('db mode refused', str(cm.exception))

    def test_key_never_shown(self):
        key = 'synthetic-service-key-' + 'x' * 30
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1', 'SUPABASE_URL': 'https://example.test',
                                          'SUPABASE_SERVICE_ROLE_KEY': key}):
            def opener(req, timeout=None):
                raise urllib.error.HTTPError(req.full_url, 401, 'no', {}, io.BytesIO(
                    json.dumps({'code': 'PGRST301', 'message': 'bad jwt ' + key}).encode()))
            r = common.Rest(opener=opener, manifest=manifest.Manifest(d))
            self.assertNotIn(key, repr(r))
            with self.assertRaises(common.RpcError) as cm:
                r.rpc('evidence_open_run', {})
            self.assertNotIn(key, str(cm.exception))
            self.assertIn('[service-role key]', str(cm.exception))
            self.assertFalse(list(Path(d).glob('*.jsonl')))          # a refused call created nothing

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
            h = FakeRest(fail={'promote_image': lambda args: {'result': 'halted', 'why': 'revert_watch',
                                                              'halting_images': 2}})
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
        Path(stop).write_text(T + '\n')
        with self.assertRaises(common.StopLoop):
            loop.stop_files(self.ctx)
        os.remove(stop)
        now = common.parse_ts('2031-06-01T12:00:00Z')
        Path(log).write_text('2031-06-01T11:55:00Z vehicle %s batch done\n' % T)
        with self.assertRaises(common.StopLoop):
            loop.stop_files(self.ctx, now=now)
        loop.stop_files(self.ctx, now=common.parse_ts('2031-06-02T12:00:00Z'))
        self.ctx.case.pop('stop_checks')


class ReviewSheet(SyntheticCase):
    def rows(self):
        return review_sheet.build_rows(self.ctx, self.files, readers.accounting(self.files, T))

    def test_one_question_one_place_per_row(self):
        rows, decisions = self.rows()
        self.assertEqual([d['letter'] for d in decisions], ['A'])          # spend: OWNER-DECISIONS, no evidence row
        self.assertTrue(all(r['targets'] for r in rows))
        photos = [r for r in rows if r['section'] == 'photos']
        self.assertEqual(len(photos), 35)
        self.assertTrue(all(sorted(t['target_kind'] for t in r['targets']) == ['image', 'image_candidate'] for r in photos))
        self.assertEqual(len([r for r in rows if r['section'] == 'accounts']), 3)
        money_rows = [r for r in rows if r['section'] == 'money']
        contested = [r for r in money_rows if 'also on' in r['question']]
        self.assertEqual(len(contested), 2)
        self.assertTrue(all(len([t for t in r['targets'] if t['target_kind'] == 'payment']) == 1 for r in contested))
        md = review_sheet.render(self.ctx, rows, '2031-06-01', decisions)
        self.assertNotIn('http', md)
        self.assertNotIn('120.10', md)
        gates = {r['id']: r['gate'] for r in common.load_json(os.path.join(os.path.dirname(self.td['case']),
                                                                          'image_rows.json'))['result']}
        for r in photos:
            img = next(t['key'] for t in r['targets'] if t['target_kind'] == 'image')
            self.assertEqual('review in the app' in r['question'], gates[img] != 'approved')

    def test_db_issue_stores_row_targets_and_leaves_off_rows_not_loaded(self):
        rows, decisions = self.rows()
        ids = {k: common.uuid5('id', k) for f in self.files if f.endswith('.jsonl') for k in
               (ln['key'] for ln in self.files[f])}
        dropped = next(t['key'] for t in rows[3]['targets'] if t['target_kind'] == 'image_candidate')
        del ids[dropped]
        rest = FakeRest()
        d = self.copy_out('sheet-db')
        side = review_sheet.issue(self.ctx, rows, decisions, '2031-06-01', d, common.DB, rest, testdata.OWNER, ids)
        cfg = [a for fn, a in rest.calls if fn == 'evidence_open_run'][0]['p_config']
        self.assertIsNone(payloads.review_rows_problem(cfg))
        self.assertEqual((cfg['items'], side['items'], len(side['left_off_not_loaded'])), (len(rows) - 1,) * 2 + (1,))
        self.assertEqual(cfg['sheet_sha256'], side['sheet_sha256'])
        self.assertEqual([fn for fn, _a in rest.calls], ['evidence_open_run', 'evidence_close_run'])


class Answers(SyntheticCase):
    def sheet(self, name):
        d = self.copy_out(name)
        rows, decisions = review_sheet.build_rows(self.ctx, self.files, readers.accounting(self.files, T))
        side = review_sheet.issue(self.ctx, rows, decisions, '2031-06-01', d)
        return d, os.path.join(d, 'review-2031-06-01.json'), side

    def store(self, sp, answers, mode=common.FILE):
        ap = os.path.join(os.path.dirname(sp), 'answers-in.json')
        common.dump_json(ap, answers)
        args = mock.Mock(sheet=sp, answers=ap, message_ref='session-1:msg-1', mode=mode, user=testdata.OWNER)
        with contextlib.redirect_stdout(io.StringIO()):
            record_answers.store(args, self.ctx)
        return common.load_json(record_answers.receipt_path(sp, common.load_json(sp)))

    def decide(self, d, sp, plan, mode=common.FILE, manifest_path=None):
        pp = os.path.join(d, 'plan.json')
        common.dump_json(pp, plan)
        args = mock.Mock(sheet=sp, receipt=os.path.join(d, 'answers-2031-06-01.json'), plan=pp,
                         agent_session='lead-session-1', manifest=manifest_path, mode=mode, user=testdata.OWNER)
        with contextlib.redirect_stdout(io.StringIO()):
            record_answers.decide(args, self.ctx)
        return common.load_json(os.path.join(d, 'decisions-2031-06-01.json'))

    @staticmethod
    def row(side, text, pkey=None):
        return next(r for r in side['rows'] if text in r['question'] and (pkey is None or pkey in r['question']))

    def test_structured_answers_are_stored_once_per_sheet(self):
        d, sp, side = self.sheet('answers-store')
        r = self.row(side, 'also on', pk('00206'))
        rc = self.store(sp, {str(r['row']): {'verbatim': 'no, that was the second truck',
                                             'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}}})
        stored = rc['rows'][str(r['row'])]
        self.assertEqual(stored['sha256'], common.sha256_text('no, that was the second truck'))
        self.assertEqual(stored['answer'], {'decision': 'rejected', 'vehicle_id': testdata.V['SUB']})
        self.assertNotIn('second truck', json.dumps(rc))
        with self.assertRaises(SystemExit):                     # one answer set per sheet
            self.store(sp, {'1': {'verbatim': 'yes', 'answer': {'decision': 'confirmed'}}})
        for bad in ({str(len(side['rows']) + 1): {'verbatim': 'x', 'answer': {'decision': 'confirmed'}}},
                    {'1': 'yes'}, {'1': {'verbatim': ' ', 'answer': {'decision': 'confirmed'}}},
                    {'1': {'verbatim': 'yes', 'answer': {'decision': 'confirmed', 'vehicle_id': T,
                                                         'entity_key': 'owner'}}}):
            with self.assertRaises(SystemExit):
                record_answers.validate_answers(self.ctx, side, bad)

    def test_decisions_follow_his_answer(self):
        d, sp, side = self.sheet('answers-decide')
        painter = self.row(side, 'also on', pk('00206'))
        job = self.row(side, 'also on', pk('00737'))
        photo = next(r for r in side['rows'] if r['section'] == 'photos')
        acct = next(r for r in side['rows'] if r['section'] == 'accounts')
        self.store(sp, {
            str(painter['row']): {'verbatim': 'the second truck', 'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}},
            str(job['row']): {'verbatim': 'that was the side job', 'answer': {'decision': 'confirmed',
                                                                               'subject_key': 'label:' + testdata.JOB}},
            str(photo['row']): {'verbatim': 'yes', 'answer': {'decision': 'confirmed'}},
            str(acct['row']): {'verbatim': 'not sure', 'answer': {'decision': 'unsure'}}})
        truck_link = lambda r: next(t['key'] for t in r['targets']  # noqa: E731
                                    if t['target_kind'] == 'evidence_link' and t['key'].endswith(T[:8]))
        label_link = next(t['key'] for t in job['targets'] if t['target_kind'] == 'evidence_link'
                          and t['key'].endswith('label:' + testdata.JOB))
        cand = next(t['key'] for t in photo['targets'] if t['target_kind'] == 'image_candidate')
        dec = self.decide(d, sp, [
            {'row': painter['row'], 'target_kind': 'evidence_link', 'targets': [truck_link(painter)],
             'decision': 'rejected', 'reassign_vehicle': 'SUB'},
            {'row': job['row'], 'target_kind': 'evidence_link', 'targets': [label_link], 'decision': 'confirmed'},
            {'row': job['row'], 'target_kind': 'evidence_link', 'targets': [truck_link(job)], 'decision': 'rejected'},
            {'row': photo['row'], 'target_kind': 'image_candidate', 'targets': [cand], 'decision': 'confirmed'}])
        self.assertEqual(dec[0]['reassign_to'], 'link:pnl:disposition:R000000000206@%s' % testdata.V['SUB'][:8])
        after = readers.extract_m5(readers.accounting(self.files, T, dec))
        self.assertIn(pk('00206'), after['bands']['rejected'])
        self.assertIn(pk('00737'), after['bands']['rejected'])
        refusals = [
            ({'row': painter['row'], 'target_kind': 'evidence_link', 'targets': [truck_link(painter)],
              'decision': 'confirmed'}, 'does not support'),             # his answer placed it elsewhere
            ({'row': painter['row'], 'target_kind': 'evidence_link', 'targets': [truck_link(painter)],
              'decision': 'rejected', 'reassign_vehicle': 'TWIN'}, 'reassign'),
            ({'row': photo['row'], 'target_kind': 'evidence_link', 'targets': [truck_link(painter)],
              'decision': 'confirmed'}, 'not on row'),
            ({'row': photo['row'], 'target_kind': 'image_candidate', 'targets': [cand], 'decision': 'rejected'},
             'does not support'),                                         # a bare yes decides only a yes
            ({'row': acct['row'], 'target_kind': 'account_entity', 'decision': 'confirmed'}, 'nothing is decided'),
            ({'row': 1, 'target_kind': 'change_claim', 'decision': 'confirmed'}, 'no stored answer')]
        for plan, why in refusals:
            with self.assertRaises(SystemExit) as cm:
                self.decide(d, sp, [plan])
            self.assertIn(why, str(cm.exception))

    def test_owner_statement_cites_his_answer(self):
        d, sp, side = self.sheet('answers-statement')
        line = self.row(side, "line 'paint'")
        self.store(sp, {str(line['row']): {'verbatim': 'my business paid the painter',
                                           'answer': {'decision': 'confirmed', 'entity_key': 'owner_business:synthetic'}}})
        self.decide(d, sp, [{'row': line['row'], 'owner_statement': {
            'vehicle': 'TRUCK', 'role': 'payment_out', 'side': 'payer', 'payment_key': True,
            'amount': ['jacket3', 'line:paint'], 'occurred_on': '2032-02-04', 'source_label': 'paint'}}])
        st = common.read_jsonl(os.path.join(d, 'owner-statements-2031-06-01.jsonl'))[0]['row']
        self.assertRegex(st['external_ref'], payloads.C['answer_ref_re'])
        self.assertEqual(st['payment_key'], 'owner:' + st['external_ref'])
        self.assertEqual(st['payer_entity'], 'owner_business:synthetic')
        with self.assertRaises(SystemExit):                     # the answer names no payee entity... nor an amount
            self.decide(d, sp, [{'row': line['row'], 'owner_statement': {'vehicle': 'TRUCK', 'side': 'payer'}}])

    @mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'})
    def test_db_results_are_reported_never_retried(self):
        d, sp, side = self.sheet('answers-db')
        side['sheet_run'] = testdata.U('sheet-run')
        common.dump_json(sp, side)
        painter = self.row(side, 'also on', pk('00206'))
        fake = FakeRest(decide=lambda args: {'items': [{'id': i, 'result': 'human_decision_newer'}
                                                       for i in args['p_target_ids']]})
        with mock.patch.object(common, 'Rest', lambda *a, **k: fake):
            rc = self.store(sp, {str(painter['row']): {'verbatim': 'the second truck',
                                                       'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}}},
                            common.DB)
            ids = {t['key']: common.uuid5('id', t['key']) for t in painter['targets']}
            mp = os.path.join(d, 'load-manifest.json')
            common.dump_json(mp, {'ids': ids})
            key = next(t['key'] for t in painter['targets'] if t['target_kind'] == 'evidence_link'
                       and t['key'].endswith(T[:8]))
            out = self.decide(d, sp, [{'row': painter['row'], 'target_kind': 'evidence_link', 'targets': [key],
                                       'decision': 'rejected', 'reassign_vehicle': 'SUB'}], common.DB, mp)
        calls = [a for fn, a in fake.calls if fn == 'decide_evidence']
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]['p_answer_ref'], 'answers:%s#%d' % (rc['answers_run'], painter['row']))
        self.assertEqual(calls[0]['p_review_ref'], 'review:%s#%d' % (side['sheet_run'], painter['row']))
        self.assertEqual(out[0]['result']['items'][0]['result'], 'human_decision_newer')
        rec = [a for fn, a in fake.calls if fn == 'evidence_record_answers'][0]
        self.assertEqual(rec['p_rows'][str(painter['row'])]['answer'], {'decision': 'rejected',
                                                                         'vehicle_id': testdata.V['SUB']})


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
        out = scoreboard.run(Pre(), testdata.OWNER, T, only=['M1', 'M7', 'M2'])
        self.assertEqual(out['M1']['value'], 16)
        self.assertIn('pre-store', out['M1']['basis'])
        self.assertIn('error', out['M2'])

    def test_scoreboard_sql_blocks(self):
        st = scoreboard.parse()
        names = {n: (m, s) for n, m, s in st}
        for m in ('M1', 'M2', 'M3', 'M4', 'M4a', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10_channels', 'M10_guards',
                  'M10_stamps', 'M10_integrity', 'M10_frameless', 'M10b', 'M11', 'M12', 'M13', 'M13_open_proposals',
                  'M14'):
            self.assertIn(m, names)
        self.assertEqual(names['M1'][0], 'chunked')
        self.assertEqual(names['M10b'][0], 'manifest')
        self.assertIn('vehicle_accounting_evidence(:vehicle_id, NULL, NULL, :uid)', names['M5'][1])
        self.assertIn("x->>'to_account_ref', x->>'payer', x->>'payee'", names['M5'][1])
        out = io.StringIO()
        scoreboard.run(None, testdata.OWNER, T, st, dry_run=True, printer=lambda s: out.write(s))
        self.assertNotIn(testdata.OWNER, out.getvalue())
        self.assertIn('<uid>', out.getvalue())
        q = scoreboard.quarters()
        self.assertEqual((q[0][0], q[-1][1], len(q)), ('2023-12-31', '2026-01-02', 8))
        sql = Path(scoreboard.SQL_FILE).read_text()
        self.assertNotRegex(sql, r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')

    def test_m10b_and_integrity_through_the_scoreboard(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        u = testdata.U
        now = common.utc_now()
        m = manifest.Manifest(d, clock=lambda: now)
        m.record('evidence_open_run', {}, u('run'))
        m.record('propose_evidence_links', {'p_run_id': u('run')},
                 {'items': [{'ref': 'x', 'result': 'proposed', 'link_id': u('l1')}]})

        class R:
            def read(self, sql, params=None, tag=None):
                if tag == 'M10b':
                    return [{'t': 'evidence_runs', 'x': [u('run')]},
                            {'t': 'evidence_links', 'x': json.dumps([u('l1'), u('l9')])},
                            {'t': 'vehicle_change_claim_support', 'x': {}},
                            {'t': 'evidence_decisions', 'x': []}]
                if tag == 'M10_integrity':
                    return [{'always_on': 26, 'total': 27, 'md5s': {'propose_evidence_links': 'a' * 32}}]
                return []
        out = scoreboard.run(R(), testdata.OWNER, T, only=['M10b', 'M10_integrity'], manifest_dir=d,
                             since=common.iso_utc(now), deployed_md5s={'propose_evidence_links': 'b' * 32})
        self.assertEqual((out['M10b']['unmanifested'], out['M10b']['examples']), (1, {'evidence_links': [u('l9')]}))
        self.assertEqual(scoreboard.scalar(out['M10b']), 1)
        self.assertEqual(out['M10_integrity']['drifted'], ['propose_evidence_links'])
        self.assertIn('guard triggers', scoreboard.integrity_failed(out['M10_integrity']))
        self.assertIsNone(scoreboard.integrity_failed({'always_on': 27, 'total': 27, 'drifted': []}))


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
        self.assertEqual(rep['exit_test']['blocked'], 0)
        self.assertEqual({f: rep['files'].get(f, 0) for f in EXPECTED}, EXPECTED)
        self.assertEqual(rep['review_sheet']['decisions'], 1)
        for f in ('checks.json', 'load-plan.json', 'exit-test-2031-06-01.json', 'review-2031-06-01.md'):
            self.assertTrue(os.path.exists(os.path.join(out, f)), f)


class CustodyBounds(SyntheticCase):
    def test_an_upper_bound_from_the_first_own_photo_day(self):
        import pass_custody_bounds
        b = passlib.Built()
        for f, lines in self.built.files.items():
            if f != 'change_claims.jsonl':
                for ln in lines:
                    b.add(f, ln)
        self.ctx.case['passes']['custody_bounds'] = {'vehicles': ['TRUCK'], 'confidence': 0.9}
        res = pass_custody_bounds.build(self.ctx, b)
        self.assertEqual(res['custody_bounds']['emitted'], 1)
        c = b.claims()[0]['p_claim']
        # the yard visit (flagged) and the seller's frames (third party) do not bound custody; no start date
        self.assertEqual((c['kind'], c.get('occurred_from'), c['occurred_to'], c['confidence']),
                         ('acquisition', None, '2031-01-18', 0.5))
        self.ctx.case['passes']['custody_bounds'] = {'vehicles': ['TRUCK'], 'claims': [{'kind': 'sale'}]}
        with self.assertRaises(common.EvidenceError):
            pass_custody_bounds.build(self.ctx, passlib.Built())
        self.ctx.case['passes']['custody_bounds'] = {'vehicles': ['TRUCK']}


class BatchOffsets(unittest.TestCase):
    def test_unjoined_rows_take_their_batch_offset_and_the_gate_counts_per_upload_day(self):
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
        self.assertTrue(all(r['witness']['upload_day'] == '2033-03-01' for r in batch))
        gate = [r for r in common.load_json(os.path.join(tmp, 'out', 'run.json'))['runs'] if r['key'] == 'run:time_rule_gate']
        g = gate[0]['close']['counts']['batches']
        self.assertEqual(g['ssd_blast|pool|2033-0700']['joined'], 24)
        self.assertEqual(g['ssd_blast|pool|2033-0700']['worst_day_agreement'], 1.0)
        self.assertEqual(g['ssd_blast|pool|2033-0700']['days'], {'2033-03-01': {'joined': 24, 'agreement': 1.0,
                                                                                'offset_seconds': 0}})
        self.assertEqual(g['user_upload|2033-03-01|-0700']['offset_seconds'], -10800)
        self.assertEqual(counts['candidates.combined.jsonl'], 128)
        ld = loader.Loader(ctx, common.FILE)
        ld.load_dir(str(ctx.out))
        conf = [c for c in ld.calls if c['writer'] == 'confirm_capture_times_by_rule']
        self.assertEqual([c['rows'] for c in conf], [5])


if __name__ == '__main__':
    unittest.main(verbosity=1)

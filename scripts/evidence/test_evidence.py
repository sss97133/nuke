#!/usr/bin/env python3
"""Offline contracts for the image-evidence runner (draft.sql v8): every pass in file mode on synthetic pilot-shaped
inputs (no real id, amount, path, model, vendor or person name), the CHECK rules, the file-mode readers and the exit
test, the loader's batching, gates and reported outcomes, db-mode refusal and stop conditions against a fake
PostgREST, the manifest of returned ids and its M10b reconciliation, review rows that ask one question in one
dimension, the sheet's delivery and his reply (one transcription per message, checked against a synthetic chat
transcript), his stored answers (verbatim, an optional reading; storing decides nothing, and no job decides or writes
his word), who-paid rows, the second reader and disputed rows, the pinned-source refusals, promotion guards, the
scoreboard SQL and the read path. No network, no database, no Photos library; the loop's local records and the
transcripts live in a temp dir.

Run: python3 scripts/evidence/test_evidence.py
"""
import atexit
import contextlib
import datetime as dt
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

# Hermetic: the loop's local records (sheets index, disputed rows, manifests, config) and the chat transcripts the
# answer checks read point into a temp dir, never at ~/nuke-logs or ~/.claude. Set before common is imported (it reads
# the loop dir at import time).
LOOP_TMP = tempfile.mkdtemp(prefix='evidence-loop-')
atexit.register(shutil.rmtree, LOOP_TMP, True)
for _k in ('EVIDENCE_SHEETS_INDEX', 'EVIDENCE_DISPUTED', 'EVIDENCE_MANIFEST_DIR', 'EVIDENCE_PINNED_SOURCES',
           'EVIDENCE_OWNER_ID'):
    os.environ.pop(_k, None)
os.environ['EVIDENCE_LOOP_DIR'] = LOOP_TMP
os.environ['EVIDENCE_TRANSCRIPTS'] = os.path.join(LOOP_TMP, 'transcripts')

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
import transcript  # noqa: E402

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

    def test_a_job_never_writes_his_word(self):
        """(v8) an owner statement, an owner: key and a rule 'owner' capture time come only from his decision."""
        ref = payloads.answer_ref(testdata.U('answers'), 4)
        self.assertCaught(lambda ls: ls[0]['row'].update(source_kind='owner_statement', external_ref=ref),
                          'owner_answer_missing')
        self.assertCaught(lambda ls: ls[0]['row'].update(payment_key='owner:' + ref), 'owner_answer_missing')
        self.assertCaught(lambda ls: ls[0]['row'].update(rule='owner', witness=dict(ls[0]['row']['witness'],
                                                                                      answer_ref=ref)),
                          'owner_answer_missing', 'time_claims.jsonl')

        def owner_review(run):
            run['runs'][0]['args']['p_pass'] = 'owner_review'
            run['runs'][0]['key'] = 'run:owner_review'
        self.assertCaught(owner_review, 'never opens an owner_review run', 'run.json')

    def test_account_refs_that_look_like_account_numbers(self):
        self.assertCaught(lambda ls: ls[0]['row'].update(from_account_ref='bank_account:acct_12345678'),
                          'looks like an account number')

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

    def test_every_writer_called_is_one_the_guard_admits_and_none_decides(self):
        self.assertLessEqual(set(payloads.CONTRACT['writers']), set(payloads.CONTRACT['writer_names']))
        # (v8) decide_evidence is his own session's writer: the runner has no entry for it, and no builder
        self.assertNotIn('decide_evidence', payloads.CONTRACT['writers'])
        self.assertFalse(hasattr(payloads, 'decide'))
        self.assertIn('evidence_answers_to_confirm', payloads.CONTRACT['readers'])

    def test_builders_refuse_unknown_fields_and_own_writer_runs(self):
        with self.assertRaises(ValueError):
            payloads._clean('link', {'bogus': 1})
        for kind, name in (('probe', 'probe'), ('review_answers', 'review_sheet'), ('pilot', 'owner_review')):
            with self.assertRaises(ValueError):
                payloads.open_run('u', kind, name, 'p', 'v', {})

    def test_parties_are_third_parties_or_null(self):
        row = payloads.evidence_link(T, 'ledger_line', 'payment_out', 'j', 0.5, [{'k': 1}], external_ref='x',
                                     amount_cents='@amount:l:1', payer_entity='owner', payee_entity='third_party:shop')
        self.assertNotIn('payer_entity', row)
        self.assertEqual(row['payee_entity'], 'third_party:shop')
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
        # (v6, RU4/RU9) closed_accounts: a subset of covers_accounts, only with a real coverage date
        payloads.open_run('u', 'pilot', 'ledger_vendor_date', 'p', 'v', {
            'coverage_to': '2032-12-31', 'covers_accounts': ['bank_account:a', 'bank_account:b'],
            'closed_accounts': ['bank_account:b']})
        for bad in ({'coverage_to': '2032-12-31', 'covers_accounts': ['bank_account:a'],
                     'closed_accounts': ['bank_account:b']},
                    {'closed_accounts': ['bank_account:a']},
                    {'coverage_to': '2032-02-30', 'covers_accounts': ['bank_account:a']}):
            with self.assertRaises(ValueError):
                payloads.open_run('u', 'pilot', 'ledger_vendor_date', 'p', 'v', bad)
        # (v7, F7c) a statement cannot cover days that have not happened (the run's day, when the caller knows it)
        cfg = {'coverage_to': '2032-12-31', 'covers_accounts': ['bank_account:a']}
        self.assertIn('later than the run day', payloads.coverage_problem('ledger_vendor_date', cfg,
                                                                          common.parse_ts('2032-12-30').date()))
        self.assertIsNone(payloads.coverage_problem('ledger_vendor_date', cfg, common.parse_ts('2032-12-31').date()))
        img = testdata.U('image', 1)
        ok = {'sheet_sha256': 'x', 'items': 2, 'rows': {
            '1': {'targets': [{'kind': 'image_candidate', 'id': testdata.U('c')}, {'kind': 'image', 'id': img}]},
            '2': {'targets': [{'kind': 'payment', 'key': pk('00206')}]}}}
        payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', ok)
        reask = 'review:%s#4' % testdata.U('sheet-run')
        payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', dict(ok, rows=dict(ok['rows'], **{
            '2': {'reask_of': reask}})))                       # (v9, W2) the writer copies that sent row as frozen
        many = {str(n): {'targets': [{'kind': 'payment', 'key': 'bank:%d-%d' % (n, k)} for k in range(200)]}
                for n in range(1, 51)}
        payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', dict(ok, items=50, rows=many))     # 10,000 targets
        many['51'] = {'targets': [{'kind': 'payment', 'key': 'bank:one-more'}]}
        for bad in ({'1': ok['rows']['1']}, dict(ok['rows'], **{'2': {'targets': []}}),
                    dict(ok['rows'], **{'2': {'targets': [{'kind': 'account', 'key': 'my checking'}]}}),
                    dict(ok['rows'], **{'2': {'targets': [{'kind': 'payment', 'key': pk('00206')},
                                                          {'kind': 'account', 'key': 'bank_account:a'}]}}),
                    dict(ok['rows'], **{'2': {'reask_of': reask, 'question': 'evidence_link'}}),
                    dict(ok['rows'], **{'2': {'reask_of': 'review:x#4'}})):
            with self.assertRaises(ValueError):
                payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', dict(ok, rows=bad))
        with self.assertRaises(ValueError) as cm:                # (v9, M8) at most 10,000 targets on a sheet
            payloads.open_run('u', 'review', 'review_sheet', 'p', 'v', dict(ok, items=51, rows=many))
        self.assertIn('10000 targets', str(cm.exception))

    def test_one_question_per_row(self):
        img, cand = testdata.U('image', 1), testdata.U('cand')
        rq = payloads.row_question
        self.assertEqual(rq({'targets': [{'kind': 'image_candidate', 'id': cand}, {'kind': 'image', 'id': img}]}),
                         'image_candidate')
        self.assertEqual(rq({'targets': [{'kind': 'image', 'id': img}], 'question': 'image_publication'}),
                         'image_publication')
        self.assertEqual(rq({'targets': [{'kind': 'payment', 'key': pk('00206')}]}), 'evidence_link')
        self.assertEqual(rq({'targets': [{'kind': 'account', 'key': testdata.LEDGER_ACCOUNT}]}), 'account_entity')
        for bad in ({'targets': [{'kind': 'image', 'id': img}]},                  # an image-only row names its question
                    {'targets': [{'kind': 'payment', 'key': pk('00206')},
                                 {'kind': 'account', 'key': testdata.LEDGER_ACCOUNT}]},     # two kinds
                    {'targets': [{'kind': 'account_entity', 'id': cand}], 'question': 'evidence_link'},
                    {'targets': [{'kind': 'evidence_link', 'id': cand}, {'kind': 'image', 'id': img}]},
                    {'targets': [{'kind': 'image', 'id': img}], 'question': 'album_map'},
                    {'targets': [{'kind': 'payment', 'key': pk('00206')}], 'asks': 'who'},
                    # (v7, D2; v8) a who-paid row lists exactly one link or one acquisition/sale claim
                    {'targets': [{'kind': 'payment', 'key': pk('00206')}], 'asks': 'party'},
                    {'targets': [{'kind': 'evidence_link', 'id': cand}, {'kind': 'evidence_link', 'id': img}],
                     'asks': 'party'}):
            with self.assertRaises(ValueError):
                rq(bad)
        self.assertEqual(rq({'targets': [{'kind': 'change_claim', 'id': cand}], 'asks': 'party'}), 'change_claim')

    def test_structured_answers(self):
        good = [{'decision': 'confirmed'}, {'decision': 'rejected', 'vehicle_id': T},
                {'decision': 'confirmed', 'subject_key': 'label:JOB-SIDE'},
                {'decision': 'confirmed', 'entity_key': 'owner_business:synthetic'},
                {'decision': 'rejected', 'captured_on': '2031-04-21'}, {'decision': 'unsure'}]
        for a in good:
            self.assertIsNone(payloads.answer_problem(a), a)
        bad = [{'decision': 'yes'}, {'decision': 'confirmed', 'vehicle_id': T, 'entity_key': 'owner'},
               {'decision': 'unsure', 'vehicle_id': T}, {'decision': 'confirmed', 'subject_key': 'the job'},
               {'decision': 'confirmed', 'entity_key': 'my business'}, {'decision': 'confirmed', 'note': 'x'},
               {'decision': 'rejected', 'captured_on': 'last week'}, 'yes']
        for a in bad:
            self.assertIsNotNone(payloads.answer_problem(a), a)
        rows = {'3': {'verbatim': 'no, the second truck', 'answer': {'decision': 'rejected', 'vehicle_id': T}},
                '4': {'verbatim': 'hmm, the blue one maybe'}}           # (v8) no reading: his words alone
        at = '2031-06-01T18:00:00.250Z'                                 # (v9) the message's own time
        args = payloads.record_answers('u', 's', ' Session-1:MSG-1 ', rows, 'p', 'v', at)
        self.assertEqual(args['p_rows'], {'3': rows['3'], '4': {'verbatim': 'hmm, the blue one maybe'}})
        self.assertEqual(args['p_message_ref'], 'session-1:msg-1')          # stored lower-cased (v7, D4)
        self.assertEqual(args['p_message_at'], '2031-06-01T18:00:00.250000+00:00')
        self.assertEqual(list(payloads.rpc_args('evidence_record_answers', args))[-1], 'p_message_at')
        self.assertEqual(payloads.message_id(' Session-1:MSG-1 '), 'msg-1')
        for bad_rows in ({'3': 'no, the second truck'}, {'3': {'verbatim': 'x', 'answer': 'yes'}}, {},
                         {'3': {'verbatim': 'x' * 20001}}):                # (v9) at least one row, 20,000 characters
            with self.assertRaises(ValueError):
                payloads.record_answers('u', 's', 'session-1:msg-1', bad_rows, 'p', 'v', at)
        payloads.record_answers('u', 's', 'session-1:msg-1', {'3': {'verbatim': 'x' * 20000}}, 'p', 'v', at)
        # (v9) the message time is the transcript's, with its zone; never missing
        for bad_at in (None, '', '2031-06-01', '2031-06-01T18:00:00', 'yesterday', '2031-13-01T18:00:00Z'):
            with self.assertRaises(ValueError):
                payloads.record_answers('u', 's', 'session-1:msg-1', rows, 'p', 'v', bad_at)
        self.assertEqual(payloads.message_time('2031-06-01T11:00:00-07:00'), payloads.message_time(
            '2031-06-01T18:00:00Z'))
        # (v7, D4) '<source>:<message id>': exactly one colon, no path, no dots, at most 200 characters
        for ref in ('msg-1', 'session 1:msg-1', 's:' + 'x' * 199, None, 'session-1:msg:1', 'session.1:msg-1',
                    'session-1:/tmp/reply.txt'):
            with self.assertRaises(ValueError):
                payloads.record_answers('u', 's', ref, rows, 'p', 'v', at)
        self.assertEqual(payloads.answer_place({'decision': 'confirmed', 'entity_key': 'owner'}), 'entity:owner')
        self.assertEqual(payloads.answer_place({'decision': 'rejected', 'captured_on': '2031-04-21'}), 'day:2031-04-21')

    def test_readings_by_row_dimension_never_inverted(self):
        """(v6, AC1-AC4) evidence_record_answers' rules over the row profile evidence_sheet_row derives."""
        def prof(**kw):
            return dict({'row': 1, 'asks': 'place', 'asked_place': T, 'frame': None, 'link_class': None}, **kw)
        S = testdata.V['SUB']
        photo = prof(question='image_candidate', frame='subject')
        where = prof(question='evidence_link', link_class='placement', asked_place=None)
        multi = prof(question='image_candidate', frame='subject', asked_place='multi')
        share = prof(question='evidence_link', link_class='share')
        contra = prof(question='evidence_link', link_class='contradicts')
        acct = prof(question='account_entity', asked_place='entity:owner')
        paid = prof(question='evidence_link', link_class='placement', asks='party')
        when = prof(question='capture_time_claim', asked_place='day:2031-04-20')
        claim = prof(question='change_claim')
        cases = [
            (photo, {'decision': 'confirmed'}, None), (photo, {'decision': 'confirmed', 'vehicle_id': T}, None),
            (photo, {'decision': 'rejected', 'vehicle_id': S}, None),
            (photo, {'decision': 'rejected', 'subject_key': 'label:X'}, None),
            (photo, {'decision': 'confirmed', 'vehicle_id': S}, 'a yes names the place'),
            (photo, {'decision': 'rejected', 'vehicle_id': T}, 'is a bare'),
            (photo, {'decision': 'confirmed', 'entity_key': 'owner'}, 'its answer names'),
            (where, {'decision': 'confirmed', 'subject_key': 'label:JOB-SIDE'}, None),
            (where, {'decision': 'unsure'}, None),
            (where, {'decision': 'confirmed'}, 'asks where'),
            (where, {'decision': 'rejected', 'vehicle_id': S}, 'asks where'),
            (multi, {'decision': 'rejected'}, None), (multi, {'decision': 'confirmed', 'vehicle_id': T}, 'no place'),
            (share, {'decision': 'confirmed'}, None), (share, {'decision': 'rejected', 'vehicle_id': S}, 'no place'),
            (contra, {'decision': 'confirmed'}, None), (contra, {'decision': 'confirmed', 'vehicle_id': T}, 'no place'),
            (acct, {'decision': 'rejected', 'entity_key': 'owner_business:x'}, None),
            (acct, {'decision': 'confirmed', 'entity_key': 'owner'}, None),
            (acct, {'decision': 'confirmed', 'entity_key': 'owner_business:x'}, 'a yes names the place'),
            (acct, {'decision': 'rejected', 'entity_key': 'owner'}, 'is a bare'),
            (paid, {'decision': 'confirmed', 'entity_key': 'third_party:seller'}, None),
            (paid, {'decision': 'unsure'}, None),
            (paid, {'decision': 'confirmed'}, 'who-paid'), (paid, {'decision': 'rejected', 'entity_key': 'owner'}, 'who-paid'),
            (paid, {'decision': 'confirmed', 'vehicle_id': T}, 'its answer names'),
            (when, {'decision': 'rejected', 'captured_on': '2031-04-21'}, None), (when, {'decision': 'confirmed'}, None),
            (when, {'decision': 'rejected', 'captured_on': '2031-04-20'}, 'is a bare'),
            (when, {'decision': 'confirmed', 'captured_on': '2031-04-21'}, 'a yes names the place'),
            (claim, {'decision': 'rejected'}, None), (claim, {'decision': 'confirmed', 'vehicle_id': T}, 'no place')]
        for p, ans, why in cases:
            got = payloads.answer_problem(ans, p)
            if why is None:
                self.assertIsNone(got, (p['question'], p['asked_place'], ans))
            else:
                self.assertIn(why, got or '', (p['question'], p['asked_place'], ans))
        self.assertEqual(payloads.answer_dimension(paid), ['entity_key'])
        self.assertEqual(payloads.answer_dimension(photo), ['vehicle_id', 'subject_key'])
        self.assertEqual(payloads.answer_dimension(when), ['captured_on'])
        self.assertEqual(payloads.answer_dimension(dict(photo, frame='mixed')), [])
        self.assertEqual(payloads.answer_dimension(dict(where, link_class='mixed')), [])

    def test_a_job_never_writes_his_word(self):
        """(v8) his day, his statement and an owner: key come only from his own decision in the app."""
        ref = payloads.answer_ref(testdata.U('answers'), 7)
        args = (testdata.U('image', 1), '2031-04-20T18:00:00+00:00', '2031-04-21T01:00:00+00:00', '2031-04-20', 'owner')
        with self.assertRaises(ValueError):
            payloads.capture_time_claim(*args, {'answer_ref': ref}, 0.9)
        for kw in ({'source_kind': 'owner_statement', 'external_ref': ref},
                   {'source_kind': 'note', 'external_ref': 'note:x', 'payment_key': 'owner:' + ref}):
            sk = kw.pop('source_kind')
            with self.assertRaises(ValueError):
                payloads.evidence_link(T, sk, 'payment_out', 'j', 0.9, [{'k': 1}], amount_cents='@amount:l:1', **kw)

    def test_link_classes_and_reported_outcomes(self):
        lc = payloads.link_class
        self.assertEqual([lc('payment_out', None, 'bank_line'), lc('assertion', None, 'deal_jacket'),
                          lc('payment_out', '@amount:x:1', 'pnl_line'), lc('context', None, 'photos_album'),
                          lc('contradicts', None, 'message'), lc('supports', None, 'deal_document')],
                         ['placement', 'placement', 'share', 'album', 'contradicts', 'other'])
        self.assertEqual(set(payloads.C['reported_outcomes']), {
            'already_decided', 'already_rejected', 'owner_answer_missing', 'kept_stronger', 'entity_is_owners_call',
            'unchanged', 'claim_carries_owner_decision', 'claim_not_current'})


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
        sessions = readers.sessions_of(self.ctx)
        # (v6, RU2) the session another user logged on the truck is never his work day
        self.assertNotIn(testdata.SELLER_DAY, [s['day'] for s in sessions])
        v = readers.accounting(self.files, T, sessions=sessions)
        self.assertEqual([(d['day'], d['sessions'], d['in_custody']) for d in v['session_days']],
                         [(testdata.DOC_DAY, 1, False)])

    def test_a_windowed_read_dates_a_payment_by_its_payment_source(self):
        v = readers.accounting(self.files, T, date_from='2031-05-27', date_to='2031-05-27')
        self.assertEqual(v['payments_outside_window'], [{'payment_key': pk('00770'), 'paid_on': '2031-05-28'}])
        self.assertNotIn(pk('00770'), readers.extract_m5(v)['band_links'])

    def test_a_windowed_read_lists_undated_payments_apart(self):
        """(v6, RU3) a payment with no date is never banded in a windowed read; an all-evidence read bands it."""
        undated = payloads.line('link:note:undated@%s' % T[:8], 'propose_evidence_links', 'ledger_vendor_date',
                                payloads.evidence_link(T, 'note', 'payment_out', 'synthetic', 0.6, [{'kind': 'note'}],
                                                       external_ref='note:undated', payment_key='bank:SYNTH-UNDATED'))
        f = dict(self.files, **{'links.jsonl': list(self.files['links.jsonl']) + [undated]})
        v = readers.accounting(f, T, date_from='2031-01-01', date_to='2032-12-31')
        self.assertEqual(v['payments_undated'], [{'payment_key': 'bank:SYNTH-UNDATED', 'links': 1}])
        m5 = readers.extract_m5(v)
        self.assertFalse([b for b, keys in m5['bands'].items() if 'bank:SYNTH-UNDATED' in keys])
        self.assertEqual(m5['payments_undated'], ['bank:SYNTH-UNDATED'])
        whole = readers.extract_m5(readers.accounting(f, T))
        self.assertIn('bank:SYNTH-UNDATED', whole['bands']['med'])
        self.assertEqual(whole['payments_undated'], [])

    def test_closed_and_third_party_accounts_leave_the_coverage(self):
        """(v6, RU4) coverage counts his open accounts; a lagging one is asked about; an assertion names what it waits
        on; a closed account (its final statement read) or a third party's (his confirmed map) waits on nothing."""
        share = {'key': 'run:qb_correlation', 'writer': 'evidence_open_run', 'args': {
            'p_pass': 'qb_correlation', 'p_config': {'coverage_to': '2032-01-31',
                                                     'covers_accounts': [testdata.SHARE_ACCOUNT]}}}
        run = json.loads(json.dumps(self.files['run.json']))
        run['runs'].append(share)
        f = dict(self.files, **{'run.json': run})
        v = readers.accounting(f, T)
        self.assertEqual(v['money_sources_cover_to'], '2032-01-31')
        self.assertEqual([q for q in v['open_questions'] if q['q'] == 'money_source_behind'], [{
            'q': 'money_source_behind', 'account_ref': testdata.SHARE_ACCOUNT, 'coverage_to': '2032-01-31',
            'newest_coverage': testdata.COVER_TO}])
        waiting = [q for q in v['open_questions'] if q['q'] == 'awaiting_statement']
        self.assertEqual(sorted(q['ref'] for q in waiting), sorted(
            testdata.JACKET_REF + '#' + a for a in ('line:labour', 'line:paint', 'line:dry_ice', 'line:corner')))
        self.assertTrue(all(q['waiting_on'] == [testdata.SHARE_ACCOUNT] for q in waiting))
        share_map = next(ln['key'] for ln in self.files['account_entities.jsonl']
                         if ln['row']['account_ref'] == testdata.SHARE_ACCOUNT)
        mapped = readers.accounting(f, T, [{'target': share_map, 'decision': 'confirmed'}])
        closed_run = json.loads(json.dumps(run))
        closed_run['runs'][-1]['args']['p_config']['closed_accounts'] = [testdata.SHARE_ACCOUNT]
        closed = readers.accounting(dict(f, **{'run.json': closed_run}), T)
        self.assertEqual(closed['money_sources_closed'], [testdata.SHARE_ACCOUNT])
        for w in (mapped, closed):
            self.assertEqual(w['money_sources_cover_to'], testdata.COVER_TO)
            self.assertFalse([q for q in w['open_questions'] if q['q'] in ('money_source_behind', 'awaiting_statement')])
        # (v7, F7b) "closed" is the newest covering run's word: a later export that is not final reopens it
        reopened = json.loads(json.dumps(closed_run))
        reopened['runs'].append(dict(share, key='run:receipt_vehicle_id', args=dict(share['args'], p_pass='receipt_vehicle_id')))
        self.assertEqual(readers.accounting(dict(f, **{'run.json': reopened}), T)['money_sources_closed'], [])

    def test_an_account_no_run_covers_is_waited_on_by_name(self):
        """(v7, F7a) an assertion naming an account no statement covers waits on that account: money_source_missing."""
        orphan = 'bank_account:synthetic_card'
        line = next(ln for ln in self.files['links.jsonl'] if ln['key'].endswith('#line:corner@%s' % T[:8]))
        moved = dict(line, row=dict(line['row'], from_account_ref=orphan))
        f = dict(self.files, **{'links.jsonl': [moved if ln is line else ln for ln in self.files['links.jsonl']]})
        v = readers.accounting(f, T)
        corner = [q for q in v['open_questions'] if q.get('ref', '').endswith('#line:corner')]
        self.assertEqual([(q['q'], q.get('waiting_on')) for q in corner], [('awaiting_statement', [orphan])])
        self.assertIn({'q': 'money_source_missing', 'account_ref': orphan}, v['open_questions'])

    def test_his_confirmed_statement_closes_who_paid(self):
        """(v7, F5; v8) his own who-paid statement (written by his decision in the app) closes who_paid while that
        decision stands; a job never writes one."""
        acq = 'claim:acquisition:%s' % T[:8]
        ref = payloads.answer_ref(testdata.U('answers'), 1)
        statement = {'key': 'link:%s@%s' % (ref, T[:8]), 'writer': 'propose_evidence_links', 'p_run_id': '@run:owner_review',
                     'row': {'vehicle_id': T, 'source_kind': 'owner_statement', 'external_ref': ref, 'role': 'payment_out',
                             'direction': 'out', 'payment_key': 'owner:' + ref, 'payer_entity': 'owner_business:synthetic',
                             'join_key': 'his answer', 'confidence': 1.0, 'evidence': []}}
        support = {'key': 'support:his', 'writer': 'propose_claim_support', 'p_run_id': '@run:owner_review',
                   'p_claim_id': '@key:' + acq, 'p_support': [{'evidence_kind': 'evidence_link', 'stance': 'supports',
                                                               'evidence_id': '@key:' + statement['key'], 'about': 'party'}]}
        f = dict(self.files, **{'links.jsonl': list(self.files['links.jsonl']) + [statement],
                                'claim_support.jsonl': [support]})

        def who_paid(decisions):
            return [q for q in readers.accounting(f, T, decisions)['open_questions'] if q['q'] == 'who_paid']
        self.assertEqual(len(who_paid(None)), 1)                     # proposed only: still open
        self.assertEqual(who_paid([{'target': statement['key'], 'decision': 'confirmed'}]), [])
        self.assertEqual(len(who_paid([{'target': statement['key'], 'decision': 'rejected'}])), 1)

    def test_his_word_on_a_photo_reads_per_truck(self):
        """(v9, R-T1/R-T2) his no to a truck for a photo holds on every row naming that truck (any pass, any id of the
        truck); his yes to one subject answers every subject row at another place; a row in frame is not a subject."""
        img, V = testdata.U('image', 'per-truck'), testdata.V

        def cand(key, pass_, vehicle=None, subject_key=None, frame='subject'):
            return {'key': key, 'p_run_id': '@run:' + pass_, 'row': {
                'image_id': img, 'vehicle_id': vehicle, 'subject_key': subject_key, 'verdict': 'is_vehicle',
                'frame_role': frame, 'pass_captured_on': '2031-05-01', 'image_class': 'own'}}
        rows = [cand('c:truck', 'combined', V['TRUCK']), cand('c:twin', 'listing_class', V['TWIN']),
                cand('c:sub', 'combined', V['SUB']), cand('c:sub-again', 'listing_class', V['SUB']),
                cand('c:job', 'combined', subject_key='label:' + testdata.JOB),
                cand('c:swb-in-frame', 'combined', V['SWB'], frame='also_in_frame')]
        f = dict(self.files, **{'candidates.photos_album.jsonl': [],
                                'candidates.combined.jsonl': [r for r in rows if r['p_run_id'] == '@run:combined'],
                                'candidates.listing_class.jsonl': [r for r in rows
                                                                   if r['p_run_id'] == '@run:listing_class']})

        def status(decisions):
            return {c['id']: c['status'] for c in readers.candidates_for_images(readers.Store(f, decisions), {img})}
        self.assertEqual(set(status(None).values()), {'proposed'})
        no_sub = status([{'target': 'c:sub', 'decision': 'rejected'}])
        self.assertEqual((no_sub['c:sub'], no_sub['c:sub-again'], no_sub['c:truck']), ('rejected', 'rejected', 'proposed'))
        self.assertEqual(status([{'target': 'c:truck', 'decision': 'confirmed'}]), {
            'c:truck': 'confirmed', 'c:twin': 'rejected', 'c:sub': 'rejected', 'c:sub-again': 'rejected',
            'c:job': 'rejected', 'c:swb-in-frame': 'proposed'})
        # once he confirmed the pair, the twin is the same truck under another id: not another place
        pair = {'target': 'claim:same_vehicle_as:%s' % V['TWIN'][:8], 'decision': 'confirmed'}
        self.assertEqual(status([pair, {'target': 'c:truck', 'decision': 'confirmed'}])['c:twin'], 'proposed')
        self.assertEqual(status([pair, {'target': 'c:twin', 'decision': 'rejected'}])['c:truck'], 'rejected')
        self.assertEqual((readers.places_distinct(V['TRUCK'], 'label:x'), readers.places_distinct('vin:1', 'label:x'),
                          readers.places_distinct(None, 'label:x'), readers.places_distinct('label:x', 'label:x')),
                         (True, False, True, False))

    def test_a_day_he_rejected_reads_undated(self):
        """(v7, F1; v8: his decision) a photo whose only time he rejected is undated until a time is confirmed."""
        claim = next(ln for ln in self.files['time_claims.jsonl']
                     if ln['row']['captured_on'] == '2031-04-20')
        before = readers.accounting(self.files, T)['undated_own_photos']
        after = readers.accounting(self.files, T, [{'target': claim['key'], 'decision': 'rejected'}])
        self.assertEqual((before, after['undated_own_photos']), (0, 1))


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

    def test_db_confirmed_level_waits_on_his_app(self):
        """(v8) in db mode only his own decisions satisfy the confirmed level; until any exist it is open, waiting on
        his app with his stored answers counted."""
        fx = common.load_json(self.td['fixture'])
        decided = readers.accounting(self.files, T, [{'target': 'claim:same_vehicle_as:%s' % testdata.V['TWIN'][:8],
                                                      'decision': 'confirmed'}])
        res, summary = exit_test.run(fx, self.files, lambda dec: decided, common.DB, {'decisions': 0, 'waiting': 6})
        by = {r['id']: r for r in res}
        self.assertEqual((by['identity_pair_confirmed']['result'], by['identity_pair_confirmed']['waiting_on_his_app']),
                         ('open', 6))                            # the read would pass, but no decision of his exists
        self.assertEqual(summary['confirmed_level'], 'waiting on his app (6 stored answers waiting)')
        self.assertNotIn('simulated', by['identity_pair_confirmed'])
        res, summary = exit_test.run(fx, self.files, lambda dec: decided, common.DB, {'decisions': 1, 'waiting': 5})
        by = {r['id']: r for r in res}
        self.assertEqual((by['identity_pair_confirmed']['result'], by['painter_answered']['result']), ('pass', 'open'))
        self.assertEqual(summary['confirmed_level'], 'his decisions recorded')

    def test_his_state_reads_name_the_owner(self):
        class R:
            def __init__(self):
                self.sql = []

            def read(self, sql, params=None, tag=None):
                self.sql.append((sql, params))
                return [{'waiting': 3, 'rewritten_ask_again': 0, 'rows_answered': 2, 'his_decisions': 1}]
        r = R()
        self.assertEqual(exit_test.his_state(testdata.OWNER, r), {'waiting': 3, 'decisions': 1})
        # the scoreboard's M15 read: (v9) the latest stored answer per sheet row
        self.assertEqual(r.sql[0][0], next(s for n, _m, s in scoreboard.parse() if n == 'M15'))
        self.assertIn('evidence_answers_to_confirm(:uid)', r.sql[0][0])
        self.assertTrue(all(p == {'uid': testdata.OWNER} for _s, p in r.sql))

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
    """Stands in for PostgREST: answers each writer the way draft.sql v8 does, records every call."""

    def __init__(self, fail=None, links=None):
        self.calls = []
        self.fail = fail or {}
        self.link_results = links or {}                  # source key -> result for propose_evidence_links
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
        if fn == 'decide_evidence':                     # (v8) the service role has no EXECUTE on it
            raise common.RpcError(fn, 403, '42501', 'permission denied for function decide_evidence')
        return {}


class SentReader:
    """q.sh as `send` reads it back: the review run's status and finished_at (the store's send time)."""

    def __init__(self, status='done'):
        self.status, self.at, self.calls = status, common.utc_now().isoformat(), []     # to the microsecond

    def read(self, sql, params=None, tag=None):
        self.calls.append((tag, params))
        return [{'status': self.status, 'finished_at': self.at if self.status == 'done' else None}]


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

    def test_unchanged_rows_are_counted_and_never_retried(self):
        """(v6, RU5) the time pass re-proposes freely: an identical claim or candidate comes back 'unchanged'."""
        rest = FakeRest()

        def times(args):
            n = len(args['p_rows'])
            return {'proposed': n - 3, 'machine_confirmed': n - 3, 'kept_stronger': 0, 'unchanged': 2,
                    'already_rejected': 1, 'owner_answer_missing': 0, 'image_not_eligible': 0,
                    'ids': [rest.new() for _i in range(n - 3)], 'decision_ids': []}

        def cands(args):
            rows = args['p_rows']
            return {'proposed': len(rows) - 1, 'unchanged': 1, 'items': [
                {'image_id': r['image_id'], 'result': 'proposed', 'candidate_id': rest.new()} for r in rows[1:]]}
        rest.fail = {'propose_capture_time_claims': times, 'propose_image_candidates': cands}
        ld = self.loader(rest)
        ld.load_dir(self.out)
        time_calls = [a for fn, a in rest.calls if fn == 'propose_capture_time_claims']
        cand_calls = [a for fn, a in rest.calls if fn == 'propose_image_candidates']
        self.assertEqual(ld.outcomes['unchanged'], 2 * len(time_calls) + len(cand_calls))
        self.assertEqual(ld.outcomes['already_rejected'], len(time_calls))    # (v7, F1) the time he rejected, again
        self.assertEqual(sum(len(a['p_rows']) for a in time_calls), 133)          # each claim sent once
        self.assertEqual(ld.manifest()['outcomes_reported_not_retried']['unchanged'], ld.outcomes['unchanged'])

    def test_v9_outcomes_are_reported_and_never_retried(self):
        """(v9) a photo his word answers, itemized account-map skips counted once, and claims a pass may not re-write."""
        d = self.copy_out('db-v9-outcomes')
        lines = common.read_jsonl(os.path.join(d, 'change_claims.jsonl'))
        decided, gone = testdata.U('claim', 'decided'), testdata.U('claim', 'gone')
        # two claims whose support is links only (every link loads; two photos per call are answered below)
        links_only = [i for i, ln in enumerate(lines) if ln.get('p_support') and all(
            str(s['evidence_id']).startswith('@key:link') for s in ln['p_support'])]
        with_support, other = links_only[0], links_only[1]
        lines[with_support]['p_supersedes'], lines[other]['p_supersedes'] = decided, gone
        with open(os.path.join(d, 'change_claims.jsonl'), 'w') as f:
            f.write(''.join(json.dumps(ln) + '\n' for ln in lines))
        rest, refs = FakeRest(), []

        def cands(args):
            rows = args['p_rows']
            return {'proposed': len(rows) - 2, 'unchanged': 0, 'items': [
                {'image_id': rows[0]['image_id'], 'result': 'already_rejected', 'candidate_id': rest.new()},
                {'image_id': rows[1]['image_id'], 'result': 'already_rejected', 'confirmed_candidate_id': rest.new()}]
                + [{'image_id': r['image_id'], 'result': 'proposed', 'candidate_id': rest.new()} for r in rows[2:]]}

        def accounts(args):
            refs.extend(r['account_ref'] for r in args['p_rows'][1:])
            return {'proposed': len(args['p_rows']) - 1, 'ids': [rest.new() for _r in args['p_rows'][1:]],
                    'already_decided': 1, 'skipped': [{'account_ref': args['p_rows'][0]['account_ref'],
                                                       'result': 'already_decided', 'id': rest.new()}]}

        def claims(args):
            if args['p_supersedes'] == decided:
                raise common.RpcError('propose_change_claim', 400, 'P0001', 'claim %s carries an owner decision (his '
                                      'decision or his who-paid statement); a pass may not supersede it' % decided)
            if args['p_supersedes'] == gone:
                raise common.RpcError('propose_change_claim', 400, '22023',
                                      'claim %s is not a current claim of this user: nothing to supersede' % gone)
            return rest.new()

        class Reader(FakeReader):
            def read(self, sql, params=None, tag=None):
                if tag == 'read_back' and 'evidence_account_entities' in sql:
                    return [{'id': testdata.U('account-row', a), 'account_ref': a} for a in refs]
                return super().read(sql, params, tag)
        rest.fail = {'propose_image_candidates': cands, 'propose_account_entities': accounts,
                     'propose_change_claim': claims}
        ld = self.loader(rest, Reader())
        ld.load_dir(d)
        cand_calls = [a for fn, a in rest.calls if fn == 'propose_image_candidates']
        firsts = {a['p_rows'][k]['image_id'] for a in cand_calls for k in (0, 1)}
        answered = [k for k, why in ld.skipped.items() if why == 'already_rejected']
        self.assertEqual(len(answered), 2 * len(cand_calls))           # his word answers them: nothing to ask
        self.assertFalse(set(answered) & set(ld.ids))
        self.assertEqual(len(firsts), 2 * len(cand_calls))
        self.assertEqual((ld.outcomes['already_rejected'], ld.outcomes['already_decided']), (2 * len(cand_calls), 1))
        self.assertEqual(sum(1 for why in ld.skipped.values() if why == 'already_decided'), 1)
        # (v9, W4/M7) his claim keeps its word; the pass's support goes onto it; a claim gone is nothing to supersede
        self.assertEqual(ld.ids[lines[with_support]['key']], decided)
        support = [a for fn, a in rest.calls if fn == 'propose_claim_support' and a['p_claim_id'] == decided]
        self.assertEqual(sum(len(a['p_support']) for a in support), len(lines[with_support]['p_support']))
        self.assertEqual(ld.skipped[lines[other]['key']], 'claim_not_current')
        self.assertEqual((ld.outcomes['claim_carries_owner_decision'], ld.outcomes['claim_not_current']), (1, 1))
        closed = [a['p_status'] for fn, a in rest.calls if fn == 'evidence_close_run']
        self.assertTrue(closed and set(closed) == {'done'})            # reported, not a failed load

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
        self.assertTrue(report['review_sheet']['sheet_run'])               # 52 rows: more than 50, so it is issued
        self.assertIn(report['review_sheet']['sheet_run'], review_sheet.load_index())     # M10b matches its delivery
        cfg = [a['p_config'] for fn, a in rest.calls if fn == 'evidence_open_run' and a['p_pass'] == 'review_sheet'][0]
        self.assertIsNone(payloads.review_rows_problem(cfg))
        self.assertTrue(all(r['question'] in payloads.C['review_questions'] for r in cfg['rows'].values()))
        # (v8) the review run stays open until the sheet is sent, (v9) and the sheet is held until then; nothing decides
        self.assertFalse([a for fn, a in rest.calls if fn == 'evidence_close_run'
                          and a['p_run_id'] == report['review_sheet']['sheet_run']])
        self.assertTrue(os.path.exists(report['review_sheet']['held']))
        self.assertFalse(os.path.exists(report['review_sheet']['held'][:-len('.unsent')] + '.md'))
        self.assertNotIn('decide_evidence', fns)

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
        # (v8) the client never sends decide_evidence: nothing reaches the network or the manifest
        with self.assertRaises(common.EvidenceError):
            r.rpc('decide_evidence', {'p_target_kind': 'image_candidate'})
        self.assertEqual((r.calls, len(self.lines())), (1, 1))

    def test_an_unknown_outcome_is_recorded(self):
        r = self.rest(urllib.error.URLError('timed out'))
        with self.assertRaises(common.RpcError):
            r.rpc('propose_change_claim', {'p_run_id': testdata.U('run'), 'p_claim': {}, 'p_support': []})
        self.assertEqual((self.lines()[0]['outcome'], self.lines()[0]['code']), ('unknown', 'client_timeout'))

    def test_returned_shapes(self):
        u = lambda *x: testdata.U(*x)  # noqa: E731
        # (v7/v8) every count the time writer returns is kept: owner_answer_missing and already_rejected included
        r = manifest.returned('propose_capture_time_claims', {}, {
            'ids': [u('t1')], 'decision_ids': [u('d9')], 'kept_stronger': 2, 'unchanged': 3, 'owner_answer_missing': 1,
            'already_rejected': 1, 'stored_time_changed': 0})
        self.assertEqual(r['ids'], [u('t1'), u('d9')])
        self.assertEqual(dict(r['results']), {'kept_stronger': 2, 'unchanged': 3, 'owner_answer_missing': 1,
                                              'already_rejected': 1})
        r = manifest.returned('propose_evidence_links', {}, {'items': [{'ref': 'x', 'result': 'owner_answer_missing'}]})
        self.assertEqual((r['ids'], dict(r['results'])), ([], {'owner_answer_missing': 1}))
        r = manifest.returned('propose_change_claim', {'p_support': [{}, {}]}, u('k'))
        self.assertEqual((r['ids'], r['support']), ([u('k')], [{'claim_id': u('k'), 'count': 2}]))
        r = manifest.returned('propose_claim_support', {'p_claim_id': u('k')}, 3)
        self.assertEqual(r['support'], [{'claim_id': u('k'), 'count': 3}])
        r = manifest.returned('evidence_record_answers', {'p_sheet_run': u('sheet')}, u('answers'))
        self.assertEqual((r['ids'], manifest.run_of('evidence_record_answers', {'p_sheet_run': u('sheet')}, None)),
                         ([u('answers')], u('sheet')))
        # (v9, M5/M6) a skip the writer both counts and itemizes is counted once; the photos of refused owner times
        # are image ids, not rows; a photo his word answers names the row it stands on
        r = manifest.returned('propose_account_entities', {}, {'proposed': 1, 'ids': [u('a1')], 'already_decided': 1,
                                                               'skipped': [{'account_ref': 'bank_account:x',
                                                                            'result': 'already_decided', 'id': u('a0')}]})
        self.assertEqual((r['ids'], r['existing'], dict(r['results'])),
                         ([u('a1')], [u('a0')], {'proposed': 1, 'already_decided': 1}))
        r = manifest.returned('propose_capture_time_claims', {}, {'proposed': 0, 'owner_answer_missing': 1,
                                                                  'owner_answer_missing_ids': [u('image', 1)]})
        self.assertEqual((r['ids'], dict(r['results'])), ([], {'owner_answer_missing': 1}))
        r = manifest.returned('propose_image_candidates', {}, {'items': [
            {'image_id': u('i1'), 'result': 'already_rejected', 'candidate_id': u('c1')},
            {'image_id': u('i2'), 'result': 'already_rejected', 'confirmed_candidate_id': u('c2')}]})
        self.assertEqual((r['ids'], r['existing'], dict(r['results'])), ([], [u('c1'), u('c2')], {'already_rejected': 2}))

    def test_reconcile_finds_rows_no_call_returned(self):
        u = lambda *x: testdata.U(*x)  # noqa: E731
        lines = [{'writer': 'evidence_open_run', 'ids': [u('run')]},
                 {'writer': 'propose_evidence_links', 'run_id': u('run'), 'ids': [u('l1')]},
                 {'writer': 'propose_capture_time_claims', 'run_id': u('run'), 'ids': [u('t1'), u('c1')]},
                 {'writer': 'propose_change_claim', 'ids': [u('k')], 'support': [{'claim_id': u('k'), 'count': 2}]}]
        created = {'evidence_runs': [u('run')], 'evidence_links': [u('l1'), u('l2')], 'vehicle_change_claims': [u('k')],
                   'vehicle_change_claim_support': {u('k'): 3},
                   'evidence_decisions': [{'id': u('c1'), 'by': 'check:photos_exif_join'},
                                          {'id': u('a1'), 'by': 'agent:lead-1'},     # a job decision: never manifested
                                          {'id': u('h'), 'by': 'human:' + u('owner')},
                                          {'id': u('i'), 'by': 'implied:' + u('h')},
                                          {'id': u('p'), 'by': 'writer:promote_image', 'run': u('run')}]}
        m = manifest.reconcile(created, lines, his_rows={'evidence_links': 1, 'vehicle_change_claim_support': 1})
        self.assertEqual(m['by_table'], {'evidence_links': 1, 'evidence_decisions': 1})
        self.assertEqual(m['unmanifested'], 3)                    # l2, the agent row a1 and the support count
        self.assertEqual(m['examples']['evidence_decisions'], [u('a1')])
        self.assertEqual(m['support_mismatch'], [{'claim_id': u('k'), 'rows': 3, 'manifest': 2}])
        # (v8) his decisions, what they imply and the rows they write go to the lead's request-log match
        self.assertEqual((m['human_decisions_to_match_request_log'], m['implied_by_his_decisions'],
                          m['his_rows_to_match_his_decisions']), (1, 1, 2))

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
        for r in rows:                                                     # (v6, AC1) one decision kind per row
            self.assertEqual(r['profile']['question'], payloads.row_question(r))
        photos = [r for r in rows if r['section'] == 'photos']
        self.assertEqual(len(photos), 35)
        self.assertTrue(all(sorted(t['kind'] for t in r['targets']) == ['image', 'image_candidate'] for r in photos))
        self.assertTrue(all((r['profile']['question'], r['profile']['asked_place'], r['profile']['frame']) ==
                            ('image_candidate', T, 'subject') for r in photos))
        accts = [r for r in rows if r['section'] == 'accounts']
        self.assertEqual(len(accts), 3)
        self.assertTrue(all(r['profile']['question'] == 'account_entity' and len(r['profile']['accounts']) == 1
                            for r in accts))
        contested = [r for r in rows if 'also places it on' in r['question_text']]
        self.assertEqual(len(contested), 2)
        self.assertTrue(all(len([t for t in r['targets'] if t['kind'] == 'payment']) == 1 and
                            (r['profile']['link_class'], r['profile']['asked_place']) == ('placement', T)
                            for r in contested))
        disputed = [r for r in rows if r['profile']['link_class'] == 'contradicts']
        self.assertEqual(len(disputed), 1)
        self.assertEqual(payloads.answer_dimension(disputed[0]['profile']), [])     # "customer job" is a bare yes
        paid = [r for r in rows if r['profile']['asks'] == 'party']
        self.assertEqual(({r['section'] for r in paid}, len(paid)), ({'who paid'}, 6))
        self.assertTrue(all(payloads.answer_dimension(r['profile']) == ['entity_key'] and r['profile']['asked_place'] == T
                            for r in paid))
        self.assertEqual(sorted(r['profile']['question'] for r in paid), ['change_claim'] + ['evidence_link'] * 5)
        # the purchase line supports the purchase the case asks "who paid" about: asked once, not twice
        self.assertFalse([r for r in paid if "'purchase'" in r['question_text']])
        md = review_sheet.render(self.ctx, rows, '2031-06-01', decisions)
        self.assertNotIn('http', md)
        self.assertNotIn('120.10', md)
        gates = {r['id']: r['gate'] for r in common.load_json(os.path.join(os.path.dirname(self.td['case']),
                                                                          'image_rows.json'))['result']}
        for r in photos:
            img = next(t['key'] for t in r['targets'] if t['kind'] == 'image')
            self.assertEqual('review in the app' in r['question_text'], gates[img] != 'approved')

    def test_who_paid_rows_and_where_rows(self):
        lines = review_sheet.lines_by_key(self.files)
        RT = review_sheet.T
        truck206 = testdata.lkey(testdata.LEDGER_EXT + testdata.lid('00206'), T)
        sub206 = 'link:pnl:disposition:R000000000206@%s' % testdata.V['SUB'][:8]
        ok = review_sheet.profile({'targets': [RT('change_claim', 'claim:acquisition:%s' % T[:8])], 'asks': 'party'},
                                  lines)
        self.assertEqual((ok['question'], ok['asks'], ok['asked_place']), ('change_claim', 'party', T))
        contra = next(ln['key'] for ln in self.files['links.jsonl'] if ln['row']['role'] == 'contradicts'
                      and ln['row'].get('payment_key'))
        acct = self.files['account_entities.jsonl'][0]['key']
        jacket = next(ln['key'] for ln in self.files['links.jsonl'] if ln['key'].endswith('#line:paint@%s' % T[:8]))
        ok = review_sheet.profile({'targets': [RT('evidence_link', jacket)], 'asks': 'party'}, lines)
        self.assertEqual((ok['link_class'], ok['asked_place'], ok['payment_keys']), ('placement', T, []))
        for bad in ([RT('change_claim', 'claim:paint:%s' % T[:8])],              # not an acquisition or a sale
                    [RT('payment', pk('00206'))],                                # no place: a "where?" row
                    [RT('evidence_link', truck206), RT('evidence_link', sub206)],  # two places
                    [RT('evidence_link', contra)],                               # a contradiction is not a placement
                    [RT('account_entity', acct)],
                    [RT('evidence_link', truck206)]):        # (v8) money a payment source carries: the account's row
            with self.assertRaises(ValueError):
                review_sheet.profile({'targets': bad, 'asks': 'party'}, lines)
        with self.assertRaises(ValueError) as cm:
            review_sheet.profile({'targets': [RT('evidence_link', truck206)], 'asks': 'party'}, lines)
        self.assertIn('payment source', str(cm.exception))
        # (v9, W3) nor a line of a payment source with no key (a P&L or ledger line): its payer is its account's
        unkeyed = dict(lines[jacket], row=dict(lines[jacket]['row'], source_kind='pnl_line'))
        with self.assertRaises(ValueError) as cm:
            review_sheet.profile({'targets': [RT('evidence_link', jacket)], 'asks': 'party'}, dict(lines, **{
                jacket: unkeyed}))
        self.assertIn('payment source line', str(cm.exception))
        files = dict(self.files, **{'links.jsonl': [dict(ln, row=dict(ln['row'], source_kind='ledger_line'))
                                                    if ln['key'] == jacket else ln for ln in self.files['links.jsonl']]})
        rows, _d = review_sheet.build_rows(self.ctx, files, readers.accounting(files, T))
        before, _d = self.rows()
        asks = lambda rs: sorted(r['targets'][0]['key'] for r in rs if r['asks'] == 'party')  # noqa: E731
        self.assertEqual(set(asks(before)) - set(asks(rows)), {jacket})
        where = review_sheet.profile({'targets': [RT('payment', pk('00737'))]}, lines)
        self.assertEqual((where['question'], where['asked_place'], where['link_class'], where['payment_keys']),
                         ('evidence_link', None, 'placement', [pk('00737')]))
        multi = review_sheet.profile({'targets': [RT('evidence_link', truck206), RT('evidence_link', sub206)]}, lines)
        self.assertEqual((multi['asked_place'], payloads.answer_dimension(multi)), ('multi', []))

    def test_a_row_whose_targets_place_nothing_asks_about_none(self):
        """(v7, D6) a "no truck in frame" verdict or an unplaced line: asked place 'none', a yes/no row."""
        lines = dict(review_sheet.lines_by_key(self.files))
        img = testdata.U('image', 'nobody')
        lines['cand:x:none'] = {'key': 'cand:x:none', 'row': {'image_id': img, 'verdict': 'not_vehicle',
                                                              'frame_role': 'subject'}}
        p = review_sheet.profile({'targets': [review_sheet.T('image_candidate', 'cand:x:none'),
                                              review_sheet.T('image', img)]}, lines)
        self.assertEqual((p['asked_place'], p['places']), ('none', ['none']))
        for ans, ok in (({'decision': 'confirmed'}, True), ({'decision': 'rejected'}, True),
                        ({'decision': 'rejected', 'vehicle_id': T}, True),       # "no, it is the truck"
                        ({'decision': 'confirmed', 'vehicle_id': T}, False)):     # a yes names no other place
            self.assertEqual(payloads.answer_problem(ans, p) is None, ok, ans)
        with self.assertRaises(ValueError):                                       # a who-paid row needs a place
            review_sheet.profile({'targets': [review_sheet.T('image_candidate', 'cand:x:none')], 'asks': 'party'},
                                 lines)

    def test_an_image_only_row_states_its_question(self):
        """(v6, AC1) "which truck is this?" lists the image with question image_candidate: a "where?" row."""
        lines = review_sheet.lines_by_key(self.files)
        img = self.files['candidates.combined.jsonl'][0]['row']['image_id']
        cand = self.files['candidates.combined.jsonl'][0]['key']
        q = {'text': 'Which truck is in this photo?', 'answer_hint': '<truck>', 'question': 'image_candidate',
             'targets': [{'kind': 'image', 'key': img}]}
        self.ctx.case['review']['questions'].append(q)
        try:
            rows, _decisions = self.rows()
        finally:
            self.ctx.case['review']['questions'].remove(q)
        r = next(x for x in rows if x['question_text'] == q['text'])
        p = r['profile']
        self.assertEqual((p['question'], p['asked_place'], p['frame'], p['images']), ('image_candidate', None, 'subject',
                                                                                    [img]))
        self.assertIsNone(payloads.answer_problem({'decision': 'confirmed', 'vehicle_id': T}, p))
        self.assertIsNotNone(payloads.answer_problem({'decision': 'confirmed'}, p))
        self.assertEqual(review_sheet.run_row(r, {}), {'targets': [{'kind': 'image', 'id': img}],
                                                       'question': 'image_candidate'})
        self.assertEqual(p['places'], [])                     # no candidate listed: his reading names the truck
        for bad in ({'targets': [review_sheet.T('image', img)]},                             # names no question
                    {'targets': [review_sheet.T('image_candidate', cand)], 'frame': 'also_in_frame'}):
            with self.assertRaises(ValueError):
                review_sheet.profile(bad, lines)

    def test_db_issue_stores_row_targets_and_leaves_off_rows_not_loaded(self):
        rows, decisions = self.rows()
        ids = {k: common.uuid5('id', k) for f in self.files if f.endswith('.jsonl') for k in
               (ln['key'] for ln in self.files[f])}
        dropped = next(t['key'] for t in rows[3]['targets'] if t['kind'] == 'image_candidate')
        del ids[dropped]
        rest = FakeRest()
        d = self.copy_out('sheet-db')
        idx = os.path.join(d, 'sheets.jsonl')
        side = review_sheet.issue(self.ctx, rows, decisions, '2031-06-01', d, common.DB, rest, testdata.OWNER, ids,
                                  index=idx)
        cfg = [a for fn, a in rest.calls if fn == 'evidence_open_run'][0]['p_config']
        self.assertIsNone(payloads.review_rows_problem(cfg))
        self.assertEqual((cfg['items'], side['items'], len(side['left_off_not_loaded'])), (len(rows) - 1,) * 2 + (1,))
        self.assertEqual(cfg['sheet_sha256'], side['sheet_sha256'])
        self.assertEqual([fn for fn, _a in rest.calls], ['evidence_open_run'])     # (v8) closed when the sheet is sent
        self.assertTrue(all(r['question'] in payloads.C['review_questions'] for r in cfg['rows'].values()))
        self.assertEqual(len([r for r in cfg['rows'].values() if r.get('asks') == 'party']), 6)
        self.assertTrue(all(common.is_uuid(t.get('id') or '') or t.get('key')
                            for r in cfg['rows'].values() for t in r['targets']))
        self.assertEqual(review_sheet.load_index(idx)[side['sheet_run']]['sheet_sha256'], side['sheet_sha256'])
        # (v9) held until sent: there is no text to post until `send` has closed the run and recorded the send time
        self.assertEqual((os.path.exists(side['sheet']), os.path.exists(side['held'])), (False, True))
        sent = SentReader()
        with mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1', 'EVIDENCE_SHEETS_INDEX': idx}), \
                mock.patch.object(common, 'Rest', lambda *a, **k: rest), \
                mock.patch.object(common, 'Reader', lambda *a, **k: sent), contextlib.redirect_stdout(io.StringIO()):
            record_answers.send(mock.Mock(sheet=os.path.join(d, 'review-2031-06-01.json'), mode=common.DB,
                                          user=testdata.OWNER), self.ctx)
        after = common.load_json(os.path.join(d, 'review-2031-06-01.json'))
        self.assertEqual((after['held'], after['sent_at'], os.path.exists(side['held'])), (None, sent.at, False))
        self.assertEqual(common.sha256_bytes(Path(side['sheet']).read_bytes()), side['sheet_sha256'])
        self.assertEqual([fn for fn, _a in rest.calls], ['evidence_open_run', 'evidence_close_run'])


class Answers(SyntheticCase):
    """(v8) His answers are stored word for word, with an optional reading, and decide nothing; (v9) one answers run
    per chat message, with the message's own time, only on a sheet that was sent."""

    def sheet(self, name, date='2031-06-01'):
        d = self.copy_out(name)
        rows, decisions = review_sheet.build_rows(self.ctx, self.files, readers.accounting(self.files, T))
        side = review_sheet.issue(self.ctx, rows, decisions, date, d)
        return d, os.path.join(d, 'review-%s.json' % date), side

    def send(self, sp, mode=common.FILE, status='done'):
        """record_answers.py send: (db) the run is closed and its send time read back (a fake q.sh read)."""
        sent = SentReader(status)
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(common, 'Reader', lambda *a, **k: sent):
            record_answers.send(mock.Mock(sheet=sp, mode=mode, user=testdata.OWNER), self.ctx)
        return sent

    def deliver(self, sp, ref='session-1:msg-0', mode=common.FILE):
        """Send (before the sheet is posted), then record the message that posted it."""
        self.send(sp, mode)
        with contextlib.redirect_stdout(io.StringIO()):
            record_answers.delivered(mock.Mock(sheet=sp, message_ref=ref, mode=mode), self.ctx)

    @staticmethod
    def after_sending(sp, seconds=1):
        """A message time the chat could show for his reply: just after the sheet was sent."""
        sent = common.parse_ts(record_answers.sent_at(common.load_json(sp)))
        return common.iso_utc(sent + dt.timedelta(seconds=seconds))

    def store(self, sp, answers, mode=common.FILE, ref='session-1:msg-1', at=None):
        ap = os.path.join(os.path.dirname(sp), 'answers-in.json')
        common.dump_json(ap, answers)
        at = at or self.after_sending(sp)
        args = mock.Mock(sheet=sp, answers=ap, message_ref=ref, mode=mode, user=testdata.OWNER, message_at=at)
        with contextlib.redirect_stdout(io.StringIO()):
            record_answers.store(args, self.ctx)
        return common.load_json(record_answers.receipt_path(sp, common.load_json(sp), ref))

    @staticmethod
    def row(side, text, pkey=None):
        return next(r for r in side['rows'] if text in r['question_text']
                    and (pkey is None or pkey in r['question_text']))

    def test_answers_need_the_delivery_and_a_later_message(self):
        d, sp, side = self.sheet('answers-delivery')
        r = self.row(side, 'also places it on', pk('00206'))
        ans = {str(r['row']): {'verbatim': 'no, that was the second truck',
                               'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}}}
        with self.assertRaises(SystemExit) as cm:                  # (v6, AC10; v9) a sheet takes answers once sent
            self.store(sp, ans, at='2031-06-01T18:00:00Z')
        self.assertIn('sheet_not_sent', str(cm.exception))
        with self.assertRaises(SystemExit) as cm:                  # (v9) sent first, posted after: never the reverse
            record_answers.delivered(mock.Mock(sheet=sp, message_ref='session-1:msg-0'), self.ctx)
        self.assertIn('record_answers.py send first', str(cm.exception))
        for bad in ('msg-0', 'session 1:msg-0', 'session-1:msg:0', 'session-1/x:msg-0', 'session-1:' + 'x' * 200):
            with self.assertRaises(SystemExit):
                self.deliver(sp, bad)
        sent = record_answers.sent_at(common.load_json(sp))
        self.assertTrue(sent)
        self.deliver(sp)
        self.deliver(sp, 'Session-1:MSG-0')                       # the same message again (the store lower-cases it)
        self.assertEqual(record_answers.sent_at(common.load_json(sp)), sent)     # sending again changes nothing
        with self.assertRaises(SystemExit):                        # one delivery per sheet
            self.deliver(sp, 'session-1:msg-9')
        for ref in ('session-1:msg-0', 'msg-1', 'elsewhere:msg-0'):  # the delivery itself is not his reply, by any source
            with self.assertRaises(SystemExit):
                self.store(sp, ans, ref=ref)
        rc = self.store(sp, ans, ref='Session-1:Msg-1')
        self.assertEqual((rc['message_ref'], rc['delivery_ref'], rc['transcript'], rc['readings']),
                         ('session-1:msg-1', 'session-1:msg-0', 'not on this Mac', 1))
        self.assertEqual(common.parse_ts(rc['message_at']), common.parse_ts(self.after_sending(sp)))
        stored = rc['rows'][str(r['row'])]
        self.assertEqual(stored['sha256'], common.sha256_text('no, that was the second truck'))
        self.assertEqual(stored['answer'], {'decision': 'rejected', 'vehicle_id': testdata.V['SUB']})
        self.assertNotIn('second truck', json.dumps(rc))
        for ref in ('session-1:msg-1', 'elsewhere:MSG-1'):        # one transcription per message id, whatever the source
            with self.assertRaises(SystemExit) as cm:
                self.store(sp, ans, ref=ref)
            self.assertIn('already stored', str(cm.exception))
        # (v9, W2) his reply's next message is stored on the same sheet, as its own answers run
        rc2 = self.store(sp, {'1': {'verbatim': 'me', 'answer': {'decision': 'unsure'}}}, ref='session-1:msg-2',
                         at=self.after_sending(sp, 2))
        self.assertEqual((rc2['message_ref'], rc2['sheet_sha256']), ('session-1:msg-2', rc['sheet_sha256']))
        self.assertNotEqual(record_answers.answers_run_of(rc2), record_answers.answers_run_of(rc))
        self.assertEqual(sorted(x['message_ref'] for x in record_answers.receipts(sp)),
                         ['session-1:msg-1', 'session-1:msg-2'])
        # (v9) the message time: the chat's own, after the sheet was sent, never from the future, never missing
        later = {'1': {'verbatim': 'later'}}
        for at, why in ((self.after_sending(sp, -1), 'message_predates_sheet'),
                        (common.iso_utc(common.utc_now() + dt.timedelta(minutes=5)), 'in the future'),
                        ('2031-06-01T18:00:00', 'ISO 8601'), ('yesterday', 'ISO 8601')):
            with self.assertRaises(SystemExit) as cm:
                self.store(sp, later, ref='session-1:msg-3', at=at)
            self.assertIn(why, str(cm.exception))
        ap = os.path.join(d, 'answers-in.json')
        with self.assertRaises(SystemExit) as cm:
            record_answers.store(mock.Mock(sheet=sp, answers=ap, message_ref='session-1:msg-3', mode=common.FILE,
                                           user=testdata.OWNER, message_at=None), self.ctx)
        self.assertIn('the message time is needed', str(cm.exception))
        self.assertEqual(len(record_answers.receipts(sp)), 2)          # nothing stored by a refusal

    def test_a_reading_is_optional_and_storing_decides_nothing(self):
        d, sp, side = self.sheet('answers-unread')
        painter = self.row(side, 'also places it on', pk('00206'))
        photo = next(r for r in side['rows'] if r['section'] == 'photos')
        acct = next(r for r in side['rows'] if r['section'] == 'accounts')
        self.deliver(sp)
        before = set(os.listdir(d))
        rc = self.store(sp, {str(painter['row']): {'verbatim': 'no, the second truck',
                                                   'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}},
                             str(photo['row']): {'verbatim': 'hmm, that one maybe'},           # unclear: his words alone
                             str(acct['row']): {'verbatim': 'ask me later', 'answer': None}})
        self.assertEqual(rc['readings'], 1)
        self.assertEqual(rc['rows'][str(photo['row'])], {'sha256': common.sha256_text('hmm, that one maybe'),
                                                         'answer': {'decision': 'unsure', 'unread': True}})
        self.assertEqual(rc['rows'][str(acct['row'])]['answer'], record_answers.UNREAD)
        # the receipt is all it writes (one per message): no decision, no owner statement, no read-back
        self.assertEqual(set(os.listdir(d)) - before, {'answers-in.json', 'answers-2031-06-01-msg-1.json'})
        with self.assertRaises(SystemExit) as cm:                  # 'unread' is the store's mark, never a reading
            record_answers.validate_answers(self.ctx, side, {str(photo['row']): {
                'verbatim': 'w', 'answer': {'decision': 'unsure', 'unread': True}}})
        self.assertIn('answer carries', str(cm.exception))
        with self.assertRaises(SystemExit) as cm:                  # (v9, M4) his words, bounded
            record_answers.validate_answers(self.ctx, side, {str(photo['row']): {'verbatim': 'w' * 20001}})
        self.assertIn('20000 characters', str(cm.exception))
        # (v8) decide is retired: no job decides
        self.assertFalse(hasattr(record_answers, 'decide'))
        with mock.patch.object(sys, 'argv', ['record_answers.py', 'decide', '--sheet', sp, '--plan', 'plan.json']), \
                self.assertRaises(SystemExit) as cm:
            record_answers.main()
        self.assertIn('retired', str(cm.exception))

    def test_readings_stay_in_the_row_dimension(self):
        _d, _sp, side = self.sheet('answers-dimension')
        painter = self.row(side, 'also places it on', pk('00206'))
        disputed = self.row(side, 'says it was for something else')
        paid = self.row(side, "'paint'")
        acct = next(r for r in side['rows'] if r['section'] == 'accounts')
        photo = next(r for r in side['rows'] if r['section'] == 'photos')
        ident = next(r for r in side['rows'] if r['section'] == 'identity')

        def check(row, answer):
            return record_answers.validate_answers(self.ctx, side, {str(row['row']): {'verbatim': 'w', 'answer': answer}})
        for row, answer in ((painter, {'decision': 'rejected', 'vehicle_id': 'SUB'}), (painter, {'decision': 'confirmed'}),
                            (painter, {'decision': 'confirmed', 'vehicle_id': 'TRUCK'}),
                            (painter, {'decision': 'rejected', 'subject_key': 'label:' + testdata.JOB}),
                            (disputed, {'decision': 'confirmed'}),
                            (paid, {'decision': 'confirmed', 'entity_key': 'owner_business:synthetic'}),
                            (paid, {'decision': 'unsure'}),
                            (acct, {'decision': 'rejected', 'entity_key': 'owner_business:synthetic'}),
                            (photo, {'decision': 'rejected', 'vehicle_id': 'SWB'}), (ident, {'decision': 'confirmed'}),
                            (paid, None), (photo, None)):                     # (v8) no reading: his words alone
            check(row, answer)
        refused = [(painter, {'decision': 'confirmed', 'vehicle_id': 'SUB'}, 'a yes names the place'),
                   (painter, {'decision': 'rejected', 'vehicle_id': 'TRUCK'}, 'is a bare'),
                   (painter, {'decision': 'confirmed', 'entity_key': 'owner'}, 'its answer names'),
                   (disputed, {'decision': 'confirmed', 'vehicle_id': 'TRUCK'}, 'no place'),
                   (paid, {'decision': 'confirmed'}, 'who-paid row'),
                   (paid, {'decision': 'rejected', 'entity_key': 'owner'}, 'who-paid row'),
                   (acct, {'decision': 'confirmed', 'vehicle_id': 'TRUCK'}, 'its answer names'),
                   (acct, {'decision': 'confirmed', 'entity_key': 'third_party:x'}, 'a yes names the place'),
                   (photo, {'decision': 'rejected', 'vehicle_id': testdata.U('vehicle', 'stranger')},
                    'neither his nor on the row'),
                   (photo, {'decision': 'rejected', 'vehicle_id': 'TRADE'}, 'neither his nor on the row'),  # (v7, D7)
                   (photo, {'decision': 'unsure', 'vehicle_id': 'SWB'}, "'unsure' answer names no place"),
                   (ident, {'decision': 'confirmed', 'vehicle_id': 'TWIN'}, 'no place')]
        for row, answer, why in refused:
            with self.assertRaises(SystemExit) as cm:
                check(row, answer)
            self.assertIn(why, str(cm.exception), (row['row'], answer))
        with self.assertRaises(SystemExit) as cm:
            record_answers.validate_answers(self.ctx, side, {str(photo['row']): {'verbatim': '  '}})
        self.assertIn('no verbatim text', str(cm.exception))

    def test_second_reader_objection_and_asking_again(self):
        ledger = os.path.join(self.tmp, 'disputed-second.jsonl')
        with mock.patch.dict(os.environ, {'EVIDENCE_DISPUTED': ledger}):
            d, sp, side = self.sheet('answers-second')
            painter = self.row(side, 'also places it on', pk('00206'))
            photo = next(r for r in side['rows'] if r['section'] == 'photos')
            acct = next(r for r in side['rows'] if r['section'] == 'accounts')
            self.deliver(sp)
            rc = self.store(sp, {
                str(painter['row']): {'verbatim': 'no, the second truck',
                                      'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}},
                str(photo['row']): {'verbatim': 'yes', 'answer': {'decision': 'confirmed'}},
                str(acct['row']): {'verbatim': 'that account, hmm'}})
            rp = record_answers.receipt_path(sp, side, 'session-1:msg-1')
            with contextlib.redirect_stdout(io.StringIO()):
                record_answers.second_packet(mock.Mock(sheet=sp, answers=os.path.join(d, 'answers-in.json')), self.ctx)
            packet = common.load_json(os.path.join(d, 'second-read-2031-06-01.json'))
            self.assertEqual(sorted((e['row'], e['verbatim'], e['answer']) for e in packet),
                             sorted([(photo['row'], 'yes', None), (painter['row'], 'no, the second truck', None),
                                     (acct['row'], 'that account, hmm', None)]))
            sec = os.path.join(d, 'second.json')
            args = mock.Mock(sheet=sp, receipt=rp, second=sec)
            # a row stored unread has no reading to check, whatever the second reader makes of it
            common.dump_json(sec, [{'row': photo['row'], 'answer': {'decision': 'confirmed'}},
                                   {'row': painter['row'], 'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}},
                                   {'row': acct['row'], 'answer': {'decision': 'rejected'}}])
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(record_answers.second_compare(args, self.ctx), 0)
            self.assertEqual(manifest.disputed_runs(), [])
            common.dump_json(sec, [{'row': photo['row'], 'answer': {'decision': 'confirmed'}},
                                   {'row': painter['row'], 'answer': {'decision': 'rejected'}}])   # read as a bare no
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(record_answers.second_compare(args, self.ctx), 1)
            run = record_answers.answers_run_of(rc)
            self.assertEqual(manifest.disputed_runs(), [run])
            # the next sheet asks the disputed row again, until a delivered sheet has asked it
            _d2, sp2, side2 = self.sheet('answers-second-next', '2031-06-08')
            again = [r for r in side2['rows'] if r['section'] == 'asked again']
            self.assertEqual([(r['question_text'], r['reask_of'], r.get('reask_ref')) for r in again],
                             [(painter['question_text'], {'sheet': sp, 'row': painter['row']}, None)])
            self.deliver(sp2, 'session-1:msg-5')
            _d3, _sp3, side3 = self.sheet('answers-second-later', '2031-06-15')
            self.assertFalse([r for r in side3['rows'] if r['section'] == 'asked again'])
            self.assertEqual(manifest.disputed_runs(), [run])
            # his objection to a stored reading disputes the run the same way
            with contextlib.redirect_stdout(io.StringIO()):
                record_answers.dispute(mock.Mock(receipt=rp, row=photo['row'], message_ref='Session-1:MSG-7'), self.ctx)
            last = manifest.disputed_rows()[-1]
            self.assertEqual((last['by'], last['row'], last['message_ref']), ('owner_objection', photo['row'],
                                                                              'session-1:msg-7'))
            with self.assertRaises(SystemExit):
                record_answers.dispute(mock.Mock(receipt=rp, row=photo['row'], message_ref='not a ref'), self.ctx)
            # (v9) a run disputed as a whole (the transcript check) asks again the rows that run answered
            manifest.mark_disputed({'answers_run': run, 'sheet_run': None, 'sheet': sp, 'by': 'm10b_transcript'})
            _d4, _sp4, side4 = self.sheet('answers-second-whole', '2031-06-22')
            self.assertEqual(sorted(r['reask_of']['row'] for r in side4['rows'] if r['section'] == 'asked again'),
                             sorted([acct['row'], photo['row']]))     # painter's row was asked again already

    @mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'})
    def test_a_disputed_row_of_a_sent_db_sheet_is_asked_again_as_frozen(self):
        """(v9, W2) The re-ask names the sent row (reask_of) and the writer copies it as it was frozen."""
        ledger, idx = os.path.join(self.tmp, 'disputed-frozen.jsonl'), os.path.join(self.tmp, 'sheets-frozen.jsonl')
        with mock.patch.dict(os.environ, {'EVIDENCE_DISPUTED': ledger, 'EVIDENCE_SHEETS_INDEX': idx}):
            ids = {k: common.uuid5('id', k) for f in self.files if f.endswith('.jsonl')
                   for k in (ln['key'] for ln in self.files[f])}
            d = self.copy_out('answers-frozen')
            rows, decisions = review_sheet.build_rows(self.ctx, self.files, readers.accounting(self.files, T))
            fake = FakeRest()
            with mock.patch.object(common, 'Rest', lambda *a, **k: fake):
                side = review_sheet.issue(self.ctx, rows, decisions, '2031-06-01', d, common.DB, fake, testdata.OWNER,
                                          ids)
                sp = os.path.join(d, 'review-2031-06-01.json')
                self.deliver(sp, mode=common.DB)
                painter = self.row(side, 'also places it on', pk('00206'))
                self.store(sp, {str(painter['row']): {'verbatim': 'no, the second truck',
                                                      'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}}},
                           common.DB)
            rec = [a for fn, a in fake.calls if fn == 'evidence_record_answers'][0]
            self.assertEqual(common.parse_ts(rec['p_message_at']), common.parse_ts(self.after_sending(sp)))
            with contextlib.redirect_stdout(io.StringIO()):
                record_answers.dispute(mock.Mock(receipt=record_answers.receipt_path(sp, side, 'session-1:msg-1'),
                                                 row=painter['row'], message_ref='session-1:msg-2'), self.ctx)
            # the next db sheet: nothing of today's load is needed for it; the row is asked as it was sent
            d2 = self.copy_out('answers-frozen-next')
            rows2, decisions2 = review_sheet.build_rows(self.ctx, self.files, readers.accounting(self.files, T))
            fake2 = FakeRest()
            side2 = review_sheet.issue(self.ctx, rows2, decisions2, '2031-06-08', d2, common.DB, fake2, testdata.OWNER,
                                       {})
            cfg = fake2.calls[0][1]['p_config']
            self.assertEqual([v for v in cfg['rows'].values() if 'reask_of' in v],
                             [{'reask_of': 'review:%s#%d' % (side['sheet_run'], painter['row'])}])
            self.assertIsNone(payloads.review_rows_problem(cfg))
            again = next(r for r in side2['rows'] if r['section'] == 'asked again')
            self.assertEqual((again['section'], again['profile'], again['targets']),
                             ('asked again', painter['profile'], painter['targets']))     # with the ids it was sent
            self.assertEqual(again['reask_of'], {'sheet': sp, 'row': painter['row']})

    @mock.patch.dict(os.environ, {'EVIDENCE_DB_WRITES': '1'})
    def test_db_sheet_closes_once_when_sent_and_refusals_are_reported(self):
        idx = os.path.join(self.tmp, 'sheets-db.jsonl')
        with mock.patch.dict(os.environ, {'EVIDENCE_SHEETS_INDEX': idx}), \
                mock.patch.object(common, 'today', lambda now=None: '2031-06-02'):
            d, sp, side = self.sheet('answers-db')
            side['sheet_run'] = testdata.U('sheet-run')
            common.dump_json(sp, side)
            painter = self.row(side, 'also places it on', pk('00206'))
            photo = next(r for r in side['rows'] if r['section'] == 'photos')
            fake = FakeRest()
            with mock.patch.object(common, 'Rest', lambda *a, **k: fake):
                with self.assertRaises(SystemExit) as cm:            # (v8) a review run is closed when it is sent
                    self.send(sp)
                self.assertIn('--mode db', str(cm.exception))
                sent = self.send(sp, mode=common.DB)                  # (v9) before it is posted: the store's send time
                self.assertEqual(sent.calls, [('sheet_sent', {'run': side['sheet_run'], 'uid': testdata.OWNER})])
                self.assertEqual(record_answers.sent_at(common.load_json(sp)), sent.at)
                self.deliver(sp, mode=common.DB)                     # sending again closes nothing; nor does posting
                self.deliver(sp, mode=common.DB)
                rc = self.store(sp, {str(painter['row']): {'verbatim': 'the second truck',
                                                           'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}},
                                     str(photo['row']): {'verbatim': 'not sure which one that is'}}, common.DB)
                # (v9, W2) the next message of his reply: a second answers run on the same sheet
                rc2 = self.store(sp, {str(photo['row']): {'verbatim': 'it is the second truck after all'}}, common.DB,
                                 'session-1:msg-2', self.after_sending(sp, 2))
            self.assertEqual([fn for fn, _a in fake.calls], ['evidence_close_run'] + ['evidence_record_answers'] * 2)
            close, rec, rec2 = fake.calls[0][1], fake.calls[1][1], fake.calls[2][1]
            self.assertEqual((close['p_run_id'], close['p_status'], close['p_counts']),
                             (side['sheet_run'], 'done', {'items': side['items'], 'sent': True}))
            self.assertEqual((rec['p_user_id'], rec['p_sheet_run'], rec['p_message_ref']),
                             (testdata.OWNER, side['sheet_run'], 'session-1:msg-1'))
            self.assertEqual(rec['p_rows'], {
                str(painter['row']): {'verbatim': 'the second truck',
                                      'answer': {'decision': 'rejected', 'vehicle_id': testdata.V['SUB']}},
                str(photo['row']): {'verbatim': 'not sure which one that is'}})     # the writer marks it unread
            self.assertEqual((rec2['p_sheet_run'], rec2['p_message_ref']), (side['sheet_run'], 'session-1:msg-2'))
            self.assertLess(common.parse_ts(rec['p_message_at']), common.parse_ts(rec2['p_message_at']))
            self.assertEqual((rc['answers_run'], rc2['answers_run']),
                             ('00000000-0000-4000-8000-%012d' % 1, '00000000-0000-4000-8000-%012d' % 2))
            index = review_sheet.load_index()[side['sheet_run']]
            self.assertEqual((index['delivered_ref'], index['sent_time']), ('session-1:msg-0', sent.at))
            # a run already closed (an earlier send that stopped before writing the time) is read back and sent; any
            # other refusal stops the send, and a run the store does not hold 'done' (withdrawn) is never posted
            _d2, sp2, _side2 = self.sheet('answers-db-closed', '2031-06-03')
            side2 = dict(common.load_json(sp2), sheet_run=testdata.U('sheet-run-closed'))
            common.dump_json(sp2, side2)
            not_running = common.RpcError('evidence_close_run', 400, 'P0001',
                                          'run %s is not a running run' % side2['sheet_run'])
            for err, status, sent_ok in ((common.RpcError('evidence_close_run', 400, '42501', 'permission denied'),
                                          'done', None), (not_running, 'aborted', False), (not_running, 'done', True)):
                with mock.patch.object(common, 'Rest', lambda *a, **k: FakeRest(fail={'evidence_close_run': err})):
                    if sent_ok:
                        self.send(sp2, common.DB, status)
                    else:
                        with self.assertRaises(SystemExit if sent_ok is False else common.RpcError):
                            self.send(sp2, common.DB, status)
                self.assertEqual(bool(record_answers.sent_at(common.load_json(sp2))), bool(sent_ok))
            # the store's refusals are reported, never retried, and nothing is kept: (v9) a message stored once (its
            # error names no run), a sheet never sent, a message older than the sheet's sending
            d4, sp4, _side4 = self.sheet('answers-db-refused', '2031-06-04')
            side4 = dict(common.load_json(sp4), sheet_run=testdata.U('sheet-run-2'))
            common.dump_json(sp4, side4)
            with mock.patch.object(common, 'Rest', lambda *a, **k: FakeRest()):
                self.deliver(sp4, 'session-1:msg-4', common.DB)
            for n, (code, text, why) in enumerate((
                    ('23505', 'message session-1:msg-5 is already stored; a message is stored once', 'already holds'),
                    ('22023', 'sheet_not_sent: sheet x is running, never sent', 'sheet_not_sent'),
                    ('22023', 'message_predates_sheet: message session-1:msg-5 is older than sheet x',
                     'message_predates_sheet')), 5):
                refusing = FakeRest(fail={'evidence_record_answers': common.RpcError(
                    'evidence_record_answers', 400, code, text)})
                ref = 'session-1:msg-%d' % (n * 10)
                with mock.patch.object(common, 'Rest', lambda *a, **k: refusing), \
                        self.assertRaises(SystemExit) as cm:
                    self.store(sp4, {str(painter['row']): {'verbatim': 'yes', 'answer': {'decision': 'confirmed'}}},
                               common.DB, ref)
                self.assertIn(why, str(cm.exception))
                self.assertEqual([fn for fn, _a in refusing.calls], ['evidence_record_answers'])
                self.assertFalse(os.path.exists(record_answers.receipt_path(sp4, side4, ref)))
            # a db sheet's answers need its review run; a file-mode sheet has none
            _d5, sp5, _side5 = self.sheet('answers-db-file-sheet', '2031-06-05')
            self.deliver(sp5, 'session-1:msg-6')
            with mock.patch.object(common, 'Rest', lambda *a, **k: FakeRest()), self.assertRaises(SystemExit) as cm:
                self.store(sp5, {str(painter['row']): {'verbatim': 'yes'}}, common.DB, 'session-1:msg-7')
            self.assertIn('no review run', str(cm.exception))


class Transcript(SyntheticCase):
    """(v6, AC10; M10b item 5) the sheet's delivery and his reply, checked in a synthetic Claude Code transcript."""

    def test_delivery_and_reply_are_matched_in_the_transcript(self):
        root = tempfile.mkdtemp(prefix='evidence-transcripts-')
        self.addCleanup(shutil.rmtree, root, True)
        with mock.patch.dict(os.environ, {'EVIDENCE_TRANSCRIPTS': root}):
            d = self.copy_out('transcript')
            rows, decisions = review_sheet.build_rows(self.ctx, self.files, readers.accounting(self.files, T))
            side = review_sheet.issue(self.ctx, rows, decisions, '2031-06-01', d)
            sp = os.path.join(d, 'review-2031-06-01.json')
            md = Path(side['sheet']).read_text()
            painter = next(r for r in side['rows'] if pk('00206') in r['question_text']
                           and 'also places it on' in r['question_text'])
            sid = testdata.U('session')

            def u(n):
                return testdata.U('message', n)

            def ref(n):
                return '%s:%s' % (sid, u(n))
            entries = [
                {'uuid': u(0), 'type': 'user', 'timestamp': '2031-06-01T17:00:00Z',
                 'message': {'role': 'user', 'content': 'send me the sheet'}},
                {'uuid': u(1), 'type': 'assistant', 'timestamp': '2031-06-01T17:01:00Z',
                 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': md}]}},
                {'uuid': u(2), 'type': 'user', 'timestamp': '2031-06-01T18:00:00Z',
                 'message': {'role': 'user', 'content': '%d. no, that was the  second truck' % painter['row']}},
                {'uuid': u(3), 'type': 'user', 'timestamp': '2031-06-01T18:05:00Z',
                 'message': {'role': 'user', 'content': 'thanks'}}]
            p = Path(root, 'project-a', sid + '.jsonl')
            p.parent.mkdir(parents=True)
            p.write_text(''.join(json.dumps(e) + '\n' for e in entries))
            self.assertEqual(transcript.find(ref(2))['index'], 2)
            self.assertIsNone(transcript.find('other-channel:42'))
            ans = {str(painter['row']): {'verbatim': 'no, that was the second truck',
                                         'answer': {'decision': 'rejected', 'vehicle_id': 'SUB'}}}

            # the chat's clock (the synthetic chat lies ahead of the real one)
            clock = [common.parse_ts('2031-06-01T17:30:00Z')]

            def send():
                with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(common, 'utc_now', lambda: clock[0]):
                    record_answers.send(mock.Mock(sheet=sp, mode=common.FILE, user=testdata.OWNER), self.ctx)

            def deliver(r):
                with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(common, 'utc_now', lambda: clock[0]):
                    record_answers.delivered(mock.Mock(sheet=sp, message_ref=r), self.ctx)

            def store(r, **kw):
                ap = os.path.join(d, 'answers-in.json')
                common.dump_json(ap, ans)
                with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(common, 'utc_now', lambda: clock[0]):
                    record_answers.store(mock.Mock(sheet=sp, answers=ap, message_ref=r, mode=common.FILE,
                                                   user=testdata.OWNER, **kw), self.ctx)
                return common.load_json(record_answers.receipt_path(sp, side, r))
            send()                                                       # sent at 17:30, after the post at 17:01
            with self.assertRaises(SystemExit) as cm:                    # (v9) posted before it was sent: refused
                deliver(ref(1))
            self.assertIn('before the sheet was sent', str(cm.exception))
            common.dump_json(sp, dict(common.load_json(sp), sent_at='2031-06-01T17:00:30+00:00'))   # sent, then posted
            with self.assertRaises(SystemExit):                          # that message does not carry the sheet
                deliver(ref(2))
            deliver(ref(1))
            self.assertEqual(common.load_json(sp)['delivery']['transcript'], 'checked')
            clock[0] = common.parse_ts('2031-06-01T19:00:00Z')
            with self.assertRaises(SystemExit) as cm:                    # a reply that does not hold his words
                store(ref(3))
            self.assertIn('not in the reply', str(cm.exception))
            with self.assertRaises(SystemExit) as cm:                    # a message before the sheet went out
                store(ref(0))
            self.assertIn('does not come after', str(cm.exception))
            with self.assertRaises(SystemExit) as cm:                    # (v9) the time is the transcript's
                store(ref(2), message_at='2031-06-01T18:10:00Z')
            self.assertIn('is not the time the transcript gives', str(cm.exception))
            rc = store(ref(2))
            self.assertEqual((rc['transcript'], common.parse_ts(rc['message_at'])),   # spacing aside, his words
                             ('checked', common.parse_ts('2031-06-01T18:00:00Z')))     # are in the reply
            sheets = {'run-1': {'sheet_sha256': side['sheet_sha256'], 'delivered_ref': ref(1), 'sidecar': sp}}
            runs = [{'id': 'a1', 'sheet_run': 'run-1', 'message_ref': ref(2), 'rows': ans,
                     'message_at': rc['message_at']},
                    {'id': 'a2', 'sheet_run': 'run-1', 'message_ref': ref(3), 'rows': ans},
                    {'id': 'a3', 'sheet_run': 'run-1', 'message_ref': 'other-channel:42', 'rows': ans},
                    {'id': 'a4', 'sheet_run': 'run-2', 'message_ref': ref(2), 'rows': ans}]
            m = manifest.check_answers(runs, sheets)
            self.assertEqual((m['checked'], m['unchecked'], m['no_delivery']), (2, ['a3'], ['a4']))
            self.assertEqual([(x['answers_run'], x['sheet']) for x in m['problems']], [('a2', sp)])


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
        # (v6, RU6) a reader names the user whose evidence it reads: the store raises without one, the runner refuses first
        for sql, params in (('select public.vehicle_accounting_evidence(:v, NULL, NULL, NULL) x', {'v': T}),
                            ('select * from public.evidence_revert_watch(:uid)', {'uid': None}),
                            ('select public.evidence_custody(array[:v]::uuid[], :uid)', {'v': T, 'uid': 'someone'}),
                            ('select count(*) n from public.evidence_answers_to_confirm()', {})):
            with self.assertRaises(common.ReadError):
                r.read(sql, params)
        self.assertEqual(r.read('select public.vehicle_accounting_evidence(:v, NULL, NULL, :uid) x',
                                {'v': T, 'uid': testdata.OWNER}), [{'n': 1}])

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
                  'M10_stamps', 'M10_step_up', 'M10_integrity', 'M10_frameless', 'M10b', 'M10b_answers', 'M11', 'M12',
                  'M13', 'M13_open_proposals', 'M14_accounts', 'M14', 'M15'):
            self.assertIn(m, names)
        self.assertEqual(names['M1'][0], 'chunked')
        self.assertEqual((names['M10b'][0], names['M10b_answers'][0]), ('manifest', 'answers'))
        self.assertNotIn('M10b_readback', names)                       # (v8) no agent decision to read back
        self.assertIn('vehicle_accounting_evidence(:vehicle_id, NULL, NULL, :uid)', names['M5'][1])
        self.assertIn("x->>'to_account_ref', x->>'payer', x->>'payee'", names['M5'][1])
        # (v6) every read names the owner
        self.assertIn("evidence_status('image_candidate', c.id, :uid)", names['M2'][1])
        for n, (_m, s) in names.items():
            if common.READER_CALL.search(s.lower()):
                self.assertIn(':uid', s, n)
        # (v8) no job decides: M4a is transcription accuracy, the stamps expect no agent row and no service_role
        # EXECUTE on decide_evidence, M10b leaves his rows to the request log, M15 reads what waits for him
        self.assertIn("detail->'stored_reading'", names['M4a'][1])
        self.assertNotIn(':disputed', Path(scoreboard.SQL_FILE).read_text())
        for col in ('human_not_owner_session', 'agent_rows', 'job_owner_days', 'statements_without_him', 'svc_can_decide'):
            self.assertIn(col, names['M10_stamps'][1])
        self.assertIn("has_function_privilege('service_role'", names['M10_stamps'][1])
        self.assertIn('human_without_step_up_record', names['M10_step_up'][1])
        self.assertIn("created_by not like 'human:%'", names['M10b'][1])
        self.assertIn('evidence_answers_to_confirm(:uid)', names['M15'][1])
        self.assertIn('a.message_at desc', names['M15'][1])            # (v9) the latest stored answer per row
        self.assertIn("config->>'message_at'", names['M10b_answers'][1])
        self.assertIn('closed_accounts', names['M14_accounts'][1])
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
                    return [{'t': 'evidence_runs', 'x': [u('run')], 'h': 0},
                            {'t': 'evidence_links', 'x': json.dumps([u('l1'), u('l9')]), 'h': 2},
                            {'t': 'vehicle_change_claim_support', 'x': {}, 'h': '1'},
                            {'t': 'evidence_decisions', 'h': 0, 'x': [
                                {'id': u('d1'), 'by': 'human:' + testdata.OWNER, 'decision': 'confirmed'},
                                {'id': u('d2'), 'by': 'implied:' + u('d1'), 'decision': 'rejected'},
                                {'id': u('d3'), 'by': 'agent:lead-session-1', 'decision': 'confirmed'}]}]
                if tag == 'M10_integrity':
                    return [{'always_on': 26, 'total': 27, 'md5s': {'propose_evidence_links': 'a' * 32}}]
                return []
        out = scoreboard.run(R(), testdata.OWNER, T, only=['M10b', 'M10_integrity'], manifest_dir=d,
                             since=common.iso_utc(now), deployed_md5s={'propose_evidence_links': 'b' * 32})
        # (v8) an agent decision is never the runner's: unmanifested; his decisions and his rows go to the request log
        self.assertEqual((out['M10b']['unmanifested'], out['M10b']['examples']),
                         (2, {'evidence_links': [u('l9')], 'evidence_decisions': [u('d3')]}))
        self.assertEqual((out['M10b']['human_decisions_to_match_request_log'], out['M10b']['implied_by_his_decisions'],
                          out['M10b']['his_rows_to_match_his_decisions']), (1, 1, 3))
        self.assertEqual(scoreboard.scalar(out['M10b']), 2)
        self.assertEqual(out['M10_integrity']['drifted'], ['propose_evidence_links'])
        self.assertIn('guard triggers', scoreboard.integrity_failed(out['M10_integrity']))
        self.assertIsNone(scoreboard.integrity_failed({'always_on': 27, 'total': 27, 'drifted': []}))

    def test_m10b_answers_m15_and_m4a_through_the_scoreboard(self):
        """(v6, AC10) M10b item 5 against a synthetic transcript and local records; (v8) M15 and M4a as read."""
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        u = testdata.U
        idx, root = os.path.join(d, 'sheets.jsonl'), os.path.join(d, 'tx')
        sheet_run, run_a, run_b, run_c = u('sheet'), u('answers-a'), u('answers-b'), u('answers-c')
        review_sheet.append_index({'event': 'issued', 'sheet_run': sheet_run, 'sidecar': '/x/review-2031-06-01.json',
                                   'sheet_sha256': common.sha256_text('the sheet')}, idx)
        review_sheet.append_index({'event': 'delivered', 'sheet_run': sheet_run, 'delivered_ref': 'sess-x:m1'}, idx)
        Path(root, 'project').mkdir(parents=True)
        Path(root, 'project', 'sess-x.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in (
            {'uuid': 'm1', 'timestamp': '2031-06-01T17:00:00Z',
             'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'the sheet'}]}},
            {'uuid': 'm2', 'timestamp': '2031-06-01T18:00:00Z', 'message': {'role': 'user', 'content': '1. yes'}},
            {'uuid': 'm3', 'timestamp': '2031-06-01T18:05:00Z', 'message': {'role': 'user', 'content': '2. no'}})))
        seen = {}
        his = []

        class R:
            def read(self, sql, params=None, tag=None):
                seen[tag] = params
                if tag == 'M10b_answers':
                    return [{'id': run_a, 'sheet_run': sheet_run, 'message_ref': 'sess-x:m2',
                             'message_at': '2031-06-01T18:00:00+00:00', 'rows': json.dumps({'1': {'verbatim': 'yes'}})},
                            {'id': run_b, 'sheet_run': sheet_run, 'message_ref': 'sess-x:m1',
                             'rows': {'1': {'verbatim': 'no'}}},          # the delivery itself, cited as his reply
                            {'id': run_c, 'sheet_run': sheet_run, 'message_ref': 'sess-x:m3',     # (v9) a second
                             'message_at': '2031-06-01T18:09:00+00:00',     # message, stored with another time
                             'rows': {'2': {'verbatim': 'no'}}}]
                if tag == 'M15':
                    return [{'waiting': 3, 'rewritten_ask_again': 1, 'rows_answered': 2, 'his_decisions': len(his)}]
                if tag == 'M4a':
                    return [{'agrees_on_yes_no': True, 'named_place': None, 'n': len(his)}] if his else []
                return []
        out = scoreboard.run(R(), testdata.OWNER, T, only=['M10b_answers', 'M15', 'M4a'], sheets=idx,
                             transcripts=[root])
        a = out['M10b_answers']
        self.assertEqual((a['checked'], [(p['answers_run'], p['sheet']) for p in a['problems']]),
                         (3, [(run_b, '/x/review-2031-06-01.json'), (run_c, '/x/review-2031-06-01.json')]))
        self.assertEqual(a['problems'][1]['problems'], ["the stored message time is not the reply's time in the "
                                                        'transcript'])
        self.assertEqual(scoreboard.scalar(a), 2)
        # (v8) his answers wait for him: the confirmed level reads "waiting on his app" until he decides
        self.assertEqual(out['M15'], {'waiting': 3, 'rewritten_ask_again': 1, 'rows_answered': 2, 'his_decisions': 0,
                                      'confirmed_level': 'waiting on his app'})
        self.assertEqual((scoreboard.scalar(out['M15']), out['M4a']), (3, {'rows': []}))
        self.assertEqual((seen['M15']['uid'], seen['M4a']['uid']), (testdata.OWNER, testdata.OWNER))
        his.append('a decision of his')
        out2 = scoreboard.run(R(), testdata.OWNER, T, only=['M15', 'M4a'])
        self.assertEqual(out2['M15']['confirmed_level'], 'his decisions recorded')
        self.assertEqual(out2['M4a']['rows'], [{'agrees_on_yes_no': True, 'named_place': None, 'n': 1}])
        # the failing run is disputed once (the next sheet asks its rows again), however often the scoreboard runs
        with mock.patch.dict(os.environ, {'EVIDENCE_DISPUTED': os.path.join(d, 'disputed.jsonl')}):
            self.assertEqual([scoreboard.dispute_failed_answers(out) for _i in range(2)], [2, 0])
            self.assertEqual(manifest.disputed_runs(), sorted([run_b, run_c]))
            self.assertEqual(manifest.disputed_rows()[0]['sheet'], '/x/review-2031-06-01.json')


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
        self.assertEqual((rep['review_sheet']['rows'], rep['review_sheet']['decisions']), (52, 1))
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

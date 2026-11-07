#!/usr/bin/env python3
"""Synthetic-fixture contracts: python3 scripts/client_evidence/test_client_evidence.py (no network, no database, no real data)."""
import copy, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accounting, labor, mail_manifest as mm, timeline
from common import ContractError, canon, sha256_hex

OWNER = '00000000-0000-0000-0000-0000000000aa'
VEH = '00000000-0000-0000-0000-0000000000bb'
CLOCK = '2030-01-01T00:00:00+00:00'
H1, H2, H3 = (sha256_hex(x) for x in ('doc-one', 'doc-two', 'composite'))


def att(part, sha, claims=(), name='doc.pdf'):
    return {'part_id': part, 'filename': name, 'sha256': sha, 'byte_size': 1000, 'claims': list(claims),
            'private_original_ref': {'bucket': 'user-documents', 'storage_path': f'{OWNER}/{sha}.pdf'}}


def claim(kind, key, amount, page=1, **kw):
    return {'kind': kind, 'economic_key': key, 'document_kind': 'invoice', 'amount': amount, 'citation': {'page': page, 'line': 3}, **kw}


def msg(mid, attachments, sent='2030-02-01T10:00:00-04:00'):
    return {'gmail_message_id': mid, 'gmail_thread_id': 't-' + mid[:2], 'rfc_message_id': f'<{mid}@example.invalid>',
            'sent_at': sent, 'attachments': attachments}


def manifest(messages, relations=()):
    return {'schema': mm.SCHEMA, 'account_ref': 'acct-synthetic', 'messages': messages, 'relations': list(relations)}


class Mail(unittest.TestCase):
    def test_citations_ids_and_four_clocks_stay_apart(self):
        c = claim('invoice_claim', 'inv-1', '100.00', document_date='2029-12-01', service_period_start='2029-10-01', service_period_end='2029-11-01')
        cs = mm.plan(manifest([msg('m1aa', [att('p1', H1, [c])])]), OWNER, CLOCK)
        cells = {f['field_key']: f['value_normalized'] for f in cs['envelopes'][0]['revision']['fields']}
        o = cells['origin.0']
        self.assertEqual((o['gmail_message_id'], o['gmail_thread_id'], o['attachment_part_id'], o['account_ref']), ('m1aa', 't-m1', 'p1', 'acct-synthetic'))
        self.assertTrue(o['rfc_message_id'].startswith('<'))
        cl = cells['claim.0']
        self.assertEqual((cl['clock_document_date'], cl['clock_service_period_start']), ('2029-12-01', '2029-10-01'))
        self.assertEqual(o['clock_sent_at'], '2030-02-01T10:00:00-04:00')
        self.assertEqual(cl['citation']['page'], 1)
        self.assertEqual(cells['clock.ingest']['clock_ingest_at'], CLOCK)
        self.assertEqual(cs['envelopes'][0]['original']['sha256'], H1)

    def test_forward_same_bytes_is_one_original_two_origins(self):
        c = claim('invoice_claim', 'inv-1', '100.00')
        cs = mm.plan(manifest([msg('m1aa', [att('p1', H1, [c])]), msg('m2bb', [att('p9', H1, [c])], '2030-03-01T00:00:00+00:00')]), OWNER, CLOCK)
        self.assertEqual(len(cs['envelopes']), 1)
        self.assertEqual(cs['envelopes'][0]['origin_count'], 2)
        item = cs['economic_items'][0]
        self.assertEqual(len(cs['economic_items']), 1)
        self.assertEqual(len(item['origins']), 2)

    def test_composite_and_component_count_one_economic_item(self):
        c = claim('invoice_claim', 'inv-1', '100.00')
        rel = {'kind': 'composite_of', 'composite_sha256': H3, 'component_sha256s': [H1]}
        cs = mm.plan(manifest([msg('m1aa', [att('p1', H1, [c])]), msg('m2bb', [att('p2', H3, [claim('invoice_claim', 'inv-1', '100.00', page=2)])])], [rel]), OWNER, CLOCK)
        self.assertEqual(len(cs['envelopes']), 2)
        self.assertEqual(len(cs['economic_items']), 1)
        self.assertEqual(cs['economic_items'][0]['amount'], '100.00')
        self.assertEqual({o['sha256'] for o in cs['economic_items'][0]['origins']}, {H1, H3})
        self.assertTrue(any(f['field_key'] == 'relation.composite' for e in cs['envelopes'] for f in e['revision']['fields']))

    def test_conflicting_amounts_are_flagged_not_merged(self):
        cs = mm.plan(manifest([msg('m1aa', [att('p1', H1, [claim('invoice_claim', 'k', '100.00')]), att('p2', H2, [claim('invoice_claim', 'k', '90.00')])])]), OWNER, CLOCK)
        self.assertTrue(cs['economic_items'][0]['conflicts'])

    def test_claim_kinds_are_distinct_and_never_posted(self):
        kinds = ['estimate_quote', 'invoice_claim', 'supplier_cost', 'customer_billed', 'deposit', 'balance', 'payment_request', 'payment_assertion']
        cs = mm.plan(manifest([msg('m1aa', [att('p1', H1, [claim(k, 'k-' + k, '1.00') for k in kinds])])]), OWNER, CLOCK)
        norm = [f['value_normalized'] for f in cs['envelopes'][0]['revision']['fields'] if f['field_key'].startswith('claim.')]
        self.assertEqual({n['kind'] for n in norm}, set(kinds))
        self.assertTrue(all(n['posted'] is False and n['assertion_status'] == 'claim_unverified' for n in norm))
        d = {n['kind']: n['direction'] for n in norm}
        self.assertEqual((d['customer_billed'], d['supplier_cost'], d['payment_assertion']), ('revenue_candidate', 'expense_candidate', 'none'))
        self.assertNotEqual(d['customer_billed'], d['supplier_cost'])
        self.assertEqual(cs['envelopes'][0]['posting'], {'expense_posted': False, 'payment_posted': False})

    def test_privacy_and_access_denials(self):
        base = manifest([msg('m1aa', [att('p1', H1)])])
        bad = copy.deepcopy(base); bad['messages'][0]['attachments'][0]['private_original_ref']['bucket'] = 'public'
        with self.assertRaises(ContractError): mm.plan(bad, OWNER, CLOCK)
        bad = copy.deepcopy(base); bad['messages'][0]['attachments'][0]['private_original_ref']['storage_path'] = 'other-owner/x.pdf'
        with self.assertRaises(ContractError): mm.plan(bad, OWNER, CLOCK)
        bad = copy.deepcopy(base); bad['messages'][0]['attachments'][0]['private_original_ref']['storage_path'] = f'{OWNER}/../x.pdf'
        with self.assertRaises(ContractError): mm.plan(bad, OWNER, CLOCK)
        for key, val in (('access_token', 'x'), ('body', 'raw mail text'), ('raw_text', 'x')):
            bad = copy.deepcopy(base); bad['messages'][0][key] = val
            with self.assertRaises(ContractError, msg=key): mm.plan(bad, OWNER, CLOCK)
        bad = copy.deepcopy(base); bad['messages'][0]['attachments'][0]['claims'] = [claim('deposit', 'k', '1.00', note='XX00ABCDEFGHIJKLMNOP')]
        with self.assertRaises(ContractError): mm.plan(bad, OWNER, CLOCK)
        bad = copy.deepcopy(base); bad['messages'][0]['sent_at'] = '2030-02-01T10:00:00'
        with self.assertRaises(ContractError): mm.plan(bad, OWNER, CLOCK)
        bad = copy.deepcopy(base); bad['messages'][0]['attachments'][0]['sha256'] = 'abc'
        with self.assertRaises(ContractError): mm.plan(bad, OWNER, CLOCK)

    def test_replay_is_deterministic_and_apply_needs_backup(self):
        m = manifest([msg('m1aa', [att('p1', H1, [claim('invoice_claim', 'k', '1.00')])])])
        a, b = mm.plan(m, OWNER, CLOCK), mm.plan(m, OWNER, CLOCK)
        self.assertEqual(canon(a), canon(b))
        sent = []
        with self.assertRaises(ContractError): mm.apply(a, None, sent.append)
        with self.assertRaises(ContractError): mm.apply(a, {'changeset_sha256': 'x'}, sent.append)
        self.assertEqual(sent, [])
        mm.apply(a, {'changeset_sha256': sha256_hex(canon(a))}, sent.append)
        self.assertEqual(len(sent), 1)
        self.assertEqual((sent[0]['mode'], sent[0]['action']), ('financial_evidence_v1', 'submit'))
        self.assertNotIn('byte_size', sent[0]['original'])

    def test_no_ownership_or_permission_surface(self):
        cs = mm.plan(manifest([msg('m1aa', [att('p1', H1, [claim('deposit', 'k', '1.00')])])]), OWNER, CLOCK)
        text = canon(cs).lower()
        for w in ('grant', 'co_owner', 'ownership_verified', 'permission', 'granted_by'):
            self.assertNotIn(w, text)

    def test_cell_cap_is_loud(self):
        many = [claim('deposit', f'k{i}', '1.00', page=1) for i in range(101)]
        with self.assertRaises(ContractError): mm.plan(manifest([msg('m1aa', [att('p1', H1, many)])]), OWNER, CLOCK)


class Accounting(unittest.TestCase):
    def test_net_zero_balance_keeps_nonzero_cost_and_deposit(self):
        v = accounting.invoice_view({'lines': [{'amount': '3000.00'}, {'amount': '1000.00'}, {'amount': '200.00'}], 'discount': '-400.00',
                                     'deposit': '3800.00', 'printed_balance': '0.00'})
        self.assertEqual((v['net'], v['deposit_applied'], v['balance'], v['cost_basis_retained']), ('3800.00', '3800.00', '0.00', '3800.00'))
        self.assertFalse(v['zero_balance_is_zero_cost'])
        self.assertEqual(v['flags'], [])

    def test_printed_mismatch_is_flagged_not_fixed(self):
        v = accounting.invoice_view({'lines': [{'amount': '10.00'}], 'deposit': '4.00', 'printed_balance': '5.00', 'printed_net': '11.00'})
        self.assertEqual(len(v['flags']), 2)
        self.assertEqual(v['balance'], '6.00')

    def test_sum_check_and_cost_vs_billed(self):
        f = accounting.sum_check(['2000', '834', '514.40', '1500', '1470'], '6278.40', 'est')
        self.assertEqual((f['components_sum'], f['difference']), ('6318.40', '-40.00'))
        self.assertIsNone(accounting.sum_check(['1', '2'], '3', 'ok'))
        cb = accounting.cost_vs_billed('100.00', '120.00')
        self.assertEqual((cb['markup'], cb['additive']), ('20.00', False))


RATES = [{'category': '*', 'rate': '90', 'effective_from': '2030-01-01', 'effective_to': '2030-12-31', 'source_ref': 'doc:letter#p1'},
         {'category': 'body', 'rate': '50', 'effective_from': '2030-01-01', 'effective_to': '2030-12-31', 'source_ref': 'doc:letter#p1'}]
CLAIM = {'as_of': '2030-06-01', 'claimed_total_hours': '100', 'stated_labor_amount': '8500.00',
         'categories': [{'name': 'body', 'hours': '40'}, {'name': 'paint', 'hours': '60'}]}


class Labor(unittest.TestCase):
    def test_exact_hours_rate_and_category_rate_wins(self):
        r = labor.invoice_labor(CLAIM, RATES)
        self.assertEqual([x['amount'] for x in r['rows']], ['2000.00', '5400.00'])
        self.assertEqual((r['claimed_hours'], r['computed_labor'], r['verified']), ('100', '7400.00', False))
        self.assertTrue(any('stated labor 8500.00 != computed 7400.00' in f for f in r['flags']))

    def test_total_mismatch_current_rate_and_missing_rate(self):
        c = dict(CLAIM, claimed_total_hours='101')
        r = labor.invoice_labor(c, RATES, current_rate='160')
        self.assertTrue(any('claimed total 101h != category sum 100h' in f for f in r['flags']))
        self.assertTrue(any('differs from current 160.00; historical used' in f for f in r['flags']))
        r2 = labor.invoice_labor(CLAIM, [])
        self.assertIsNone(r2['computed_labor'])
        self.assertTrue(any('rate missing' in f for f in r2['flags']))

    def test_discount_arithmetic_conflict_is_flagged_unresolved(self):
        c = dict(CLAIM, stated_labor_amount='7400.00', pre_discount_balance='10000.00', discounted_balance='5000.00',
                 category_reduction={'category': 'body', 'rate': '40'})
        r = labor.invoice_labor(c, [{'category': '*', 'rate': '90', 'source_ref': 's'}, {'category': 'body', 'rate': '50', 'source_ref': 's'}])
        self.assertEqual(r['discount_check']['expected'], '9600.00')
        self.assertEqual(r['discount_check']['difference'], '-4600.00')
        self.assertTrue(any('unresolved, not corrected' in f for f in r['flags']))

    def test_parent_subdocument_not_double_counted(self):
        kept, dropped = labor.dedupe_claims([{'economic_key': 'a', 'origins': [1]}, {'economic_key': 'a', 'origins': [2]}, {'economic_key': 'b'}])
        self.assertEqual((len(kept), dropped, kept[0]['origins']), (2, ['a'], [1, 2]))

    def test_floats_refused(self):
        with self.assertRaises(ContractError): labor.invoice_labor(dict(CLAIM, categories=[{'name': 'x', 'hours': 1.5}]), RATES)


def img(i, at=None, src='exif_original', **kw):
    d = {'image_id': f'img-{i}', 'vehicle_id': VEH, 'identity': 'confirmed', 'origin': 'library', 'intent': 'labor',
         'capture': at and {'source': src, 'at': at}}
    d.update(kw)
    return d


class Photos(unittest.TestCase):
    def test_544_undated_frames_invent_nothing(self):
        frames = [img(i) for i in range(544)]
        for f in frames: f['created_at'] = '2030-03-07T01:35:43-04:00'   # importer clock must be ignored
        r = labor.photo_sessions(frames, VEH)
        self.assertEqual((r['status'], r['hours_lower'], r['sessions']), ('no_evidence', None, []))
        self.assertEqual(r['held']['no_trusted_capture_time'], 544)
        h = labor.default_hold(frames)
        self.assertTrue(h['hold'] and h['frames_with_trusted_capture_time'] == 0)
        self.assertFalse(labor.default_hold([img(1, '2030-01-01T09:00:00+00:00')])['hold'])

    def test_import_or_untrusted_clock_is_not_a_capture_time(self):
        r = labor.photo_sessions([img(1, '2030-03-07T01:35:43+00:00', src='created_at'), img(2, '2030-03-07T02:00:00+00:00', src='email_sent_at')], VEH)
        self.assertEqual(r['status'], 'no_evidence')

    def test_clusters_gap_cap_and_no_minimum_time(self):
        fr = [img(1, '2030-05-01T09:00:00+00:00'), img(2, '2030-05-01T09:30:00+00:00'), img(3, '2030-05-01T13:00:00+00:00')]
        r = labor.photo_sessions(fr, VEH)
        self.assertEqual(len(r['sessions']), 2)
        self.assertEqual(r['hours_lower'], '0.5')            # lone frame adds nothing: no minimum, no 70% span
        self.assertIsNone(r['hours_upper'])
        self.assertTrue(r['sessions'][1]['single_frame'])
        cap = labor.photo_sessions([img(i, f'2030-05-01T{9 + i // 2:02d}:{(i % 2) * 30:02d}:00+00:00') for i in range(20)], VEH,
                                   dict(labor.PHOTO_CONFIG, max_session_minutes=60))
        self.assertEqual((cap['hours_lower'], cap['sessions'][0]['capped']), ('1', True))

    def test_overlapping_windows_count_once(self):
        a = [img(1, '2030-05-01T09:00:00+00:00', technician='a'), img(2, '2030-05-01T11:00:00+00:00', technician='a')]
        # a second burst inside the first window cannot extend it past the union
        b = [img(3, '2030-05-01T10:00:00+00:00'), img(4, '2030-05-01T10:30:00+00:00')]
        r = labor.photo_sessions(a + b, VEH, dict(labor.PHOTO_CONFIG, gap_minutes=45))
        self.assertLessEqual(float(r['hours_lower']), 2.0)

    def test_exclusions_and_identity_uncertainty(self):
        t = '2030-05-01T09:00:00+00:00'
        fr = [img(1, t, identity='unresolved'), img(2, t, origin='personal'), img(3, t, origin='misattributed'), img(4, t, origin='review_needed'),
              img(5, t, intent='inspection'), img(6, t, intent='documentation'), img(7, t, intent='parts_sourcing'), img(8, t, vehicle_id='other')]
        r = labor.photo_sessions(fr, VEH)
        self.assertEqual(r['status'], 'no_evidence')
        self.assertEqual((r['held']['identity_not_confirmed'], r['held']['excluded_origin'], r['held']['non_install_intent'], r['held']['other_vehicle']), (1, 3, 3, 1))

    def test_alternative_evidence_is_never_additive(self):
        inv = labor.invoice_labor(CLAIM, RATES)
        ph = labor.photo_sessions([img(1, '2030-05-01T09:00:00+00:00'), img(2, '2030-05-01T10:00:00+00:00')], VEH)
        rec = labor.reconcile(inv, ph)
        self.assertFalse(rec['additive'])
        self.assertNotIn('total_hours', rec)
        self.assertEqual(rec['invoice_claim_hours'], '100')
        self.assertEqual(labor.reconcile(inv, labor.photo_sessions([img(1)], VEH))['relation'], 'not_assessable')
        big = labor.photo_sessions([img(i, f'2030-05-{1 + i // 4:02d}T08:{(i % 4) * 10:02d}:00+00:00') for i in range(40)], VEH)
        self.assertIn('conflict', ' '.join(labor.reconcile(dict(inv, claimed_hours='1'), big)['flags']))


def src(stance, **kw):
    d = {'stance': stance, 'title': stance + ' event', 'citation': {'origin_key': 'gmail:a:m1:p1', 'page': 1}}
    d.update(kw)
    return d


class Timeline(unittest.TestCase):
    def test_quote_plan_promise_report_are_not_completed_work(self):
        for st in ('quote', 'plan', 'promise', 'reported_completion', 'payment_request', 'payment_assertion', 'status_inquiry'):
            e = timeline.event_from_source(src(st, sent_at='2030-02-01T00:00:00+00:00'), 'run1')
            self.assertFalse(e['completed_work_asserted'])
            self.assertNotEqual(e['stance'], 'visual_observed')

    def test_sent_at_never_becomes_work_date(self):
        e = timeline.event_from_source(src('reported_completion', sent_at='2030-10-28T00:00:00+00:00'), 'r')
        self.assertEqual((e['time']['kind'], e['time']['start']), ('unknown', None))
        self.assertEqual(e['clocks']['sent_at'], '2030-10-28T00:00:00+00:00')
        iv = timeline.event_from_source(src('reported_work', service_period_start='2030-02-01', service_period_end='2030-06-13', sent_at='2030-07-14T00:00:00+00:00'), 'r')
        self.assertEqual((iv['time']['kind'], iv['time']['start'], iv['time']['end']), ('interval', '2030-02-01', '2030-06-13'))
        b = timeline.event_from_source(src('reported_completion', not_after='2030-10-28'), 'r')
        self.assertEqual((b['time']['kind'], b['time']['start'], b['time']['end']), ('interval', None, '2030-10-28'))

    def test_every_event_cites_and_names_its_producer(self):
        with self.assertRaises(ContractError): timeline.event_from_source({'stance': 'plan', 'title': 't', 'citation': {}}, 'r')
        with self.assertRaises(ContractError): timeline.event_from_source(src('nonsense'), 'r')
        e = timeline.event_from_source(src('plan'), 'run7')
        self.assertEqual((e['citation']['origin_key'], e['producer']['run_id'], e['producer']['name']), ('gmail:a:m1:p1', 'run7', timeline.PRODUCER))

    def test_images_use_only_trusted_capture_time_and_confirmed_identity(self):
        undated = timeline.event_from_image(img(1, None), 'r')
        self.assertEqual(undated['time']['kind'], 'unknown')
        dated = timeline.event_from_image(img(2, '2030-05-01T09:00:00+00:00'), 'r')
        self.assertEqual(dated['time']['basis'], 'trusted_capture_time')
        self.assertEqual(dated['citation']['image_id'], 'img-2')
        self.assertEqual(timeline.event_from_image(img(3, None, src='created_at'), 'r')['time']['kind'], 'unknown')
        for bad in (img(4, identity='unresolved'), img(5, origin='personal'), img(6, origin='privacy_hold')):
            self.assertIsNone(timeline.event_from_image(bad, 'r'))

    def test_replay_idempotent_and_supersession_keeps_rows(self):
        s = [src('plan')]
        first = timeline.project(s, [], 'run1')
        self.assertEqual(len(first['events']), 1)
        again = timeline.project(s, [], 'run2', prior=first['events'])
        self.assertEqual((again['events'], again['supersessions']), ([], []))
        changed = timeline.project([src('plan', service_period_start='2030-01-01', service_period_end='2030-02-01')], [], 'run3', prior=first['events'])
        self.assertEqual(len(changed['events']), 1)
        self.assertEqual(changed['supersessions'][0]['action'], 'mark_superseded_keep_row')
        self.assertEqual(changed['deletions'], [])
        gone = timeline.project([], [], 'run4', prior=first['events'])
        self.assertEqual((len(gone['supersessions']), gone['deletions']), (1, []))
        done = dict(first['events'][0], superseded_by='run3')
        self.assertEqual(timeline.project(s, [], 'run5', prior=[done])['supersessions'], [])


if __name__ == '__main__':
    unittest.main()

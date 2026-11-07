#!/usr/bin/env python3
"""Synthetic-fixture tests: python3 -I scripts/client_evidence/test_client_evidence.py  (run by scripts/ci/verify.sh).
No network, no credentials, no real data: every id, hash and amount here is invented."""
import copy, io, json, os, sys, tempfile, unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accounting, cli, labor, mail_manifest as mm, pipeline, timeline, transport
from common import ContractError, canon, privacy_scan, sha256_hex

OWNER = '11111111-1111-4111-8111-111111111111'
H = lambda s: sha256_hex(s)
SHA_A, SHA_B, SHA_C = H('doc-a'), H('doc-b'), H('doc-c')
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)
CLOCK = '2026-11-07T12:00:00+00:00'


def claim(kind='invoice_claim', key='inv-1', amount='100.00', page=1, **kw):
    return {'kind': kind, 'economic_key': key, 'document_kind': 'invoice', 'amount': amount, 'citation': {'page': page, 'line': 3}, **kw}


def att(sha=SHA_A, claims=(), part='p1', path=None, size=1000, name='a.pdf'):
    return {'part_id': part, 'sha256': sha, 'filename': name, 'byte_size': size,
            'private_original_ref': {'bucket': 'user-documents', 'storage_path': path or f'{OWNER}/orig/{sha[:8]}.pdf'}, 'claims': list(claims)}


def msg(mid, atts, sent='2026-03-01T10:00:00+00:00'):
    return {'gmail_message_id': mid, 'gmail_thread_id': 't1', 'rfc_message_id': f'<{mid}@x.test>', 'sent_at': sent, 'attachments': atts}


def manifest(messages, relations=()):
    return {'schema': 'client_mail_manifest_v1', 'account_ref': 'acct-1', 'messages': list(messages), 'relations': list(relations)}


class FakeWriter:
    """In-memory model of ingest_financial_evidence as read in migration 20261028161800: key replay needs an equal digest,
    a second revision must name the current run and carry every prior field_key."""
    def __init__(self):
        self.docs, self.calls, self.fail_on = {}, [], None

    def read(self, sha):
        d = self.docs.get(sha)
        if not d:
            return None
        live = d['runs'][-1]['fields'] if d['runs'] else []
        # Shape of read_financial_accounting = read_financial_evidence || {lines, accounting_status, tax_ready, ...}
        # (deployed definition read 2026-11-07): the document keeps attributes.runs.
        return {'document': {'id': d['id'], 'attributes': {'runs': [{k: r[k] for k in ('run_id', 'key', 'supersedes_run_id')} for r in d['runs']]}},
                'fields': [{'field_key': k, 'value_raw': v} for k, v in live], 'concerns': [], 'lines': [],
                'accounting_status': 'retained_evidence_not_posted', 'tax_ready': False,
                'purchase_deduplication': 'not_assessed', 'payment_reconciliation': 'not_assessed'}

    def submit(self, body):
        self.calls.append(copy.deepcopy(body))
        if self.fail_on == len(self.calls):
            raise transport.TransportError('writer refused: HTTP 409 Financial evidence admission refused')
        o, rev = body['original'], body['revision']
        d = self.docs.setdefault(o['sha256'], {'id': f"doc-{len(self.docs)}", 'runs': []})
        digest = sha256_hex(canon([o, rev]))
        old = next((r for r in d['runs'] if r['key'] == rev['idempotency_key']), None)
        if old:
            if old['digest'] != digest:
                raise transport.TransportError('idempotency key payload conflict')
            return {'data': {**old['receipt'], 'duplicate': True}, 'expense_posted': False}
        cur = d['runs'][-1]['run_id'] if d['runs'] else None
        if d['runs'] and rev.get('supersedes_run_id') != cur:
            raise transport.TransportError('existing original requires explicit revision supersession')
        keys = {f['field_key'] for f in rev['fields']}
        if d['runs'] and {k for k, _ in d['runs'][-1]['fields']} - keys:
            raise transport.TransportError('correction requires the complete prior field set')
        run = f"run-{len(d['runs'])}-{d['id']}"
        rec = {'run_id': run, 'key': rev['idempotency_key'], 'supersedes_run_id': rev.get('supersedes_run_id'), 'digest': digest,
               'fields': [(f['field_key'], f['value_raw']) for f in rev['fields']],
               'receipt': {'document_id': d['id'], 'extraction_run_id': run, 'review_ids': [1] * len(rev.get('concerns', [])), 'duplicate': False}}
        d['runs'].append(rec)
        return {'data': rec['receipt'], 'expense_posted': False}


def plan_for(m, **kw):
    return mm.plan(m, OWNER, CLOCK, **kw)


class MailPlan(unittest.TestCase):
    def test_forward_same_bytes_adds_origin_not_document(self):
        m = manifest([msg('m1', [att(claims=[claim()])]), msg('m2', [att(part='p9', claims=[claim()])], sent='2026-03-05T10:00:00+00:00')])
        cs = plan_for(m)
        self.assertEqual(len(cs['envelopes']), 1)
        self.assertEqual(cs['envelopes'][0]['origin_count'], 2)
        keys = [f['field_key'] for f in cs['envelopes'][0]['revision']['fields']]
        self.assertEqual(sum(k.startswith('origin.') for k in keys), 2)
        self.assertEqual(sum(k.startswith('claim.') for k in keys), 1)   # identical claim from the forward is one cell

    def test_idempotency_key_covers_content_owner_not_clock(self):
        a = plan_for(manifest([msg('m1', [att(claims=[claim()])])]))
        b = mm.plan(manifest([msg('m1', [att(claims=[claim()])])]), OWNER, '2026-11-08T00:00:00+00:00')
        fwd = plan_for(manifest([msg('m1', [att(claims=[claim()])]), msg('m2', [att(part='p9', claims=[claim()])])]))
        chg = plan_for(manifest([msg('m1', [att(claims=[claim(amount='200.00')])])]))
        k = lambda c: c['envelopes'][0]['revision']['idempotency_key']
        self.assertEqual(k(a), k(b))                      # ingest clock is not content
        self.assertNotEqual(k(a), k(fwd))                 # a later forward is a new revision
        self.assertNotEqual(k(a), k(chg))                 # a changed claim is a new revision
        other = '22222222-2222-4222-8222-222222222222'
        m2 = manifest([msg('m1', [att(path=f'{other}/orig/x.pdf', claims=[claim()])])])
        self.assertNotEqual(k(a), k(mm.plan(m2, other, CLOCK)))   # owner is part of the key

    def test_conflicting_forwarded_claims_both_kept_and_flagged(self):
        m = manifest([msg('m1', [att(claims=[claim(amount='100.00')])]), msg('m2', [att(part='p2', claims=[claim(amount='150.00')])])])
        rev = plan_for(m)['envelopes'][0]['revision']
        self.assertEqual(sum(f['field_key'].startswith('claim.') for f in rev['fields']), 2)
        self.assertTrue(any('disagree' in c['detail'] for c in rev['concerns']))
        self.assertTrue(any('amount' in c['detail'] for c in rev['concerns']))

    def test_every_emitted_concern_matches_deployed_constraint(self):
        allowed = {'montant_non_corrobore', 'ecart_arithmetique', 'ecart_tva', 'doublon_suspect',
                   'piece_illisible', 'tiers_non_identifie', 'hors_perimetre', 'cut_off'}   # deployed check, read-only metadata
        self.assertEqual(set(mm.ALLOWED_CONCERN_TYPES), allowed)
        self.assertNotIn('client_evidence_conflict', allowed)
        self.assertTrue(set(mm.CONCERN_CLASS_TO_TYPE.values()) <= allowed)
        m = manifest([msg('m1', [att(claims=[claim(amount='100.00')])]), msg('m2', [att(part='p2', claims=[claim(amount='150.00')])]),
                      msg('m3', [att(SHA_B, path=f'{OWNER}/o/b.pdf'), att(SHA_B, path=f'{OWNER}/o/a.pdf', part='p9')])])
        cs = [c for e in plan_for(m)['envelopes'] for c in e['revision']['concerns']]
        self.assertTrue(cs)
        for c in cs:
            self.assertIn(c['concern_type'], allowed)
            self.assertIn(c['priority'], ('low', 'medium', 'high', 'critical'))
            self.assertRegex(c['detail'], r'^\[client_evidence:[a-z_]+\] ')   # producer's own class kept in detail
            self.assertLessEqual(len(c['detail']), 2000)
        bad = copy.deepcopy(plan_for(m))
        bad['envelopes'][0]['revision']['concerns'][0]['concern_type'] = 'client_evidence_conflict'
        with self.assertRaisesRegex(ContractError, 'concern_type/priority'):
            mm.validate_changeset(bad, OWNER)

    def test_same_bytes_different_size_refused_and_path_conflict_flagged(self):
        with self.assertRaises(ContractError):
            plan_for(manifest([msg('m1', [att(size=10)]), msg('m2', [att(part='p2', size=11)])]))
        m = manifest([msg('m1', [att(path=f'{OWNER}/o/b.pdf')]), msg('m2', [att(part='p2', path=f'{OWNER}/o/a.pdf')])])
        env = plan_for(m)['envelopes'][0]
        self.assertEqual(env['original']['storage_path'], f'{OWNER}/o/a.pdf')
        self.assertTrue(any('private paths' in c['detail'] for c in env['revision']['concerns']))

    def test_composite_relation_drives_grouping_with_different_keys(self):
        comp = [att(SHA_B, [claim(key='part-1', amount='60.00')]), att(SHA_C, [claim(key='part-2', amount='40.00')], part='p2')]
        whole = att(SHA_A, [claim(key='whole', amount='100.00')], part='p3')
        rel = [{'kind': 'composite_of', 'composite_sha256': SHA_A, 'component_sha256s': [SHA_B, SHA_C]}]
        items = mm.economic_items(manifest([msg('m1', comp + [whole])], rel))
        by = {i['economic_key']: i for i in items}
        self.assertFalse(by['whole']['counts_toward_total'])
        self.assertEqual(sorted(by['whole']['rollup_of']), ['part-1', 'part-2'])
        self.assertEqual(sum(Decimal(i['amount']) for i in items if i['counts_toward_total']), Decimal('100.00'))
        # equal single claim under a different key is aliased, not added
        twin = [att(SHA_B, [claim(key='comp', amount='100.00')]), att(SHA_A, [claim(key='comp-copy', amount='100.00')], part='p2')]
        r2 = [{'kind': 'composite_of', 'composite_sha256': SHA_A, 'component_sha256s': [SHA_B]}]
        its = mm.economic_items(manifest([msg('m1', twin)], r2))
        self.assertEqual(len(its), 1)
        self.assertEqual(its[0]['aliases'], ['comp-copy'])
        # unmatched composite claim is flagged
        odd = [att(SHA_B, [claim(key='c', amount='5.00')]), att(SHA_A, [claim(key='z', amount='999.00')], part='p2')]
        its = mm.economic_items(manifest([msg('m1', odd)], r2))
        self.assertTrue(any('matches no component' in x for i in its for x in i['conflicts']))

    def test_lines_keyed_by_kind_and_row_offset(self):
        c1 = claim(kind='invoice_claim', lines=[{'row': 1, 'description': 'x', 'amount': '1.00'}])
        c2 = claim(kind='customer_billed', lines=[{'row': 1, 'description': 'x', 'amount': '1.00'}])
        lines = plan_for(manifest([msg('m1', [att(claims=[c1, c2])])]))['envelopes'][0]['revision']['lines']
        self.assertEqual(len({l['source_line_key'] for l in lines}), 2)
        self.assertTrue(all(int(l['source_row']) >= 2 for l in lines))
        with self.assertRaises(ContractError):
            plan_for(manifest([msg('m1', [att(claims=[claim(lines=[{'row': 0, 'description': 'x'}])])])]))

    def test_refusals(self):
        bad_cases = [att(path='/other/x.pdf'), att(path=f'{OWNER}/../x.pdf'), att(path=f'{OWNER}/noext'), att(sha='zz')]
        for a in bad_cases:
            with self.assertRaises(ContractError):
                plan_for(manifest([msg('m1', [a])]))
        with self.assertRaises(ContractError):
            plan_for(manifest([msg('m1', [att()], sent='2026-03-01T10:00:00')]))     # naive sent_at
        with self.assertRaises(ContractError):
            plan_for(manifest([msg('m1', [att(claims=[claim(amount=100.0)])])]))     # float money
        m = manifest([msg('m1', [att()])]); m['messages'][0]['attachments'][0]['api_key'] = 'x'
        with self.assertRaises(ContractError):
            plan_for(m)

    def test_four_clocks_and_no_posting(self):
        c = claim(document_date='2016-02-01', service_period_start='2016-02-01', service_period_end='2016-06-13')
        cs = plan_for(manifest([msg('m1', [att(claims=[c])])]))
        norm = next(f for f in cs['envelopes'][0]['revision']['fields'] if f['field_key'].startswith('claim.'))['value_normalized']
        self.assertEqual((norm['posted'], norm['assertion_status']), (False, 'claim_unverified'))
        self.assertEqual(norm['clock_service_period_end'], '2016-06-13')
        origin = next(f for f in cs['envelopes'][0]['revision']['fields'] if f['field_key'].startswith('origin.'))['value_normalized']
        self.assertIn('clock_sent_at', origin)
        self.assertTrue(cs['envelopes'][0]['revision']['fields'][-1]['field_key'] == 'clock.ingest')


class Privacy(unittest.TestCase):
    def test_scan(self):
        self.assertTrue(privacy_scan({'summary': 'call 555 123 4567 now'}))
        self.assertTrue(privacy_scan({'summary': 'write to a.b@example.com'}))
        self.assertTrue(privacy_scan({'x': {'password': {'a': 1}}}))                 # dict-valued credential key
        self.assertTrue(privacy_scan({'v': 'gb82WEST12345698765432'}))               # lower-case IBAN shape
        self.assertEqual(privacy_scan({'rfc_message_id': '<abc123@mail.example.test>', 'summary': 'rebuild engine, 3 days'}), [])


class ApplySafety(unittest.TestCase):
    def setUp(self):
        self.m = manifest([msg('m1', [att(SHA_A, [claim()]), att(SHA_B, [claim(key='k2')], part='p2')])])
        self.cs = plan_for(self.m)
        self.w = FakeWriter()

    def backup(self, w=None, cs=None, when=NOW):
        return mm.make_backup_artifact(cs or self.cs, OWNER, (w or self.w).read, when)

    def test_apply_end_to_end_then_replay_and_forward(self):
        art = self.backup()
        led = mm.apply(self.cs, OWNER, art, self.w, NOW)
        self.assertTrue(led['complete'])
        self.assertEqual(len(led['done']), 2)
        self.assertEqual(self.w.calls[0]['revision'].get('supersedes_run_id'), None)
        self.assertNotIn('byte_size', self.w.calls[0]['original'])
        # replay of the same changeset: nothing is submitted again, even with a different ingest clock
        n = len(self.w.calls)
        cs2 = mm.plan(self.m, OWNER, '2026-11-09T00:00:00+00:00')
        art2 = mm.make_backup_artifact(cs2, OWNER, self.w.read, NOW)
        led2 = mm.apply(cs2, OWNER, art2, self.w, NOW)
        self.assertEqual((len(led2['already_applied']), len(self.w.calls)), (2, n))
        # a later forward of the same bytes is a NEW revision that supersedes the current run and keeps every prior cell
        m3 = manifest([msg('m1', [att(SHA_A, [claim()]), att(SHA_B, [claim(key='k2')], part='p2')]),
                       msg('m7', [att(SHA_A, [claim()], part='p7')], sent='2026-03-09T10:00:00+00:00')])
        cs3 = plan_for(m3)
        art3 = mm.make_backup_artifact(cs3, OWNER, self.w.read, NOW)
        led3 = mm.apply(cs3, OWNER, art3, self.w, NOW)
        self.assertTrue(led3['complete'])
        self.assertEqual(sorted(d['action'] for d in led3['done']), ['supersede'])   # only SHA_A changed
        self.assertEqual(len(led3['already_applied']), 1)
        self.assertTrue(self.w.calls[-1]['revision']['supersedes_run_id'].startswith('run-0'))

    def test_edited_changeset_refused_even_with_recomputed_hashes(self):
        art = self.backup()
        cs = copy.deepcopy(self.cs)
        cs['envelopes'][0]['original']['storage_path'] = '/etc/passwd.pdf'
        with self.assertRaises(ContractError):
            mm.apply(cs, OWNER, art, self.w, NOW)                                   # path gate re-run at apply
        cs = copy.deepcopy(self.cs)
        cs['envelopes'][0]['revision']['fields'][0]['value_normalized']['x'] = 1     # content no longer matches its key
        with self.assertRaises(ContractError):
            mm.apply(cs, OWNER, art, self.w, NOW)
        cs = copy.deepcopy(self.cs)
        cs['envelopes'][0]['revision']['fields'][0]['value_normalized']['api_token'] = 'x'
        with self.assertRaises(ContractError):
            mm.validate_changeset(cs, OWNER)
        self.assertEqual(self.w.calls, [])

    def test_backup_artifact_verification(self):
        art = self.backup()
        for mutate in (lambda a: a.update(created_at=(NOW - timedelta(days=3)).isoformat()),      # stale (also breaks hash)
                       lambda a: a.update(owner_id='x'),
                       lambda a: a['pre_state'].pop(SHA_A)):
            bad = copy.deepcopy(art); mutate(bad)
            with self.assertRaises(ContractError):
                mm.verify_backup(bad, self.cs, OWNER, NOW)
        old = self.backup(when=NOW - timedelta(days=3))      # internally consistent but too old
        with self.assertRaises(ContractError):
            mm.verify_backup(old, self.cs, OWNER, NOW)
        other = plan_for(manifest([msg('m1', [att(SHA_A, [claim(amount='9.00')])])]))
        with self.assertRaises(ContractError):
            mm.verify_backup(art, other, OWNER, NOW)           # different changeset
        with self.assertRaises(ContractError):
            mm.verify_backup(art, self.cs, OWNER, datetime(2026, 11, 7, 12, 0))   # naive now

    def test_stale_backup_blocks_apply(self):
        art = self.backup()
        FakeWriter.submit(self.w, {'mode': 'financial_evidence_v1', 'action': 'submit', 'original': self.cs['envelopes'][0]['original'],
                                   'revision': {**self.cs['envelopes'][0]['revision'], 'idempotency_key': 'other-key'}})
        led = mm.apply(self.cs, OWNER, art, self.w, NOW)
        self.assertFalse(led['complete'])
        self.assertIn('differs from the backup', led['failed'][0]['reason'])

    def test_partial_apply_stops_and_resumes(self):
        art = self.backup()
        self.w.fail_on = 2
        led = mm.apply(self.cs, OWNER, art, self.w, NOW)
        self.assertEqual((len(led['done']), len(led['failed']), len(led['not_attempted'])), (1, 1, 0))
        # three originals: failure in the middle leaves the rest not attempted
        m = manifest([msg('m1', [att(SHA_A, [claim()]), att(SHA_B, [claim(key='k2')], part='p2'), att(SHA_C, [claim(key='k3')], part='p3')])])
        cs, w = plan_for(m), FakeWriter()
        art = mm.make_backup_artifact(cs, OWNER, w.read, NOW)
        w.fail_on = 2
        led = mm.apply(cs, OWNER, art, w, NOW)
        self.assertEqual([len(led[k]) for k in ('done', 'failed', 'not_attempted')], [1, 1, 1])
        w.fail_on = None
        led2 = mm.apply(cs, OWNER, art, w, NOW, resume=led)     # same artifact stays valid: untouched docs still match it
        self.assertTrue(led2['complete'])
        self.assertEqual((len(led2['already_applied']), len(led2['done'])), (1, 2))

    def test_non_receipt_response_stops(self):
        class Bad(FakeWriter):
            def submit(self, body):
                return {'data': {}, 'expense_posted': False}
        art = self.backup()
        led = mm.apply(self.cs, OWNER, art, Bad(), NOW)
        self.assertFalse(led['complete'])

    def test_unrecognised_read_response_fails_closed(self):
        with self.assertRaises(ContractError):
            mm.state_summary({'unexpected': 1})

    def test_artifact_file_is_private_and_outside_repo(self):
        art = self.backup()
        with tempfile.TemporaryDirectory() as d:
            rc = mm.write_backup_artifact(art, os.path.join(d, 'b.json'), cli.REPO)
            self.assertEqual(oct(os.stat(rc['artifact_path']).st_mode & 0o777), '0o600')
            back = mm.load_backup(rc['artifact_path'], rc['artifact_sha256'], rc['bytes'])
            self.assertEqual(back['changeset_sha256'], art['changeset_sha256'])
            with self.assertRaises(ContractError):
                mm.load_backup(rc['artifact_path'], 'f' * 64)
            with self.assertRaises(FileExistsError):
                mm.write_backup_artifact(art, os.path.join(d, 'b.json'), cli.REPO)
        with self.assertRaises(ContractError):
            mm.write_backup_artifact(art, os.path.join(cli.REPO, 'x.json'), cli.REPO)


class HttpAdapter(unittest.TestCase):
    def test_requests_are_shaped_for_the_writer_and_never_leak_the_token(self):
        seen = []

        class R:
            status = 200
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s): return b'{"data": null}'
        t = transport.HttpTransport('SECRET-TOKEN', opener=lambda req, timeout: (seen.append(req), R())[1])
        self.assertIsNone(t.read(SHA_A))
        self.assertEqual(json.loads(seen[0].data), {'mode': 'financial_evidence_v1', 'action': 'read', 'original_sha256': SHA_A, 'include_context': False})
        self.assertTrue(seen[0].full_url.endswith('/functions/v1/ingest-observation'))
        with self.assertRaises(transport.TransportError):
            transport.HttpTransport('', opener=None)
        with self.assertRaises(transport.TransportError):
            transport.HttpTransport('t', base_url='http://x')
        import urllib.error
        def boom(req, timeout):
            raise urllib.error.HTTPError('u', 409, 'c', {}, io.BytesIO(b'{"error":"refused"}'))
        try:
            transport.HttpTransport('SECRET-TOKEN', opener=boom).submit({})
        except transport.TransportError as e:
            self.assertNotIn('SECRET-TOKEN', str(e))
            self.assertIn('409', str(e))


class Timeline(unittest.TestCase):
    def src(self, **kw):
        return {'stance': 'quote', 'title': 'Quote', 'citation': {'origin_key': 'gmail:a:m:p', 'page': 1}, **kw}

    def test_bad_dates_and_capture_source(self):
        for bad in ({'document_date': 'banana'}, {'service_period_start': 'x', 'service_period_end': 'y'},
                    {'service_period_start': '2016-06-01', 'service_period_end': '2016-02-01'}, {'sent_at': 'soon'}):
            with self.assertRaises(ContractError):
                timeline.event_from_source(self.src(**bad), 'r1')
        with self.assertRaises(ContractError):
            timeline.event_from_source(self.src(capture_time='2016-03-27T10:00:00'), 'r1')      # no capture source
        e = timeline.event_from_source(self.src(capture_time='2016-03-27T10:00:00', capture_source='exif_original', stance='visual_observed'), 'r1')
        self.assertEqual((e['time']['clock_offset'], e['time']['utc_known']), ('unknown', False))

    def test_sent_at_is_not_a_work_date_and_quote_is_not_work(self):
        e = timeline.event_from_source(self.src(sent_at='2016-02-03T00:00:00+00:00', stance='reported_work'), 'r1')
        self.assertEqual(e['time']['kind'], 'unknown')
        self.assertIs(e['completed_work_asserted'], False)

    def test_stable_identity_and_supersession_pointer(self):
        a = timeline.event_from_source(self.src(document_date='2016-02-01'), 'r1')
        renamed = timeline.event_from_source(self.src(document_date='2016-02-01', title='Quote (edited)'), 'r2')
        self.assertEqual(a['event_key'], renamed['event_key'])
        self.assertNotEqual(a['content_hash'], renamed['content_hash'])
        out = timeline.project([renamed], 'r2', prior=[a])
        self.assertEqual(out['events'][0]['supersedes']['content_hash'], a['content_hash'])
        self.assertEqual(out['deletions'], [])
        again = timeline.project([a], 'r3', prior=[a])
        self.assertEqual((again['events'], again['supersessions']), ([], []))
        gone = timeline.project([], 'r4', prior=[a])
        self.assertEqual(gone['supersessions'][0]['action'], 'mark_superseded_keep_row')

    def test_image_events_scope(self):
        base = {'image_id': 'i1', 'identity': 'confirmed', 'origin': 'archive', 'capture': {'source': 'exif_original', 'at': '2016-03-27T10:00:00'}}
        self.assertIsNotNone(timeline.event_from_image(base, 'r'))
        for bad in ({'identity': 'likely'}, {'identity_basis': 'context'}, {'origin': 'privacy_hold'}, {'origin': 'person'}, {'privacy_hold': True}):
            self.assertIsNone(timeline.event_from_image({**base, **bad}, 'r'))

    def test_publication_refused(self):
        with self.assertRaises(ContractError):
            timeline.publish()
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            self.assertEqual(cli.main(['publish-timeline']), 2)


class Labor(unittest.TestCase):
    def img(self, i, at, offset=None, intent='labor', **kw):
        return {'image_id': i, 'vehicle_id': 'V', 'identity': 'confirmed', 'origin': 'archive', 'intent': intent,
                'capture': {'source': 'exif_original', 'at': at, **({'offset': offset} if offset else {})}, **kw}

    W = {'start': '2016-02-01', 'end': '2016-06-13'}

    def test_naive_clocks_are_review_only_no_invented_hours(self):
        ims = [self.img(f'i{n}', f'2016-03-27T1{n}:00:00') for n in range(3)]
        ph = labor.photo_sessions(ims, 'V', self.W)
        self.assertEqual(ph['status'], 'review_camera_local_only')
        self.assertIsNone(ph['hours_lower'])
        self.assertEqual(ph['camera_local_review']['clock_offset'], 'unknown')
        self.assertIsNone(ph['camera_local_review']['billable_hours'])
        self.assertEqual(ph['observed_day_count'], 1)
        self.assertEqual(ph['offset_unknown_frames'], 3)

    def test_aware_and_naive_never_clustered_together(self):
        ims = [self.img('a1', '2016-03-27T10:00:00', '+01:00'), self.img('a2', '2016-03-27T10:30:00', '+01:00'), self.img('a3', '2016-03-27T11:00:00', '+01:00'), self.img('n1', '2016-03-27T10:30:00')]
        ph = labor.photo_sessions(ims, 'V', self.W)
        self.assertEqual(ph['status'], 'estimated_from_photos')
        self.assertEqual(ph['hours_lower_exact_seconds'], 3600)
        self.assertEqual(ph['hours_lower'], '1.00')
        self.assertEqual(len(ph['sessions']), 1)
        self.assertEqual(ph['sessions'][0]['images'], ['a1', 'a2', 'a3'])
        self.assertEqual(ph['camera_local_review']['days'][0]['frames'], 1)

    def test_window_and_plausibility_gates(self):
        ims = [self.img('in', '2016-03-27T10:00:00', '+00:00'), self.img('after', '2016-09-08T10:00:00', '+00:00'),
               self.img('before', '2016-01-02T10:00:00', '+00:00'), self.img('reset', '1970-01-01T00:00:00', '+00:00')]
        ph = labor.photo_sessions(ims, 'V', self.W)
        self.assertEqual((ph['held'].get('after_service_window'), ph['held'].get('before_service_window'), ph['held'].get('implausible_clock')), (1, 1, 1))
        self.assertEqual(ph['frames_in_scope'], 1)
        ph2 = labor.photo_sessions(ims[:1], 'V', self.W, vehicle_range={'start': '2017-01-01', 'end': '2017-12-31'})
        self.assertEqual(ph2['held']['outside_vehicle_date_range'], 1)

    def test_bad_clocks_refused_not_crash(self):
        with self.assertRaises(ContractError):
            labor.photo_sessions([self.img('x', 'banana')], 'V', self.W)
        with self.assertRaises(ContractError):
            labor.photo_sessions([self.img('x', '2016-03-27T10:00:00', '01:00')], 'V', self.W)

    def test_intent_unclassified_is_its_own_hold(self):
        ims = [self.img('u', '2016-03-27T10:00:00', '+00:00', intent=None), self.img('p', '2016-03-27T10:05:00', '+00:00', intent='parts_shopping')]
        ph = labor.photo_sessions(ims, 'V', self.W)
        self.assertEqual((ph['held'].get('intent_unclassified'), ph['held'].get('non_install_intent')), (1, 1))
        self.assertNotIn('non_install_intent', {k for k, v in ph['held'].items() if k == 'intent_unclassified'})
        self.assertEqual(ph['status'], 'presence_only')     # days are still reported as presence
        self.assertEqual(ph['observed_day_count'], 1)

    def test_identity_holds(self):
        ims = [self.img('a', '2016-03-27T10:00:00', '+00:00', identity='likely'), self.img('b', '2016-03-27T10:00:00', '+00:00', identity_basis='context'),
               self.img('c', '2016-03-27T10:00:00', '+00:00', origin='privacy_hold'), {**self.img('d', '2016-03-27T10:00:00', '+00:00'), 'vehicle_id': 'Z'}]
        ph = labor.photo_sessions(ims, 'V', self.W)
        self.assertEqual(ph['held'], {'identity_not_confirmed': 1, 'identity_context_only': 1, 'excluded_origin': 1, 'other_vehicle': 1})
        self.assertEqual(ph['status'], 'no_evidence')

    def test_invoice_arithmetic_rates_and_discount_flag(self):
        rates = [{'category': 'a', 'rate': '90', 'effective_from': '2016-01-01', 'effective_to': '2016-12-31', 'source_ref': 'rate-doc-1'},
                 {'category': 'a', 'rate': '120', 'effective_from': '2017-01-01', 'source_ref': 'rate-doc-2'}]
        claim_ = {'categories': [{'name': 'a', 'hours': '600'}, {'name': 'b', 'hours': '76', 'rate': '90'}], 'claimed_total_hours': '676',
                  'stated_labor_amount': '60840', 'as_of': '2016-02-01', 'service_period': {'start': '2016-02-01', 'end': '2016-06-13'}}
        r = labor.invoice_labor(claim_, rates, current_rate='120')
        self.assertEqual((r['computed_labor'], r['claimed_hours'], r['verified']), ('60840.00', '676', False))
        self.assertTrue(any('differs from current' in f for f in r['flags']))
        self.assertEqual(r['rows'][0]['rate_source'], 'rate-doc-1')
        r2 = labor.invoice_labor({**claim_, 'categories': [{'name': 'a', 'hours': '1'}], 'as_of': None}, rates)
        self.assertIsNone(r2['computed_labor'])
        d = labor.invoice_labor({**claim_, 'category_reduction': {'category': 'a', 'rate': '80'}, 'pre_discount_balance': '10000.00',
                                 'discounted_balance': '4500.00'}, rates)
        self.assertEqual(d['discount_check'], {'expected': '4000.00', 'stated': '4500.00', 'difference': '500.00'})
        self.assertTrue(any('unresolved, not corrected' in f for f in d['flags']))
        with self.assertRaises(ContractError):
            labor.invoice_labor({**claim_, 'category_reduction': {'category': 'zz', 'rate': '1'}, 'pre_discount_balance': '1', 'discounted_balance': '1'}, rates)
        with self.assertRaises(ContractError):
            labor.rate_for('a', '2016-02-01', rates + [{'category': 'a', 'rate': '95'}])
        with self.assertRaises(ContractError):
            labor.invoice_labor({**claim_, 'categories': [{'name': 'a', 'hours': 1.5}]}, rates)

    def test_reconcile_never_adds_and_reports_days(self):
        inv = labor.invoice_labor({'categories': [{'name': 'a', 'hours': '1', 'rate': '90'}], 'as_of': '2016-02-01'}, [])
        ims = [self.img(f'a{n}', f'2016-03-27T{10 + n // 2}:{30 * (n % 2):02d}:00', '+00:00') for n in range(7)] + [self.img('b1', '2016-03-28T10:00:00', '+00:00')]
        ph = labor.photo_sessions(ims, 'V', self.W)
        rec = labor.reconcile(inv, ph, claimed_days=1)
        self.assertFalse(rec['additive'])
        self.assertEqual(rec['relation'], 'photo_lower_bound_exceeds_claim')
        self.assertEqual(rec['days_relation'], 'observed_days_exceed_claimed')
        self.assertFalse(any(k in rec for k in ('total_hours', 'combined_hours', 'sum')))
        self.assertEqual(ph['hours_lower'], '3.00')
        self.assertFalse(rec['invoice_hours_verified'])
        self.assertTrue(labor.default_hold([{'capture': None}])['hold'])


class Accounting(unittest.TestCase):
    def test_invoice_view_and_flags(self):
        v = accounting.invoice_view({'lines': [{'amount': '1000'}, {'amount': '500'}], 'discount': '100', 'deposit': '1400',
                                     'printed_net': '1400.00', 'printed_balance': '5.00'})
        self.assertEqual((v['net'], v['balance'], v['cost_basis_retained'], v['zero_balance_is_zero_cost']), ('1400.00', '0.00', '1400.00', False))
        self.assertEqual(len(v['flags']), 1)
        self.assertEqual(accounting.sum_check(['1', '2'], '3', 'x'), None)
        self.assertEqual(accounting.sum_check(['1', '2'], '4', 'x')['resolution'], 'unresolved_not_corrected')
        self.assertFalse(accounting.cost_vs_billed('10', '15')['additive'])


class Pipeline(unittest.TestCase):
    def build(self, images=(), rates=()):
        lab = claim(kind='labor_claim', key='lab-1', amount=None, service_period_start='2016-02-01', service_period_end='2016-06-13',
                    document_date='2016-06-13', labor={'categories': [{'name': 'a', 'hours': '676', 'rate': '90'}], 'claimed_total_hours': '676',
                                                       'stated_labor_amount': '60840', 'claimed_days': 2})
        quote = claim(kind='estimate_quote', key='q-1', amount='500.00', document_date='2016-01-15')
        done = claim(kind='completion_report', key='w-1', amount=None, summary='engine installed (as reported)')
        m = manifest([msg('m1', [att(SHA_A, [lab, quote, done])])])
        return pipeline.build(m, OWNER, CLOCK, rates=rates, images=images, vehicle_id='V')

    def test_end_to_end_without_hand_built_dicts(self):
        out = self.build()
        rev = out['changeset']['envelopes'][0]['revision']
        keys = [f['field_key'] for f in rev['fields']]
        self.assertEqual(sum(k.startswith('timeline.') for k in keys), 3)
        self.assertEqual(sum(k.startswith('labor.') for k in keys), 1)
        tl = [f['value_normalized'] for f in rev['fields'] if f['field_key'].startswith('timeline.')]
        self.assertTrue(all(t['completed_work_asserted'] is False and t['assertion_status'] == 'source_claim_unverified' for t in tl))
        self.assertTrue(all('run_id' not in t['producer'] for t in tl))
        self.assertEqual({t['stance'] for t in tl}, {'quote', 'reported_work', 'reported_completion'})
        lab = next(f for f in rev['fields'] if f['field_key'].startswith('labor.'))['value_normalized']
        self.assertEqual((lab['computed_labor'], lab['verified']), ('60840.00', False))
        self.assertEqual(out['labor_reconciliation'][0]['photos']['status'], 'not_supplied')
        self.assertIn('refused', out['publication'])
        self.assertEqual(mm.validate_changeset(out['changeset'], OWNER), None)
        self.assertEqual(self.build()['changeset'], out['changeset'])         # deterministic

    def test_plan_then_apply_through_fake_writer(self):
        out = self.build()
        w = FakeWriter()
        led = mm.apply(out['changeset'], OWNER, mm.make_backup_artifact(out['changeset'], OWNER, w.read, NOW), w, NOW)
        self.assertTrue(led['complete'])

    def test_photo_reconciliation_windowed_and_offset_explicit(self):
        ims = [{'image_id': 'i1', 'vehicle_id': 'V', 'identity': 'confirmed', 'origin': 'archive', 'intent': 'labor',
                'capture': {'source': 'exif_original', 'at': '2016-03-27T10:00:00'}},
               {'image_id': 'i2', 'vehicle_id': 'V', 'identity': 'confirmed', 'origin': 'archive', 'intent': None,
                'capture': {'source': 'exif_original', 'at': '2016-09-08T10:00:00', 'offset': '+00:00'}}]
        out = self.build(images=ims)
        ent = out['labor_reconciliation'][0]
        self.assertEqual(ent['photos']['status'], 'review_camera_local_only')
        self.assertEqual(ent['photos']['held']['after_service_window'], 1)
        self.assertEqual(ent['reconciliation']['relation'], 'not_assessable')
        self.assertFalse(ent['reconciliation']['additive'])
        self.assertEqual(len(out['local_image_events']), 2)      # local only, never in the changeset
        self.assertFalse(any('i1' in canon(f) for f in out['changeset']['envelopes'][0]['revision']['fields']))


class Cli(unittest.TestCase):
    def run_cli(self, argv, **kw):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = cli.main(argv, **kw)
        return rc, out.getvalue(), err.getvalue()

    def test_plan_backup_apply_offline_and_refusals(self):
        with tempfile.TemporaryDirectory() as d:
            mp = os.path.join(d, 'm.json'); json.dump(manifest([msg('m1', [att(SHA_A, [claim()])])]), open(mp, 'w'))
            cp = os.path.join(d, 'cs.json')
            rc, out, _ = self.run_cli(['plan', mp, '--owner', OWNER, '--clock', CLOCK, '--out', cp])
            self.assertEqual(rc, 0)
            self.assertEqual(json.loads(out)['changeset']['envelopes'], 1)
            w = FakeWriter()
            bp = os.path.join(d, 'backup.json')
            rc, out, _ = self.run_cli(['backup', cp, '--owner', OWNER, '--out', bp, '--token-env', 'X'], now=NOW, make_transport=lambda e: w)
            self.assertEqual(rc, 0)
            receipt = json.loads(out)
            rc, out, _ = self.run_cli(['apply', cp, '--owner', OWNER, '--backup', bp, '--receipt-sha', receipt['artifact_sha256']], now=NOW)
            self.assertEqual((rc, json.loads(out)['writes']), (0, 0))
            self.assertEqual(w.calls, [])                                   # offline check never wrote
            rc, _, err = self.run_cli(['apply', cp, '--owner', OWNER, '--backup', bp, '--receipt-sha', 'f' * 64], now=NOW)
            self.assertEqual(rc, 2)
            rc, _, err = self.run_cli(['apply', cp, '--owner', OWNER, '--backup', bp, '--receipt-sha', receipt['artifact_sha256'], '--execute'], now=NOW)
            self.assertEqual(rc, 2)                                         # --execute without a credential name is refused
            rc, out, _ = self.run_cli(['apply', cp, '--owner', OWNER, '--backup', bp, '--receipt-sha', receipt['artifact_sha256'],
                                       '--execute', '--token-env', 'X'], now=NOW, make_transport=lambda e: w)
            self.assertTrue(json.loads(out)['complete'])
            rc, _, err = self.run_cli(['plan', mp, '--owner', OWNER, '--clock', CLOCK, '--out', cp])
            self.assertEqual(rc, 2)                                         # never overwrites an existing plan file

    def test_labor_hold(self):
        with tempfile.TemporaryDirectory() as d:
            ip = os.path.join(d, 'i.json'); json.dump([{'image_id': 'a', 'capture': None}], open(ip, 'w'))
            rc, out, _ = self.run_cli(['labor-hold', ip])
            self.assertTrue(json.loads(out)['hold'])


if __name__ == '__main__':
    unittest.main()

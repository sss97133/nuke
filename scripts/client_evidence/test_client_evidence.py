#!/usr/bin/env python3
"""Synthetic-fixture tests: python3 -I scripts/client_evidence/test_client_evidence.py  (run by scripts/ci/verify.sh).
No network, no credentials, no real data: every id, hash and amount here is invented."""
import copy, hashlib, io, json, os, sys, tempfile, unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accounting, cli, labor, mail_manifest as mm, pipeline, projection, timeline, transport
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


# ---------------------------------------------------------------- owner-private projections (image timeline + labor reconciliation)
class FakePrivate(FakeWriter):
    """In-memory model of public.private_work_projections + ingest_private_work_projection (migration 20261107210025):
    per-item idempotency with a content+producer digest, head lookup, 'unchanged' for equal content, supersession that must
    name the current head, sticky privacy hold, document refs that must exist in the account, atomic per revision."""
    def __init__(self):
        super().__init__()
        self.rows, self.idem, self.submits = [], {}, []

    def _heads(self):
        sup = {r['supersedes_id'] for r in self.rows if r['supersedes_id']}
        return [r for r in self.rows if r['id'] not in sup]

    def projection_read(self, keys):
        return [{**{k: r[k] for k in ('id', 'projection_key', 'revision_no', 'content_digest', 'source_privacy_hold', 'run_label')},
                 'superseded': False} for r in self._heads() if r['projection_key'] in keys]

    def projection_submit(self, body):
        self.submits.append(copy.deepcopy(body))
        rev, staged, results = body['revision'], [], []
        assert body['action'] == 'projection_submit' and set(body) == {'mode', 'action', 'revision'}
        for it in sorted(rev['projections'], key=lambda x: x['projection_key']):
            content = sha256_hex(canon([it['kind'], it['source_privacy_hold'], it['holds'], it['evidence_refs'],
                                        it.get('financial_document_id'), it['payload']]))
            request = sha256_hex(canon([content, rev['producer'], rev['method'], rev['version']]))
            ik = rev['idempotency_key'] + ':' + it['projection_key']
            if ik in self.idem:
                if self.idem[ik][0] != request:
                    raise transport.TransportError('idempotency key payload conflict')
                results.append({'projection_key': it['projection_key'], 'revision_no': self.idem[ik][1], 'status': 'duplicate'})
                continue
            for ref in it['evidence_refs']:
                if ref['kind'] == 'financial_document_revision':
                    d = self.docs.get(ref['original_sha256'])
                    if not d or d['id'] != ref['document_id'] or not any(r['run_id'] == ref['extraction_run_id'] and r['key'] == ref['revision_idempotency_key'] for r in d['runs']):
                        raise transport.TransportError('financial document revision is not in this account scope')
            heads = {r['projection_key']: r for r in self._heads()}
            head = heads.get(it['projection_key'])
            sup = it.get('supersedes_id')
            if head:
                if head['content_digest'] == content:
                    results.append({'projection_key': it['projection_key'], 'revision_no': head['revision_no'], 'status': 'unchanged'})
                    continue
                if sup != head['id']:
                    raise transport.TransportError('correction must name the current revision')
                if head['source_privacy_hold'] and not it['source_privacy_hold']:
                    raise transport.TransportError('a source privacy hold cannot be cleared')
            elif sup:
                raise transport.TransportError('correction must name the current revision')
            row = {'id': f"p{len(self.rows) + len(staged)}", 'projection_key': it['projection_key'], 'revision_no': (head['revision_no'] + 1) if head else 1,
                   'supersedes_id': sup, 'content_digest': content, 'source_privacy_hold': it['source_privacy_hold'],
                   'run_label': rev['run_label'], 'item': it}
            staged.append((row, ik, request))
            results.append({'projection_key': it['projection_key'], 'revision_no': row['revision_no'], 'status': 'created'})
        for row, ik, request in staged:           # atomic: nothing is kept if any item above was refused
            self.rows.append(row)
            self.idem[ik] = (request, row['revision_no'])
        return {'data': {'run_label': rev['run_label'], 'results': results, 'writes': len(staged), 'public_timeline_written': False},
                'expense_posted': False, 'public_timeline_written': False}


def pimg(i, at, offset=None, intent='labor', sha=None, **kw):
    return {'image_id': i, 'sha256': sha or H('img-' + i), 'vehicle_id': 'V', 'identity': 'confirmed', 'origin': 'archive', 'intent': intent,
            'capture': {'source': 'exif_original', 'at': at, **({'offset': offset} if offset else {})}, **kw}


class PrivateProjection(unittest.TestCase):
    def labor_pipeline(self, images, hours='676', days=2):
        lab = claim(kind='labor_claim', key='lab-1', amount=None, service_period_start='2016-02-01', service_period_end='2016-06-13',
                    document_date='2016-06-13', labor={'categories': [{'name': 'a', 'hours': hours, 'rate': '90'}], 'claimed_total_hours': hours,
                                                       'stated_labor_amount': str(int(hours) * 90), 'claimed_days': days})
        return pipeline.build(manifest([msg('m1', [att(SHA_A, [lab])])]), OWNER, CLOCK, images=images, vehicle_id='V')

    def images(self):
        return [pimg('naive1', '2016-03-27T10:00:00'), pimg('naive2', '2016-03-27T11:00:00'),
                pimg('aware1', '2016-04-02T10:00:00', '+01:00'), pimg('aware2', '2016-04-02T10:20:00', '+01:00'),
                pimg('noint', '2016-04-03T10:00:00', '+00:00', intent=None),
                pimg('personal', '2016-04-04T10:00:00', '+00:00', origin='personal'),
                pimg('unknown', '2016-04-04T11:00:00', '+00:00', identity='unknown'),
                pimg('ctx', '2016-04-04T12:00:00', '+00:00', identity_basis='context'),
                pimg('other', '2016-04-05T12:00:00', '+00:00', vehicle_id='W'),
                pimg('notime', '2016-04-05T12:00:00', capture=None) | {'capture': None}]

    def items(self, out):
        pcs = out['private_projection_changeset']
        return pcs, {i['payload'].get('event_key') or i['payload'].get('reconciliation_key'): i for i in pcs['items']}, \
            {i['projection_key']: i for i in pcs['items']}

    def test_image_observations_are_exact_private_and_conservative(self):
        out = self.labor_pipeline(self.images())
        pcs, _, by_key = self.items(out)
        key = lambda sha: sha256_hex(canon(['image_timeline_event', sha]))[:32]
        it = lambda n: by_key[key(H('img-' + n))]
        # unknown EXIF offset: camera-local value kept verbatim, offset unknown, no UTC and no normalization
        n1 = it('naive1')['payload']
        self.assertEqual((n1['capture']['offset_state'], n1['capture']['camera_local'], n1['time']['camera_local']), ('unknown', '2016-03-27T10:00:00', '2016-03-27T10:00:00'))
        self.assertNotIn('utc', n1['capture']); self.assertNotIn('utc', n1['time'])
        self.assertIn('clock_offset_unknown', it('naive1')['holds'])
        a1 = it('aware1')['payload']
        self.assertEqual((a1['capture']['offset_state'], a1['capture']['utc']), ('known', '2016-04-02T09:00:00+00:00'))
        self.assertEqual(a1['assertion_status'], 'observation_unverified')
        self.assertIs(a1['completed_work_asserted'], False)
        self.assertEqual(a1['subject_vehicle_ref'], 'V')
        # refs are the exact image bytes; the stable key is the hash, not a title
        self.assertEqual(it('aware1')['evidence_refs'], [{'kind': 'image', 'sha256': H('img-aware1')}])
        self.assertIn('intent_unclassified', it('noint')['holds'])
        # personal / unknown / contextual / other-vehicle frames stay held, carry no capture time and no vehicle link
        for n, hold in (('personal', 'privacy_hold'), ('unknown', 'identity_unknown'), ('ctx', 'identity_context_only'), ('other', 'other_or_unassigned_vehicle')):
            p = it(n)['payload']
            self.assertEqual(p['assertion_status'], 'held', n)
            self.assertIn(hold, it(n)['holds'], n)
            self.assertNotIn('subject_vehicle_ref', p, n)
            self.assertEqual((p['capture']['source'], p['time']['kind']), ('withheld', 'unknown'), n)
        self.assertTrue(it('personal')['source_privacy_hold'])
        self.assertFalse(it('unknown')['source_privacy_hold'])
        self.assertIn('no_trusted_capture_time', it('notime')['holds'])
        self.assertEqual(pcs['posting'], {'expense_posted': False, 'payment_posted': False, 'public_timeline_written': False})
        self.assertEqual(privacy_scan(pcs['items']), [])
        self.assertIsNone(projection.validate_changeset(pcs, OWNER))

    def test_labor_claim_and_observation_are_side_by_side_never_added(self):
        out = self.labor_pipeline(self.images())
        pcs, _, by_key = self.items(out)
        lab = next(i for i in pcs['items'] if i['kind'] == 'labor_reconciliation')
        p = lab['payload']
        self.assertEqual((p['claim']['claimed_hours'], p['claim']['source_claim'], p['claim']['verified']), ('676', True, False))
        self.assertEqual((p['additive'], p['billable_hours'], p['hours_verified']), (False, None, False))
        self.assertEqual(p['observed']['hours_lower'], '0.33')            # aware frames only, a lower bound, never merged with 676
        self.assertEqual(p['observed']['observed_day_count'], 3)
        self.assertNotIn('billable_hours', p['observed']['camera_local_review'])         # no hours key of any kind in the review
        self.assertEqual(p['holds']['unknown_clock'], 2)
        self.assertEqual(p['holds']['intent_unclassified'], 1)
        self.assertEqual(p['holds']['identity_not_confirmed'], 1)             # the unknown-identity frame
        self.assertEqual(p['rate_provenance'], [{'category': 'a', 'rate': '90.00', 'rate_source': 'stated_on_document'}])
        self.assertIsInstance(p['conflicts'], list)
        flat = canon(p)
        for bad in ('total_hours', 'combined', '"verified":true'):
            self.assertNotIn(bad, flat)
        # citations: the claim's document revision binds by hash+key (ids are resolved only at apply), plus attachment, message and frames
        self.assertEqual(lab['document_binding']['original_sha256'], SHA_A)
        self.assertEqual(lab['document_binding']['revision_idempotency_key'], out['changeset']['envelopes'][0]['revision']['idempotency_key'])
        kinds = [r['kind'] for r in lab['evidence_refs']]
        self.assertEqual(kinds.count('attachment'), 1); self.assertEqual(kinds.count('source_message'), 1)
        self.assertIn({'kind': 'image', 'sha256': H('img-aware1')}, lab['evidence_refs'])
        self.assertNotIn({'kind': 'image', 'sha256': H('img-personal')}, lab['evidence_refs'])
        self.assertEqual(self.labor_pipeline(self.images())['private_projection_changeset'], pcs)       # deterministic

    def test_frames_without_sha_are_reported_not_guessed(self):
        ims = [{k: v for k, v in pimg('x1', '2016-04-02T10:00:00', '+00:00').items() if k != 'sha256'}]
        out = self.labor_pipeline(ims)
        self.assertIsNone(out['private_projection_changeset'])
        self.assertTrue(all('sha256' in u['reason'] for u in out['private_projection_unpersistable']))

    def test_model_contract_refuses_every_forbidden_shape(self):
        pcs = self.labor_pipeline(self.images())['private_projection_changeset']
        img = next(i for i in pcs['items'] if i['kind'] == 'image_timeline_event' and i['payload']['assertion_status'] == 'observation_unverified'
                   and i['payload']['capture']['offset_state'] == 'unknown')
        lab = next(i for i in pcs['items'] if i['kind'] == 'labor_reconciliation')
        def mut(it, f):
            c = copy.deepcopy(it); f(c); return c
        bad = [
            mut(img, lambda c: c['payload']['capture'].update(utc='2016-03-27T10:00:00+00:00')),            # UTC invented for an unknown offset
            mut(img, lambda c: c['payload'].update(completed_work_asserted=True)),
            mut(img, lambda c: c['payload'].update(stance='completed_work')),
            mut(img, lambda c: c['payload']['identity'].update(state='unconfirmed')),                        # unconfirmed but not held
            mut(img, lambda c: c.update(source_privacy_hold=True)),                                          # privacy hold but not held
            mut(img, lambda c: c['payload'].update(body='mail text')),
            mut(img, lambda c: c['payload'].update(email_address='a@b.invalid')),
            mut(img, lambda c: c['payload'].update(origin_class='a@b.invalid')),
            mut(img, lambda c: c['payload'].update(note='NL00ABCD0123456789')),
            mut(img, lambda c: c.update(evidence_refs=[{'kind': 'image', 'sha256': 'nothex'}])),
            mut(img, lambda c: c.update(evidence_refs=[])),
            mut(img, lambda c: c.update(owner_id=OWNER)),
            mut(img, lambda c: c.update(projection_key='xyz')),
            mut(lab, lambda c: c['payload'].update(additive=True)),
            mut(lab, lambda c: c['payload'].update(billable_hours='9.5')),
            mut(lab, lambda c: c['payload'].update(hours_verified=True)),
            mut(lab, lambda c: c['payload']['claim'].update(verified=True)),
            mut(lab, lambda c: c['payload']['observed'].update(total_hours='700')),
            mut(lab, lambda c: c['payload'].update(payment_verified=True)),
            mut(lab, lambda c: c['payload'].update(ownership_verified=True)),
            mut(lab, lambda c: c['payload']['holds'].update(api_key='x')),
            mut(lab, lambda c: c.pop('document_binding')),
        ]
        for i, b in enumerate(bad):
            with self.assertRaises(ContractError, msg=f'case {i}'):
                projection.check_item(b)
        with self.assertRaises(ContractError):
            projection.validate_changeset({**pcs, 'owner_id': 'someone-else'}, OWNER)
        with self.assertRaises(ContractError):
            projection.validate_changeset({**pcs, 'posting': {'expense_posted': False, 'payment_posted': False, 'public_timeline_written': True}}, OWNER)
        with self.assertRaises(ContractError):
            projection.validate_changeset({**pcs, 'version': 'other'}, OWNER)

    def applied(self, out=None):
        out = out or self.labor_pipeline(self.images())
        w = FakePrivate()
        fin = mm.apply(out['changeset'], OWNER, mm.make_backup_artifact(out['changeset'], OWNER, w.read, NOW), w, NOW)
        self.assertTrue(fin['complete'])
        return out, out['private_projection_changeset'], w

    def test_backup_apply_replay_then_supersession(self):
        out, pcs, w = self.applied()
        art = projection.make_backup(pcs, OWNER, w, NOW)
        self.assertEqual(art['projections_existing'], 0)
        led = projection.apply(pcs, OWNER, art, w, NOW)
        self.assertTrue(led['complete'], led)
        n_rows = len(w.rows)
        self.assertEqual(n_rows, len(pcs['items']))
        sent = w.submits[0]['revision']
        self.assertEqual((sent['producer'], sent['method'], sent['version']), (projection.PRODUCER, projection.METHOD, projection.VERSION))
        # the document revision ref was resolved from the live document, not invented
        lab = next(p for p in sent['projections'] if p['kind'] == 'labor_reconciliation')
        ref = next(r for r in lab['evidence_refs'] if r['kind'] == 'financial_document_revision')
        d = w.docs[SHA_A]
        self.assertEqual((ref['document_id'], ref['extraction_run_id'], lab['financial_document_id']), (d['id'], d['runs'][-1]['run_id'], d['id']))
        self.assertNotIn('document_binding', lab)
        # replay with a fresh backup writes nothing (idempotent), with and without the already-applied shortcut
        art2 = projection.make_backup(pcs, OWNER, w, NOW)
        led2 = projection.apply(pcs, OWNER, art2, w, NOW)
        self.assertTrue(led2['complete']); self.assertEqual(len(w.rows), n_rows); self.assertEqual(led2['done'], [])
        # the same evidence re-planned under a new clock is the same plan (clock is not content)
        # a corrected observation supersedes: new row names the head, the old row is kept
        changed = copy.deepcopy(pcs)
        victim = next(i for i in changed['items'] if i['kind'] == 'image_timeline_event' and i['payload']['assertion_status'] == 'observation_unverified')
        victim['holds'] = sorted(victim['holds'] + ['reviewed_note'])
        art3 = projection.make_backup(changed, OWNER, w, NOW)
        led3 = projection.apply(changed, OWNER, art3, w, NOW)
        self.assertTrue(led3['complete'], led3)
        self.assertEqual(len(w.rows), n_rows + 1)
        new = w.rows[-1]
        self.assertEqual((new['revision_no'], new['supersedes_id']), (2, next(r['id'] for r in w.rows if r['projection_key'] == victim['projection_key'] and r['revision_no'] == 1)))
        self.assertEqual(sum(1 for r in w.rows if r['projection_key'] == victim['projection_key']), 2)      # nothing deleted

    def test_privacy_hold_cannot_be_cleared_through_the_apply_path(self):
        out, pcs, w = self.applied()
        projection.apply(pcs, OWNER, projection.make_backup(pcs, OWNER, w, NOW), w, NOW)
        held = next(i for i in pcs['items'] if i['source_privacy_hold'])
        cleared = copy.deepcopy(pcs)
        c = next(i for i in cleared['items'] if i['projection_key'] == held['projection_key'])
        c['source_privacy_hold'] = False
        c['holds'] = [h for h in c['holds'] if h != 'privacy_hold']
        led = projection.apply(cleared, OWNER, projection.make_backup(cleared, OWNER, w, NOW), w, NOW)
        self.assertFalse(led['complete'])
        self.assertIn('privacy hold cannot be cleared', led['failed'][0]['reason'])
        self.assertTrue(next(r for r in w._heads() if r['projection_key'] == held['projection_key'])['source_privacy_hold'])

    def test_requires_financial_revision_scope_and_stops_without_writing(self):
        out = self.labor_pipeline(self.images())
        pcs, w = out['private_projection_changeset'], FakePrivate()          # financial changeset NOT applied
        led = projection.apply(pcs, OWNER, projection.make_backup(pcs, OWNER, w, NOW), w, NOW)
        self.assertFalse(led['complete'])
        self.assertIn('apply the financial changeset first', led['failed'][0]['reason'])
        self.assertEqual((w.rows, w.submits), ([], []))
        # the writer model (like the database trigger) refuses a ref to a document or run outside the account
        _, pcs2, w2 = self.applied()
        lab = next(i for i in pcs2['items'] if i['kind'] == 'labor_reconciliation')
        d = w2.docs[SHA_A]
        for forged in ({'document_id': 'doc-of-another-account'}, {'extraction_run_id': 'run-of-another-document'}, {'original_sha256': SHA_B}):
            ref = {'kind': 'financial_document_revision', 'document_id': d['id'], 'extraction_run_id': d['runs'][-1]['run_id'],
                   'original_sha256': SHA_A, 'revision_idempotency_key': lab['document_binding']['revision_idempotency_key'], **forged}
            wire = {k: v for k, v in lab.items() if k != 'document_binding'}
            wire.update(evidence_refs=lab['evidence_refs'] + [ref], financial_document_id=d['id'])
            with self.assertRaises(transport.TransportError):
                w2.projection_submit({'mode': 'financial_evidence_v1', 'action': 'projection_submit', 'revision': {
                    'idempotency_key': 'forged', 'producer': 'p', 'method': 'm', 'version': 'v', 'run_label': 'r', 'projections': [wire]}})
        self.assertEqual(w2.rows, [])

    def test_apply_gates_owner_backup_staleness_and_atomic_stop(self):
        out, pcs, w = self.applied()
        art = projection.make_backup(pcs, OWNER, w, NOW)
        with self.assertRaises(ContractError):
            projection.apply(pcs, '22222222-2222-4222-8222-222222222222', art, w, NOW)           # other account
        with self.assertRaises(ContractError):
            projection.apply(pcs, OWNER, art, w, NOW + timedelta(hours=25))                         # stale artifact
        with self.assertRaises(ContractError):
            projection.apply({**pcs, 'items': pcs['items'][:-1]}, OWNER, art, w, NOW)               # artifact is for a different changeset
        forged = {**art, 'owner_id': OWNER, 'pre_state': {}}
        with self.assertRaises(ContractError):
            projection.verify_backup(forged, pcs, OWNER, NOW)                                       # integrity hash
        self.assertEqual(w.submits, [])
        # state moved after the backup: refused, not overwritten
        w.projection_submit({'mode': 'financial_evidence_v1', 'action': 'projection_submit', 'revision': {
            'idempotency_key': 'other', 'producer': 'x', 'method': 'm', 'version': 'v', 'run_label': 'other-run',
            'projections': [{k: v for k, v in pcs['items'][0].items() if k != 'document_binding'}]}})
        n = len(w.rows)
        led = projection.apply(pcs, OWNER, art, w, NOW)
        self.assertFalse(led['complete'])
        self.assertIn('differs from the backup', led['failed'][0]['reason'])
        self.assertEqual(len(w.rows), n)
        # a writer refusal stops the run and reports the rest as not attempted
        _, pcs3, w3 = self.applied(self.labor_pipeline(self.images(), hours='100'))
        w3.projection_submit = lambda body: (_ for _ in ()).throw(transport.TransportError('writer refused: HTTP 409 Private projection admission refused'))
        led = projection.apply(pcs3, OWNER, projection.make_backup(pcs3, OWNER, w3, NOW), w3, NOW)
        self.assertFalse(led['complete']); self.assertEqual(led['done'], [])
        # a non-receipt response stops too
        _, pcs4, w4 = self.applied(self.labor_pipeline(self.images(), hours='200'))
        w4.projection_submit = lambda body: {'data': {'results': []}}
        led = projection.apply(pcs4, OWNER, projection.make_backup(pcs4, OWNER, w4, NOW), w4, NOW)
        self.assertFalse(led['complete'])

    def test_batches_are_capped_and_ordered(self):
        ims = [pimg(f'b{n}', '2016-04-02T10:00:00', '+00:00') for n in range(120)]
        pcs = self.labor_pipeline(ims)['private_projection_changeset']
        bs = projection.batches(pcs)
        self.assertEqual([len(b) for b in bs], [50, 50, 21])
        self.assertEqual(len({projection.batch_key(pcs, b) for b in bs}), 3)

    def test_http_adapter_never_sends_an_owner_or_token_in_projection_calls(self):
        seen = []

        class R:
            status = 200
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s): return b'{"data": []}'
        t = transport.HttpTransport('SECRET-TOKEN', opener=lambda req, timeout: (seen.append(req), R())[1])
        self.assertEqual(t.projection_read(['a' * 32]), [])
        body = json.loads(seen[0].data)
        self.assertEqual(body, {'mode': 'financial_evidence_v1', 'action': 'projection_read', 'keys': ['a' * 32], 'limit': 200})
        self.assertNotIn('SECRET-TOKEN', seen[0].data.decode())
        for k in body:
            self.assertNotIn('owner', k)

    def test_cli_plan_backup_apply_for_projections(self):
        with tempfile.TemporaryDirectory() as d:
            lab = claim(kind='labor_claim', key='lab-1', amount=None, service_period_start='2016-02-01', service_period_end='2016-06-13',
                        document_date='2016-06-13', labor={'categories': [{'name': 'a', 'hours': '10', 'rate': '90'}], 'claimed_total_hours': '10',
                                                           'stated_labor_amount': '900'})
            mp, ip, cp, pp, bp = (os.path.join(d, n) for n in ('m.json', 'i.json', 'cs.json', 'pcs.json', 'b.json'))
            json.dump(manifest([msg('m1', [att(SHA_A, [lab])])]), open(mp, 'w'))
            json.dump(self.images(), open(ip, 'w'))
            c = Cli()
            rc, out, _ = c.run_cli(['plan', mp, '--owner', OWNER, '--clock', CLOCK, '--images', ip, '--vehicle', 'V', '--out', cp, '--projection-out', pp])
            self.assertEqual(rc, 0)
            self.assertGreater(json.loads(out)['private_projection_changeset']['items'], 0)
            w = FakePrivate()
            rc, out, _ = c.run_cli(['backup', cp, '--owner', OWNER, '--out', os.path.join(d, 'fb.json'), '--token-env', 'X'], now=NOW, make_transport=lambda e: w)
            fr = json.loads(out)['artifact_sha256']
            rc, out, _ = c.run_cli(['apply', cp, '--owner', OWNER, '--backup', os.path.join(d, 'fb.json'), '--receipt-sha', fr, '--execute', '--token-env', 'X'], now=NOW, make_transport=lambda e: w)
            self.assertTrue(json.loads(out)['complete'])
            rc, out, _ = c.run_cli(['projection-backup', pp, '--owner', OWNER, '--out', bp, '--token-env', 'X'], now=NOW, make_transport=lambda e: w)
            self.assertEqual(rc, 0)
            rec = json.loads(out)
            rc, out, _ = c.run_cli(['projection-apply', pp, '--owner', OWNER, '--backup', bp, '--receipt-sha', rec['artifact_sha256']], now=NOW)
            self.assertEqual((rc, json.loads(out)['writes']), (0, 0))
            self.assertEqual(w.rows, [])                                    # dry-run default: no write without --execute
            rc, _, _ = c.run_cli(['projection-apply', pp, '--owner', OWNER, '--backup', bp, '--receipt-sha', rec['artifact_sha256'], '--execute'], now=NOW)
            self.assertEqual(rc, 2)                                         # --execute needs a credential name
            rc, _, _ = c.run_cli(['projection-apply', pp, '--owner', OWNER, '--backup', bp, '--receipt-sha', 'f' * 64], now=NOW)
            self.assertEqual(rc, 2)                                         # receipt hash must match the file
            rc, out, _ = c.run_cli(['projection-apply', pp, '--owner', OWNER, '--backup', bp, '--receipt-sha', rec['artifact_sha256'], '--execute', '--token-env', 'X'],
                                   now=NOW, make_transport=lambda e: w)
            self.assertTrue(json.loads(out)['complete'])
            self.assertGreater(len(w.rows), 0)
            rc, _, _ = c.run_cli(['plan', mp, '--owner', OWNER, '--clock', CLOCK, '--out', os.path.join(d, 'cs2.json'), '--projection-out', pp])
            self.assertEqual(rc, 2)                                         # never overwrites a plan file

    # ---- private-security fixes: fail-closed contract, registry, labor allowlist, SQL parity
    def _pair(self):
        pcs = self.labor_pipeline(self.images())['private_projection_changeset']
        img = next(i for i in pcs['items'] if i['kind'] == 'image_timeline_event' and i['payload']['assertion_status'] == 'observation_unverified'
                   and i['payload']['capture']['offset_state'] == 'unknown')
        lab = next(i for i in pcs['items'] if i['kind'] == 'labor_reconciliation')
        return img, lab

    def test_missing_or_mistyped_image_fields_are_refused_not_defaulted(self):
        img, _ = self._pair()
        projection.check_item(img)
        for key in ('assertion_status', 'identity', 'capture', 'time', 'stance', 'completed_work_asserted', 'origin_class', 'intent', 'event_key'):
            c = copy.deepcopy(img); del c['payload'][key]
            with self.assertRaises(ContractError, msg=key):
                projection.check_item(c)
        for path in (('capture', 'offset_state'), ('identity', 'state'), ('capture', 'source'), ('time', 'kind')):
            c = copy.deepcopy(img); del c['payload'][path[0]][path[1]]
            with self.assertRaises(ContractError, msg=str(path)):
                projection.check_item(c)
        # the exact review payload: UTC present, no offset_state, no assertion_status, unconfirmed identity
        c = copy.deepcopy(img)
        c['payload'] = {'stance': 'visual_observed', 'completed_work_asserted': False, 'capture': {'utc': '2016-03-27T10:00:00+00:00'},
                        'identity': {'state': 'unconfirmed'}}
        with self.assertRaises(ContractError):
            projection.check_item(c)
        for mutate in (lambda p: p.update(completed_work_asserted='false'), lambda p: p['capture'].update(offset_state='maybe'),
                       lambda p: p['capture'].update(offset_state='known'),                       # known offset needs its UTC time
                       lambda p: p['time'].update(utc='2016-03-27T10:00:00+00:00'),
                       lambda p: p['identity'].update(extra=1), lambda p: p.update(subject_vehicle_ref='a b'),
                       lambda p: p.update(assertion_status='held', subject_vehicle_ref='V')):
            c = copy.deepcopy(img); mutate(c['payload'])
            with self.assertRaises(ContractError):
                projection.check_item(c)

    def test_labor_cannot_present_a_claim_as_hours_worked(self):
        _, lab = self._pair()
        projection.check_item(lab)
        def mut(f):
            c = copy.deepcopy(lab); f(c['payload']); return c
        for i, c in enumerate([
            mut(lambda p: p['observed'].update(actual_hours='676')), mut(lambda p: p['observed'].update(worked_hours='676')),
            mut(lambda p: p['observed'].update(photo_hours='676')), mut(lambda p: p['observed'].update(billable_hours='676')),
            mut(lambda p: p['observed'].update(paid=True)), mut(lambda p: p['observed'].update(payment_status='paid')),
            mut(lambda p: p['observed']['camera_local_review'].update(billable_hours=None)) if lab['payload']['observed'].get('camera_local_review') else mut(lambda p: p['observed'].update(hours_actual=1)),
            mut(lambda p: p['claim'].update(actual_hours='676')), mut(lambda p: p['holds'].update(worked_hours=3)),
            mut(lambda p: p['holds'].update(unknown_clock='many')), mut(lambda p: p.update(additive='false')),
            mut(lambda p: p.update(hours_verified='false')), mut(lambda p: p['claim'].update(source_claim='true')),
            mut(lambda p: p['observed'].update(status='verified_on_site')), mut(lambda p: p.update(relation='confirmed')),
            mut(lambda p: p['observed'].update(clusters=[{'start': 'a', 'end': 'b', 'frames': 1, 'capped': False, 'single_frame': True, 'hours': 9}])),
            mut(lambda p: p['rate_provenance'].append({'category': 'a', 'paid_hours': 1})),
            mut(lambda p: p['observed'].update(status='review_camera_local_only', hours_lower='1.00')),
        ] + [mut(lambda p, k=k: p.pop(k)) for k in ('claim', 'observed', 'holds', 'rate_provenance', 'conflicts', 'relation', 'additive',
                                                    'hours_verified', 'reconciliation_key')]):
            with self.assertRaises(ContractError, msg=f'case {i}'):
                projection.check_item(c)

    def test_origin_key_that_looks_like_an_address_is_refused_with_a_clear_error(self):
        img, _ = self._pair()
        c = copy.deepcopy(img); c['evidence_refs'].append({'kind': 'source_message', 'origin_key': 'gmail:someone@example.invalid:m1:p1'})
        with self.assertRaises(ContractError) as cm:
            projection.check_item(c)
        self.assertIn('opaque namespace', str(cm.exception))

    def test_leaf_values_are_scalars_and_cannot_smuggle_nested_objects(self):
        img, lab = self._pair()
        nested = {'hours_spent': '9', 'labor_hours_confirmed': {'x': 1}}
        def mut(base, f):
            c = copy.deepcopy(base); f(c['payload']); return c
        cases = [mut(img, lambda p: p.update(origin_class=nested)), mut(img, lambda p: p['identity'].update(basis=nested)),
                 mut(img, lambda p: p['capture'].update(camera_local=nested)), mut(img, lambda p: p['time'].update(basis=[1])),
                 mut(lab, lambda p: p.update(relation=nested)), mut(lab, lambda p: p.update(reconciliation_key=nested)),
                 mut(lab, lambda p: p['claim'].update(claimed_hours=nested)), mut(lab, lambda p: p['claim'].update(computed_labor=nested)),
                 mut(lab, lambda p: p['claim'].update(service_period={'start': nested, 'end': 'x'})),
                 mut(lab, lambda p: p['claim'].update(categories=[{'category': 'a', 'hours': nested}])),
                 mut(lab, lambda p: p['observed'].update(frames_in_scope=nested)), mut(lab, lambda p: p['observed'].update(hours_lower=nested)),
                 mut(lab, lambda p: p['observed'].update(note=nested)), mut(lab, lambda p: p['observed'].update(window={'start': nested})),
                 mut(lab, lambda p: p['observed'].update(clusters=[{'start': 'a', 'end': 'b', 'frames': nested}])),
                 mut(lab, lambda p: p['observed'].update(camera_local_review={'clock_offset': nested, 'days': []})),
                 mut(lab, lambda p: p['observed'].update(camera_local_review={'clock_offset': 'unknown', 'days': [{'camera_local_day': 'd', 'frames': [1]}]}))]
        for i, c in enumerate(cases):
            with self.assertRaises(ContractError, msg=f'case {i}'):
                projection.check_item(c)
        projection.check_item(img); projection.check_item(lab)

    def test_holds_and_refs_get_the_databases_content_scan(self):
        img, _ = self._pair()
        for hold in ('DE89370400440532013000', 'someone@example.invalid', 'x' * 81):
            c = copy.deepcopy(img); c['holds'] = c['holds'] + [hold]
            with self.assertRaises(ContractError, msg=hold):
                projection.check_item(c)
        real_sha = hashlib.sha256(b'synthetic image bytes').hexdigest()
        bank = [{'kind': 'source_message', 'origin_key': 'gmail:acct:DE89370400440532013000:p1'},
                {'kind': 'source_message', 'origin_key': 'gmail:acct:m1:p1', 'rfc_message_id': '<GB82WEST12345698765432@x.test>'}]
        for ref in bank:
            c = copy.deepcopy(img); c['evidence_refs'].append(ref)
            with self.assertRaises(ContractError, msg=str(ref)):
                projection.check_item(c)
        c = copy.deepcopy(img)
        c['evidence_refs'] = [{'kind': 'image', 'sha256': real_sha},
                              {'kind': 'source_message', 'origin_key': 'gmail:acct:m1:p1', 'rfc_message_id': '<CAF3k9xQ2b7d@mail.example.test>'}]
        projection.check_item(c)                                    # lowercase sha256 and a clean RFC Message-ID stay valid
        for n in range(300):                                        # ordinary synthetic bytes: no lowercase hash is ever bank-shaped
            c['evidence_refs'] = [{'kind': 'image', 'sha256': hashlib.sha256(b'bytes-%d' % n).hexdigest()}]
            projection.check_item(c)

    def test_registered_route_and_run_trace_shape(self):
        self.assertEqual(projection.REGISTERED_PRODUCERS, {('client_evidence_projector', 'image_labor_projection', '2026-11-07a')})
        pcs = self.labor_pipeline(self.images())['private_projection_changeset']
        bkey = projection.batch_key(pcs, projection.batches(pcs)[0])
        self.assertRegex(bkey, r'^pwp:[a-f0-9]{48}$')                      # the database accepts exactly this key shape; label = first 20 chars
        self.assertEqual(len(bkey[:20]), 20)

    def test_python_contract_lists_match_the_migration(self):
        import re
        sql = open(os.path.join(os.path.dirname(__file__), '..', '..', 'supabase', 'migrations', '20261107210025_private_work_projections.sql')).read()
        q = lambda t: re.findall(r"'([^']*)'", t)
        # allowed key sets
        body = sql.split('-- parity:allowed_keys', 1)[1].split('ELSE ARRAY', 1)[0]
        sql_sets = {m.group(1): set(q(m.group(2))) for m in re.finditer(r"WHEN '(\w+)' THEN ARRAY\[(.*?)\]", body)}
        self.assertEqual(sql_sets, projection.ALLOWED_KEYS)
        # forbidden keys
        fk = sql.split('-- parity:forbidden_keys', 1)[1].split('IN (', 1)[1].split(')', 1)[0]
        self.assertEqual(set(q(fk)), projection.FORBIDDEN)
        rx = re.findall(r"lower\(k\) ~ '\(([^']*)\)'", sql)
        self.assertIn(projection.FORBIDDEN_RE.pattern.strip('()'), rx)
        self.assertIn(projection.CLAIM_AS_WORK_RE.pattern.strip('()'), rx)
        cb = sql.split('-- parity:container_keys', 1)[1].split('ELSE ARRAY', 1)[0]
        self.assertEqual({m.group(1): set(q(m.group(2))) for m in re.finditer(r"WHEN '(\w+)' THEN ARRAY\[(.*?)\]", cb)}, projection.CONTAINER_KEYS)
        self.assertIn(projection.IBAN_SQL.pattern, sql)
        self.assertNotIn('SECURITY DEFINER', sql.split('CREATE FUNCTION public.', 1)[1])      # no definer function in public
        self.assertEqual(sql.count('SECURITY DEFINER SET'), 1)
        self.assertIn('CREATE FUNCTION private_work_internal.account_ok', sql)
        # registered producer, status and relation vocabularies
        reg = sql.split('-- parity:producer_registry', 1)[1].split('))', 1)[0]
        self.assertEqual({tuple(q(t)) for t in re.findall(r"\(([^()]*)\)", reg + ')')}, projection.REGISTERED_PRODUCERS)
        def vocab(after, before):
            return set(q(sql.split(after, 1)[1].split(before, 1)[0]))
        self.assertEqual(vocab("(p->'observed'->>'status') IN (", ")"), projection.LABOR_STATUS)
        self.assertEqual(vocab("(p->>'relation') IN (", ")"), projection.LABOR_RELATION)
        req_img = re.search(r"p \?& ARRAY\[(.*?)\]\)\s+AND p->'stance'", sql, re.S).group(1)
        self.assertEqual(tuple(q(req_img)), projection.IMAGE_REQUIRED)
        req_lab = re.search(r"\(p \?& ARRAY\[('reconciliation_key'.*?)\]\)", sql, re.S).group(1)
        self.assertEqual(tuple(q(req_lab)), projection.LABOR_REQUIRED)


if __name__ == '__main__':
    unittest.main()

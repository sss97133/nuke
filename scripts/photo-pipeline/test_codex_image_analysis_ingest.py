import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import codex_image_analysis_ingest as producer

IMAGE = '10000000-0000-0000-0000-000000000001'
RUN = '20000000-0000-0000-0000-000000000001'

class AdmissionTest(unittest.TestCase):
    def reading(self):
        return dict(image_id=IMAGE, is_vehicle=True, view='detail', category='unknown',
                    matches_filed_vehicle='unsure', quality='good', confidence=.8)

    def run_cli(self, row=None, extra=(), private=False, existing=(), corrupt=None, returned_id=None):
        calls = []
        saved = copy.deepcopy(list(existing))
        def http(method, path, body=None):
            calls.append((method,path,body))
            if 'image_observations?' in path: return copy.deepcopy(saved)
            if 'vehicle_images?' in path:
                return [dict(id=r['image_id'], is_sensitive=private, sensitive_type=None,
                             vision_gate_status='approved', image_url='storage-url') for r in readings]
            if path.endswith('/ingest_image_observation'):
                stored = {k.removeprefix('p_'):v for k,v in copy.deepcopy(body).items()}
                stored['id'] = '30000000-0000-0000-0000-00000000000' + stored['image_id'][-1]
                if corrupt: corrupt(stored)
                saved.append(stored)
                return returned_id or stored['id']
            return 1
        with tempfile.TemporaryDirectory() as tmp:
            inp=pathlib.Path(tmp)/'readings.jsonl'; manifest=pathlib.Path(tmp)/'manifest.jsonl'
            readings = [self.reading()] if row is None else row if isinstance(row, list) else [row]
            inp.write_text(''.join(json.dumps(r)+'\n' for r in readings))
            manifest.write_text(''.join(json.dumps({'image_id':r['image_id'], 'filed_vehicle_id':'untrusted-filing'})+'\n' for r in readings))
            args=['producer','--in',str(inp),'--manifest',str(manifest),'--model','test-model',
                  '--session','test-session','--run-id',RUN,*extra]
            output = io.StringIO()
            self.calls = calls
            with patch.object(sys,'argv',args), patch.object(producer,'http',http), \
                 patch.object(producer,'git_commit',return_value='test-commit'),contextlib.redirect_stdout(output):
                producer.main()
            self.output = json.loads(output.getvalue())
        return calls

    def saved_reading(self):
        self.run_cli()
        payload = next(body for method,path,body in self.calls if method == 'POST')
        return {**{k.removeprefix('p_'):v for k,v in payload.items()},
                'id':'30000000-0000-0000-0000-000000000001'}

    def test_exact_retry_verifies_existing_reading_without_writing(self):
        saved = self.saved_reading()
        # A prior producer commit remains valid provenance for an unchanged retry.
        saved['confidence_basis'][producer.OBSERVER]['code_commit'] = 'prior-commit'
        self.run_cli(existing=[saved])
        self.assertFalse(any(method == 'POST' for method,_,_ in self.calls))
        self.assertEqual(self.output['verified'], 1)
        self.assertEqual(self.output['written'], 0)
        self.assertEqual(self.output['observation_ids'], [saved['id']])

    def test_changed_reading_or_run_is_a_conflict_before_any_new_write(self):
        original = self.saved_reading()
        for field in ('reading', 'run_id', 'model', 'codex_session', 'confidence'):
            with self.subTest(field=field):
                saved = copy.deepcopy(original)
                sig = saved['confidence_basis'][producer.OBSERVER]
                sig[field] = {'view':'interior'} if field == 'reading' else 'different'
                second = {**self.reading(), 'image_id':'10000000-0000-0000-0000-000000000002'}
                with self.assertRaisesRegex(SystemExit, 'conflict'):
                    self.run_cli(row=[self.reading(), second], existing=[saved])
                self.assertFalse(any(method == 'POST' for method,_,_ in self.calls))

    def test_duplicate_active_rows_are_not_a_successful_retry(self):
        saved = self.saved_reading()
        with self.assertRaisesRegex(SystemExit, 'conflict'):
            self.run_cli(existing=[saved,saved])

    def test_partial_retry_only_writes_missing_reading_and_verifies_both(self):
        saved = self.saved_reading()
        second = {**self.reading(), 'image_id':'10000000-0000-0000-0000-000000000002'}
        self.run_cli(row=[self.reading(),second], existing=[saved])
        writes = [body for method,_,body in self.calls if method == 'POST']
        self.assertEqual([body['p_image_id'] for body in writes], [second['image_id']])
        self.assertEqual(self.output['verified'], 2)
        self.assertEqual(self.output['written'], 1)
        self.assertEqual(self.output['already_present'], 1)

    def test_other_role_vehicle_or_run_marker_is_rejected(self):
        original = self.saved_reading()
        for update in ({'role':'primary'}, {'vehicle_id':IMAGE}, {'layer_version':{'run_id':'other'}}):
            with self.subTest(update=update):
                with self.assertRaisesRegex(SystemExit, 'conflict'):
                    self.run_cli(existing=[{**original,**update}])
                self.assertFalse(any(method == 'POST' for method,_,_ in self.calls))

    def test_rpc_success_with_different_persisted_reading_is_not_success(self):
        def corrupt(row):
            row['confidence_basis'][producer.OBSERVER]['reading']['view'] = 'interior'
        with self.assertRaisesRegex(SystemExit, 'admission unverified'):
            self.run_cli(corrupt=corrupt)

    def test_wrong_returned_id_is_not_success(self):
        with self.assertRaisesRegex(SystemExit, 'admission unverified'):
            self.run_cli(returned_id='different-id')

    def test_missing_persisted_row_is_not_success(self):
        with patch.object(producer, 'active_readings', return_value=[]):
            with self.assertRaisesRegex(SystemExit, 'admission unverified'):
                self.run_cli()

    def test_manifest_membership_does_not_allow_filter_injection(self):
        r = {**self.reading(), 'image_id':'bad),observed_by.eq.other'}
        with self.assertRaisesRegex(SystemExit, 'canonical UUID'):
            self.run_cli(row=r)
        self.assertEqual(self.calls, [])

    def test_uses_rpc_without_filing_and_retains_provenance(self):
        calls=self.run_cli()
        writes=[x for x in calls if x[0]=='POST']
        self.assertEqual(len(writes),1)
        _,path,payload=writes[0]
        self.assertEqual(path,'/rest/v1/rpc/ingest_image_observation')
        self.assertIsNone(payload['p_vehicle_id'])
        self.assertEqual(payload['p_role'],'incidental')
        sig=payload['p_confidence_basis'][producer.OBSERVER]
        self.assertEqual(sig['run_id'],RUN)
        self.assertEqual(sig['model'],'test-model')
        self.assertEqual(sig['reading']['category'],'unknown')
        self.assertEqual(sig['reading']['filed_vehicle_id_at_read'],'untrusted-filing')

    def test_current_privacy_prevents_all_writes(self):
        with self.assertRaisesRegex(SystemExit,'privacy/source'): self.run_cli(private=True)

    def test_dry_run_has_no_network(self):
        self.assertEqual(self.run_cli(extra=['--dry-run']),[])

    def test_revert_uses_bounded_run_rpc(self):
        calls=self.run_cli(extra=['--revert'])
        self.assertEqual(calls,[('POST','/rest/v1/rpc/revert_codex_image_analysis_batch',
                                {'p_run_id':RUN,'p_image_ids':[IMAGE]})])

    def test_invalid_probabilities_rejected(self):
        for value in [True,float('nan'),1.1,-.1]:
            r=self.reading();r['p_vehicle']=value
            self.assertIn('p_vehicle',producer.validate(r,{IMAGE:{}}))

    def test_invalid_batch_is_not_partially_written(self):
        r=self.reading();r['view']='invented'
        with self.assertRaises(SystemExit):self.run_cli(row=r)

if __name__=='__main__': unittest.main()

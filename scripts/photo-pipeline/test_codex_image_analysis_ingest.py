import contextlib
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

    def run_cli(self, row=None, extra=(), private=False):
        calls = []
        def http(method, path, body=None):
            calls.append((method,path,body))
            if 'image_observations?' in path: return []
            if 'vehicle_images?' in path:
                return [dict(id=IMAGE, is_sensitive=private, sensitive_type=None,
                             vision_gate_status='approved', image_url='storage-url')]
            return '30000000-0000-0000-0000-000000000001'
        with tempfile.TemporaryDirectory() as tmp:
            inp=pathlib.Path(tmp)/'readings.jsonl'; manifest=pathlib.Path(tmp)/'manifest.jsonl'
            inp.write_text(json.dumps(self.reading() if row is None else row)+'\n')
            manifest.write_text(json.dumps({'image_id':IMAGE, 'filed_vehicle_id':'untrusted-filing'})+'\n')
            args=['producer','--in',str(inp),'--manifest',str(manifest),'--model','test-model',
                  '--session','test-session','--run-id',RUN,*extra]
            with patch.object(sys,'argv',args), patch.object(producer,'http',http), \
                 patch.object(producer,'git_commit',return_value='test-commit'),contextlib.redirect_stdout(io.StringIO()):
                producer.main()
        return calls

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

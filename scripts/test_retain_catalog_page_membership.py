import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PATH=Path(__file__).with_name('retain-catalog-page-membership.py')
spec=importlib.util.spec_from_file_location('catalog_page_client',PATH)
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


class ClientContract(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();p=Path(self.tmp.name)
  self.full=p/'full.pdf';self.full.write_bytes(b'%PDF-full fixture')
  self.page=p/'page.pdf';self.page.write_bytes(b'%PDF-page fixture')
  h=lambda x:hashlib.sha256(x.read_bytes()).hexdigest()
  self.full_hash=h(self.full);self.page_hash=h(self.page)
  self.doc='10000000-0000-4000-8000-000000000011';self.page_id='20000000-0000-4000-8000-000000000011'
  self.url='https://example.test/suv/0011.pdf';self.geom='7'*64;self.render='8'*64
  visual={'source_page':1,'individual_pdf_sha256':self.page_hash,'full_pdf_sha256':self.full_hash,
    'normalized_layout_text_equal':True,'render_dpi':72,'render_png_equal':True,
    'full_render_sha256':self.render,'individual_render_sha256':self.render}
  word={'full_pdf_sha256':self.full_hash,'pages':1,'comparisons':[{'source_page':1,'source_url':self.url,
    'pdf_sha256':self.page_hash,'geometry_and_words_equal':True,'full_page_geometry_sha256':self.geom,
    'individual_page_geometry_sha256':self.geom}]}
  self.visual=p/'visual.json';self.visual.write_text(json.dumps(visual));self.word=p/'words.json';self.word.write_text(json.dumps(word))
  self.catalog={'name':'SUV fixture','provider':'LMC','base_url':'https://example.test/suv/full.pdf',
    'full_pdf_sha256':self.full_hash,'expected_page_count':1,'reader_actor':'test','reader_run_id':'fixed',
    'reader_verified_at':'2026-01-01T00:00:00Z'}
  self.manifest={'catalog':self.catalog,'full_pdf_path':str(self.full),'word_comparisons_path':str(self.word),
    'pages':[{'catalog_page_number':1,'document_id':self.doc,'local_pdf':str(self.page),
              'render_comparison_path':str(self.visual),'source_url':self.url}]}
  self.manifest_file=p/'manifest.json';self.manifest_file.write_text(json.dumps(self.manifest))
  self.requests=[]
 def tearDown(self):self.tmp.cleanup()
 def service(self,url,key,*,method='GET',body=None):
  self.requests.append((url,method,body))
  if '/reference_documents?' in url:return [{'id':self.doc,'file_hash':self.page_hash,'source_url':self.url,
    'source_capture':{'schema':'attested_pdf_text_v1'},'superseded_by':None,'page_count':1,'category':'parts_catalog'}]
  if '/document_pages?' in url:return [{'id':self.page_id,'document_id':self.doc,'page_number':1}]
  if method=='POST':return {'success':True,'source_membership_only':True,'pages_submitted':1,'catalog_id':self.doc,
    'inserted':1,'replayed':0,'mapping_status':'client_attested_not_server_reextracted'}
  raise AssertionError(url)
 def run_main(self,execute=False):
  args=['client',str(self.manifest_file)]+(['--execute'] if execute else [])
  with patch.object(sys,'argv',args),patch.dict(os.environ,{'VITE_SUPABASE_URL':'https://project.supabase.co',
       'SUPABASE_SERVICE_ROLE_KEY':'sb_secret_fixture'}),patch.object(client,'digest_publisher',return_value=self.full_hash),\
       patch.object(client,'service_json',side_effect=self.service),contextlib.redirect_stdout(io.StringIO()) as out:
   client.main();return json.loads(out.getvalue())
 def test_default_reads_metadata_but_never_posts(self):
  result=self.run_main();self.assertEqual(result['status'],'verified_no_write')
  self.assertEqual([x[1] for x in self.requests],['GET','GET'])
 def test_execute_sends_only_validated_membership(self):
  result=self.run_main(True);self.assertTrue(result['success'])
  body=self.requests[-1][2];self.assertEqual(body['mode'],'catalog_page_membership')
  self.assertEqual(body['pages'][0]['document_page_id'],self.page_id)
  self.assertNotIn('source_url',body['pages'][0]);self.assertEqual(len(self.requests),3)
 def test_local_source_or_comparison_change_holds(self):
  self.page.write_bytes(b'%PDF-changed')
  with self.assertRaisesRegex(RuntimeError,'comparison differs'):client.prepare(self.manifest)
  self.page.write_bytes(b'%PDF-page fixture')
  visual=json.loads(self.visual.read_text());visual['individual_render_sha256']='f'*64;self.visual.write_text(json.dumps(visual))
  with self.assertRaisesRegex(RuntimeError,'hashes differ'):client.prepare(self.manifest)
 def test_duplicate_document_or_page_holds(self):
  self.catalog['expected_page_count']=2
  word=json.loads(self.word.read_text());word['pages']=2
  word['comparisons'].append({**word['comparisons'][0],'source_page':2})
  self.word.write_text(json.dumps(word))
  self.manifest['pages'].append(dict(self.manifest['pages'][0]))
  with self.assertRaisesRegex(RuntimeError,'Duplicate or invalid source page'):client.prepare(self.manifest)
 def test_mismatched_retained_source_holds(self):
  _,pages=client.prepare(self.manifest)
  def wrong(url,key,**kw):
   rows=self.service(url,key,**kw)
   if '/reference_documents?' in url:rows[0]['file_hash']='f'*64
   return rows
  with patch.object(client,'service_json',side_effect=wrong):
   with self.assertRaisesRegex(RuntimeError,'metadata differs'):client.fetch_metadata('https://project.supabase.co','sb_secret_fixture',pages)
 def test_service_credentials_do_not_follow_redirect(self):
  self.assertIsNone(client.NoRedirect().redirect_request(None,None,302,'moved',{},'https://elsewhere.test/'))

if __name__=='__main__':unittest.main()

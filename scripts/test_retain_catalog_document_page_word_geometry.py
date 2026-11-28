import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('whole_geometry',Path(__file__).with_name('retain-catalog-document-page-word-geometry.py'))
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


class Contract(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  pdf=self.root/'source.pdf';pdf.write_bytes(b'%PDF-synthetic');sha=hashlib.sha256(pdf.read_bytes()).hexdigest()
  self.source={'catalog_id':'30000000-0000-4000-8000-000000000001','local_pdf':str(pdf),'expected_pdf_sha256':sha,
   'object_id':'00000000-0000-4000-8000-000000000001','object_version':'v1','object_name':'test/catalog.pdf'}
  self.run={'document_id':'10000000-0000-4000-8000-000000000001',
   'reader':{'actor':'agent:test','run_id':'fixed-run','verified_at':'2026-01-01T00:00:00Z'}}
  self.geometry=json.dumps({'width':'100','height':'200','words':[['1','2','3','4','word']]},separators=(',',':'))
  raw=self.geometry.encode();(self.root/'0001.geometry.json').write_bytes(raw)
  self.summary={'source_pdf_sha256':sha,'extractor_version':'pdftotext fixture','fresh_bbox_sha256':'a'*64,
   'prior_bbox_sha256':'a'*64,'pages':1,'words':1,'status':'local_preparation_not_database_admission',
   'page_results':[{'page':1,'words':1,'geometry_sha256':hashlib.sha256(raw).hexdigest()}]}
  (self.root/'geometry-summary.json').write_text(json.dumps(self.summary))
  self.page_id='20000000-0000-4000-8000-000000000001';self.calls=[];self.revision='b'*64
 def tearDown(self):self.tmp.cleanup()
 def service(self,url,key,*,method='GET',body=None):
  self.calls.append((url,method,body))
  if '/reference_documents?' in url:return [{'id':self.run['document_id'],'file_hash':self.source['expected_pdf_sha256'],'page_count':1,
   'source_capture':{'schema':'catalog_text_source_v1','catalog_id':self.source['catalog_id'],'revision':self.revision,
    'storage_object_id':self.source['object_id'],'storage_version':'v1','storage_name':self.source['object_name']}}]
  if '/rpc/catalog_text_source_evidence' in url:return {'document_id':self.run['document_id'],'catalog_id':self.source['catalog_id'],
   'pdf_sha256_attestation':self.source['expected_pdf_sha256'],'page_count':1,'revision':self.revision,
   'pdf_hash_status':'client_attested_not_server_rehashed'}
  if '/document_pages?' in url:return [{'id':self.page_id,'document_id':self.run['document_id'],'page_number':1}]
  if '/functions/v1/index-reference-document' in url:return {'success':True,'source_geometry_only':True,'model_calls':0,
   'extraction_id':'40000000-0000-4000-8000-000000000001','page_id':self.page_id,'word_count':1,'duplicate':False,
   'extractor_version':'pdftotext fixture','geometry_status':'client_attested_not_server_reextracted'}
  raise AssertionError(url)
 def test_prepares_all_local_geometry_and_detects_drift(self):
  pages,version=client.prepare(self.source,self.run,self.root)
  self.assertEqual((len(pages),pages[0]['word_count'],version),(1,1,'pdftotext fixture'))
  (self.root/'0001.geometry.json').write_text(self.geometry+' ')
  with self.assertRaisesRegex(RuntimeError,'geometry differs'):client.prepare(self.source,self.run,self.root)
 def test_source_qualification_detects_wrong_object(self):
  pages,_=client.prepare(self.source,self.run,self.root)
  with patch.object(client.membership,'service_json',side_effect=self.service):
   self.assertEqual(client.qualified_pages('https://p.supabase.co','sb_secret_test',self.source,self.run,pages)['revision'],self.revision)
   self.assertEqual(pages[0]['page_id'],self.page_id)
   with self.assertRaisesRegex(RuntimeError,'object identity'):client.qualified_pages('https://p.supabase.co','sb_secret_test',dict(self.source,object_version='changed'),self.run,pages)
 def test_document_pages_fetch_past_api_cap(self):
  pages=[{'page':n} for n in range(1,1003)];offsets=[]
  def service(url,key,**kw):
   if '/reference_documents?' in url:
    result=self.service(url,key,**kw);result[0]['page_count']=1002;return result
   if '/rpc/catalog_text_source_evidence' in url:
    result=self.service(url,key,**kw);result['page_count']=1002;return result
   query=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query);self.assertEqual(query['order'],['page_number.asc'])
   offset=int(query['offset'][0]);offsets.append(offset)
   return [{'id':f'20000000-0000-4000-8000-{n:012d}','document_id':self.run['document_id'],'page_number':n}
    for n in range(offset+1,min(offset+501,1003))]
  with patch.object(client.membership,'service_json',side_effect=service):
   client.qualified_pages('https://p.supabase.co','sb_secret_test',self.source,self.run,pages)
  self.assertEqual(offsets,[0,500,1000]);self.assertEqual(pages[-1]['page_id'],'20000000-0000-4000-8000-000000001002')
 def test_default_is_read_only_and_execute_calls_protected_mode(self):
  source=self.root/'source.json';source.write_text(json.dumps(self.source));run=self.root/'run.json';run.write_text(json.dumps(self.run))
  def run_client(execute):
   args=['client',str(source),str(run),'--geometry-dir',str(self.root)]+(['--execute'] if execute else [])
   with patch.object(sys,'argv',args),patch.dict(os.environ,{'VITE_SUPABASE_URL':'https://p.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY':'sb_secret_test'}),patch.object(client.membership,'service_json',side_effect=self.service),\
    contextlib.redirect_stdout(io.StringIO()) as out:
    client.main();return json.loads(out.getvalue())
  self.assertEqual(run_client(False)['status'],'qualified_source_and_local_geometry_no_write')
  self.assertFalse(any('/functions/v1/' in url for url,_,_ in self.calls))
  self.calls.clear();self.assertTrue(run_client(True)['success'])
  self.assertEqual(self.calls[-1][2]['mode'],'catalog_document_page_word_geometry')
  self.assertEqual(self.calls[-1][2]['reader'],self.run['reader'])


if __name__=='__main__':unittest.main()

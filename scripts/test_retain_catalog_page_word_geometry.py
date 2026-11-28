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

spec=importlib.util.spec_from_file_location('word_geometry_client',Path(__file__).with_name('retain-catalog-page-word-geometry.py'))
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


class Contract(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.geometry=json.dumps({'width':'100','height':'200','words':[['1','2','3','4','word']]},separators=(',',':'))
  (self.root/'0001.geometry.json').write_text(self.geometry)
  self.geo_hash=hashlib.sha256(self.geometry.encode()).hexdigest()
  self.word_comparisons=self.root/'words.json';self.word_comparisons.write_text(json.dumps({'extractor_version':'pdftotext version fixture'}))
  self.catalog={'name':'Fixture SUV','provider':'LMC','base_url':'https://example.test/full.pdf','full_pdf_sha256':'f'*64}
  self.catalog_id='30000000-0000-4000-8000-000000000001'
  self.doc='10000000-0000-4000-8000-000000000001';self.page_id='20000000-0000-4000-8000-000000000001'
  self.source={'catalog_page_number':1,'document_id':self.doc,'pdf_sha256':'a'*64,'full_geometry_sha256':self.geo_hash}
  self.item={'source':dict(self.source),'geometry':self.geometry,'word_count':1}
  self.requests=[]
 def tearDown(self):self.tmp.cleanup()
 def service(self,url,key,*,method='GET',body=None):
  self.requests.append((url,method,body))
  if '/catalog_sources?' in url:return [{'id':self.catalog_id,'name':self.catalog['name'],'provider':'LMC','base_url':self.catalog['base_url']}]
  if '/catalog_reference_documents?' in url:return [{'catalog_page_number':1,'reference_document_id':self.doc,
   'document_page_id':self.page_id,'page_mapping_receipt':{'full_pdf_sha256':'f'*64,
   'word_geometry_sha256':self.geo_hash,'source_pdf_sha256':'a'*64}}]
  if method=='POST':return {'success':True,'source_geometry_only':True,'model_calls':0,'page_id':self.page_id,
   'extraction_id':'40000000-0000-4000-8000-000000000001','word_count':1,'duplicate':False,'extractor_version':'pdftotext version fixture',
   'geometry_status':'client_attested_not_server_reextracted'}
  raise AssertionError(url)
 def test_geometry_matches_prior_comparison(self):
  with patch.object(client.membership,'prepare',return_value=(self.catalog,[self.source])):
   _,items,version=client.prepare({'word_comparisons_path':str(self.word_comparisons)},self.root);self.assertEqual(items[0]['word_count'],1)
   self.assertEqual(version,'pdftotext version fixture')
   (self.root/'0001.geometry.json').write_text(self.geometry+' ')
   with self.assertRaisesRegex(RuntimeError,'geometry differs'):client.prepare({'word_comparisons_path':str(self.word_comparisons)},self.root)
 def test_catalog_link_metadata_and_duplicate_holds(self):
  with patch.object(client.membership,'service_json',side_effect=self.service):
   pages=[dict(self.item)];self.assertEqual(client.retained_links('https://p.supabase.co','sb_secret_test',self.catalog,pages),self.catalog_id)
   self.assertEqual(pages[0]['document_page_id'],self.page_id)
  def duplicate(url,key,**kw):
   rows=self.service(url,key,**kw)
   return rows+rows if '/catalog_reference_documents?' in url else rows
  with patch.object(client.membership,'service_json',side_effect=duplicate):
   with self.assertRaisesRegex(RuntimeError,'Duplicate catalog page'):client.retained_links('https://p.supabase.co','sb_secret_test',self.catalog,[dict(self.item)])
 def test_catalog_links_page_past_api_cap_and_hold_cross_batch_duplicates(self):
  rows=[]
  for n in range(1,1003):
   rows.append({'catalog_page_number':n,'reference_document_id':f'10000000-0000-4000-8000-{n:012d}',
    'document_page_id':f'20000000-0000-4000-8000-{n:012d}',
    'page_mapping_receipt':{'full_pdf_sha256':'f'*64,'word_geometry_sha256':self.geo_hash,'source_pdf_sha256':'a'*64}})
  selected={'source':dict(self.source,catalog_page_number=1002,document_id=rows[-1]['reference_document_id']),
            'geometry':self.geometry,'word_count':1}
  offsets=[]
  def paginated(url,key,**kw):
   if '/catalog_sources?' in url:return self.service(url,key,**kw)
   query=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
   self.assertEqual(query['page_mapping_receipt->>full_pdf_sha256'],['eq.'+'f'*64])
   self.assertEqual(query['order'],['reference_document_id.asc'])
   self.assertEqual(query['limit'],['500'])
   start=int(query['offset'][0]);offsets.append(start)
   return rows[start:start+500]
  with patch.object(client.membership,'service_json',side_effect=paginated):
   pages=[dict(selected)];self.assertEqual(client.retained_links('https://p.supabase.co','sb_secret_test',self.catalog,pages),self.catalog_id)
   self.assertEqual(pages[0]['document_page_id'],rows[-1]['document_page_id'])
   self.assertEqual(offsets,[0,500,1000])
   rows[1000]['catalog_page_number']=1
   with self.assertRaisesRegex(RuntimeError,'Duplicate catalog page'):
    client.retained_links('https://p.supabase.co','sb_secret_test',self.catalog,[dict(selected)])
 def test_default_is_read_only_and_execute_uses_protected_mode(self):
  manifest=self.root/'manifest.json';manifest.write_text('{}')
  def run(execute):
   args=['client',str(manifest),'--geometry-dir',str(self.root)]+(['--execute'] if execute else [])
   with patch.object(sys,'argv',args),patch.dict(os.environ,{'VITE_SUPABASE_URL':'https://p.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY':'sb_secret_test'}),patch.object(client,'prepare',return_value=(self.catalog,[dict(self.item)],'pdftotext version fixture')),\
        patch.object(client.membership,'service_json',side_effect=self.service),contextlib.redirect_stdout(io.StringIO()) as output:
    client.main();return json.loads(output.getvalue())
  self.assertEqual(run(False)['status'],'verified_local_and_link_metadata_no_write')
  self.assertEqual([m for _,m,_ in self.requests],['GET','GET'])
  self.requests.clear();self.assertTrue(run(True)['success'])
  self.assertEqual([m for _,m,_ in self.requests],['GET','GET','POST'])
  self.assertEqual(self.requests[-1][2]['mode'],'catalog_page_word_geometry')
  self.assertEqual(self.requests[-1][2]['geometry'],self.geometry)


if __name__=='__main__':unittest.main()

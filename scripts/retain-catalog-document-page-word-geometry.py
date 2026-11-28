#!/usr/bin/env python3
"""Preflight or retain keyed word geometry for a whole catalog document.

Requires a previously retained and qualified public catalog document. Local
PDF and per-page geometry fingerprints are client-attested; the database does
not independently parse the PDF. The default is read-only, and --execute sends
one transactional, replay-safe page at a time. No model or part claim is made.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import urllib.parse
from pathlib import Path

_spec=importlib.util.spec_from_file_location('catalog_membership_client',Path(__file__).with_name('retain-catalog-page-membership.py'))
assert _spec and _spec.loader
membership=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(membership)


def prepare(source,run,geometry_dir):
    membership.require(isinstance(source,dict) and isinstance(run,dict) and set(run)=={'document_id','reader'},'Invalid source or run manifest')
    doc=run['document_id'];reader=run['reader'];sha=source.get('expected_pdf_sha256')
    membership.require(isinstance(doc,str) and membership.UUID.fullmatch(doc) is not None
      and isinstance(sha,str) and membership.HASH.fullmatch(sha) is not None
      and isinstance(source.get('catalog_id'),str) and membership.UUID.fullmatch(source['catalog_id']) is not None
      and isinstance(reader,dict) and set(reader)=={'actor','run_id','verified_at'},'Invalid source identity or attribution')
    for k,limit in [('actor',100),('run_id',150)]:
        v=reader[k];membership.require(isinstance(v,str) and 1<=len(v)<=limit and v==v.strip()
          and all(32<=ord(c)<=126 for c in v),'Invalid reader attribution')
    membership.require(isinstance(reader['verified_at'],str)
      and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})',reader['verified_at']) is not None,
      'Invalid reader timestamp')
    pdf=Path(source['local_pdf']).expanduser()
    membership.require(membership.digest(pdf)==sha,'Local PDF hash differs from retained source')
    summary=json.loads((geometry_dir/'geometry-summary.json').read_text())
    count=summary.get('pages');version=summary.get('extractor_version')
    membership.require(summary.get('status')=='local_preparation_not_database_admission'
      and summary.get('source_pdf_sha256')==sha and isinstance(count,int) and not isinstance(count,bool) and 1<=count<=5000
      and isinstance(version,str) and 1<=len(version)<=200 and version==version.strip()
      and isinstance(summary.get('fresh_bbox_sha256'),str) and membership.HASH.fullmatch(summary['fresh_bbox_sha256']) is not None
      and summary['fresh_bbox_sha256']==summary.get('prior_bbox_sha256'),'Local geometry comparison differs')
    rows=summary.get('page_results')
    membership.require(isinstance(rows,list) and len(rows)==count,'Local geometry page count differs')
    by_page={}
    for row in rows:
        membership.require(isinstance(row,dict) and isinstance(row.get('page'),int) and not isinstance(row['page'],bool)
          and row['page'] not in by_page,'Invalid or duplicate local geometry page')
        by_page[row['page']]=row
    membership.require(set(by_page)==set(range(1,count+1)),'Local geometry page sequence differs')
    pages=[]
    for page,row in sorted(by_page.items()):
        raw=(geometry_dir/f'{page:04}.geometry.json').read_bytes()
        membership.require(len(raw)<=1048576 and hashlib.sha256(raw).hexdigest()==row.get('geometry_sha256'),
          f'Local geometry differs on page {page}')
        geometry=json.loads(raw)
        membership.require(isinstance(geometry,dict) and set(geometry)=={'width','height','words'}
          and isinstance(geometry['width'],str) and isinstance(geometry['height'],str) and isinstance(geometry['words'],list)
          and len(geometry['words'])<=5000 and len(geometry['words'])==row.get('words'),f'Local geometry shape differs on page {page}')
        pages.append({'page':page,'geometry':raw.decode('utf-8'),'word_count':len(geometry['words'])})
    membership.require(sum(x['word_count'] for x in pages)==summary.get('words') and membership.digest(pdf)==sha,
      'Local source or word total changed during preparation')
    return pages,version


def qualified_pages(origin,key,source,run,pages):
    params=urllib.parse.urlencode({'select':'id,file_hash,page_count,source_capture','id':'eq.'+run['document_id']})
    docs=membership.service_json(origin+'/rest/v1/reference_documents?'+params,key)
    membership.require(isinstance(docs,list) and len(docs)==1 and docs[0].get('id')==run['document_id']
      and docs[0].get('file_hash')==source['expected_pdf_sha256'] and docs[0].get('page_count')==len(pages)
      and isinstance(docs[0].get('source_capture'),dict),'Retained catalog document differs')
    captured=docs[0]['source_capture']
    membership.require(captured.get('schema')=='catalog_text_source_v1' and captured.get('catalog_id')==source['catalog_id']
      and captured.get('storage_object_id')==source.get('object_id') and captured.get('storage_version')==source.get('object_version')
      and captured.get('storage_name')==source.get('object_name'),'Retained object identity or version differs')
    evidence=membership.service_json(origin+'/rest/v1/rpc/catalog_text_source_evidence',key,method='POST',
                                     body={'p_document_id':run['document_id']})
    membership.require(isinstance(evidence,dict) and evidence.get('document_id')==run['document_id']
      and evidence.get('catalog_id')==source['catalog_id'] and evidence.get('pdf_sha256_attestation')==source['expected_pdf_sha256']
      and evidence.get('page_count')==len(pages) and evidence.get('pdf_hash_status')=='client_attested_not_server_rehashed'
      and isinstance(evidence.get('revision'),str) and membership.HASH.fullmatch(evidence['revision']) is not None
      and evidence['revision']==captured.get('revision'),
      'Retained catalog source does not qualify')
    offset=0;batch=500;by_page={}
    while True:
        params=urllib.parse.urlencode({'select':'id,document_id,page_number','document_id':'eq.'+run['document_id'],
                                       'order':'page_number.asc','limit':str(batch),'offset':str(offset)})
        rows=membership.service_json(origin+'/rest/v1/document_pages?'+params,key)
        membership.require(isinstance(rows,list) and len(rows)<=batch,'Unexpected retained page list')
        for row in rows:
            n=row.get('page_number');pid=row.get('id')
            membership.require(isinstance(n,int) and not isinstance(n,bool) and 1<=n<=len(pages) and n not in by_page
              and row.get('document_id')==run['document_id'] and isinstance(pid,str) and membership.UUID.fullmatch(pid) is not None,
              'Invalid or duplicate retained document page')
            by_page[n]=pid
        if len(rows)<batch:break
        offset+=len(rows)
    membership.require(set(by_page)==set(range(1,len(pages)+1)),'Retained document pages are incomplete')
    for page in pages:page['page_id']=by_page[page['page']]
    return evidence


def main():
    parser=argparse.ArgumentParser();parser.add_argument('source_manifest',type=Path);parser.add_argument('run_manifest',type=Path)
    parser.add_argument('--geometry-dir',type=Path,required=True);parser.add_argument('--page',type=int)
    parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    source=json.loads(args.source_manifest.read_text());run=json.loads(args.run_manifest.read_text())
    pages,version=prepare(source,run,args.geometry_dir)
    origin=os.environ.get('VITE_SUPABASE_URL','').rstrip('/');u=urllib.parse.urlsplit(origin)
    membership.require(u.scheme=='https' and re.fullmatch(r'[a-z0-9-]+\.supabase\.co',u.netloc or '')
      and not u.path and not u.query and not u.fragment,'Invalid configured project URL')
    key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','');membership.require(key.startswith('sb_secret_'),'Use the configured dotenvx service environment')
    evidence=qualified_pages(origin,key,source,run,pages)
    selected=[x for x in pages if args.page is None or x['page']==args.page]
    membership.require(bool(selected) and (args.page is None or len(selected)==1),'Requested page not found')
    if not args.execute:
        print(json.dumps({'status':'qualified_source_and_local_geometry_no_write','pages':len(selected),
          'words':sum(x['word_count'] for x in selected),'source_revision':evidence['revision'],
          'extractor_version':version,'model_calls':0}));return
    inserted=replayed=words=0
    for item in selected:
        result=membership.service_json(origin+'/functions/v1/index-reference-document',key,method='POST',body={
          'mode':'catalog_document_page_word_geometry','catalog_id':source['catalog_id'],'document_id':run['document_id'],
          'catalog_page_number':item['page'],'pdf_sha256':source['expected_pdf_sha256'],'geometry':item['geometry'],
          'extractor_version':version,'reader':run['reader']})
        membership.require(isinstance(result,dict) and result.get('success') is True and result.get('source_geometry_only') is True
          and result.get('model_calls')==0 and result.get('page_id')==item['page_id'] and result.get('word_count')==item['word_count']
          and isinstance(result.get('extraction_id'),str) and membership.UUID.fullmatch(result['extraction_id']) is not None
          and isinstance(result.get('duplicate'),bool) and result.get('extractor_version')==version
          and result.get('geometry_status')=='client_attested_not_server_reextracted',f'Unexpected geometry receipt on page {item["page"]}')
        replayed+=int(result['duplicate']);inserted+=int(not result['duplicate']);words+=item['word_count']
        if len(selected)>1 and (inserted+replayed)%20==0:
            print(json.dumps({'processed':inserted+replayed,'pages':len(selected),'inserted':inserted,'replayed':replayed}),flush=True)
    print(json.dumps({'success':True,'pages':len(selected),'words':words,'inserted':inserted,'replayed':replayed,
      'geometry_status':'client_attested_not_server_reextracted','model_calls':0}))


if __name__=='__main__':main()

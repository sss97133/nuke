#!/usr/bin/env python3
"""Verify and optionally key client-attested word geometry for retained pages.

Default is a no-write preflight. --execute calls the existing protected
index-reference-document source owner once per page. Each page is independently
transactional and replay-safe; a stopped run can be repeated without replacing
existing testimony. No listing, fitment, vehicle or model call is made.
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
membership=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(membership)


def prepare(manifest,geometry_dir):
    catalog,pages=membership.prepare(manifest)
    comparisons=json.loads(Path(manifest['word_comparisons_path']).expanduser().read_text())
    version=comparisons.get('extractor_version')
    membership.require(isinstance(version,str) and 1<=len(version)<=200 and version==version.strip()
      and not any(ord(ch)<32 or ord(ch)==127 for ch in version),'Invalid client-attested extractor version')
    output=[]
    for item in pages:
        page=item['catalog_page_number']
        raw=(geometry_dir/f'{page:04}.geometry.json').read_bytes()
        membership.require(len(raw)<=1048576 and hashlib.sha256(raw).hexdigest()==item['full_geometry_sha256'],
                           f'Local word geometry differs on page {page}')
        geometry=json.loads(raw)
        membership.require(isinstance(geometry,dict) and set(geometry)=={'width','height','words'}
          and isinstance(geometry['width'],str) and isinstance(geometry['height'],str)
          and isinstance(geometry['words'],list) and len(geometry['words'])<=5000,
          f'Local geometry shape differs on page {page}')
        output.append({'source':item,'geometry':raw.decode('utf-8'),'word_count':len(geometry['words'])})
    return catalog,output,version


def retained_links(origin,key,catalog,pages):
    params=urllib.parse.urlencode({'select':'id,name,provider,base_url','provider':'eq.'+catalog['provider'],
                                   'base_url':'eq.'+catalog['base_url']})
    catalogs=membership.service_json(origin+'/rest/v1/catalog_sources?'+params,key)
    membership.require(isinstance(catalogs,list) and len(catalogs)==1 and catalogs[0].get('name')==catalog['name']
      and isinstance(catalogs[0].get('id'),str) and membership.UUID.fullmatch(catalogs[0]['id']) is not None,
      'Catalog source identity differs or is ambiguous')
    catalog_id=catalogs[0]['id']
    params=urllib.parse.urlencode({'select':'catalog_page_number,reference_document_id,document_page_id,page_mapping_receipt',
                                  'catalog_id':'eq.'+catalog_id,'limit':'5000'})
    links=membership.service_json(origin+'/rest/v1/catalog_reference_documents?'+params,key)
    membership.require(isinstance(links,list),'Unexpected catalog source links')
    edition=catalog['full_pdf_sha256'];by_page={}
    for link in links:
        receipt=link.get('page_mapping_receipt')
        if not isinstance(receipt,dict) or receipt.get('full_pdf_sha256')!=edition:
            continue
        page=link.get('catalog_page_number')
        membership.require(isinstance(page,int) and not isinstance(page,bool) and page not in by_page,'Duplicate catalog page links')
        by_page[page]=link
    for item in pages:
        source=item['source'];page=source['catalog_page_number'];link=by_page.get(page)
        membership.require(isinstance(link,dict) and link.get('reference_document_id')==source['document_id']
          and isinstance(link.get('document_page_id'),str) and membership.UUID.fullmatch(link['document_page_id']) is not None
          and link['page_mapping_receipt'].get('word_geometry_sha256')==source['full_geometry_sha256']
          and link['page_mapping_receipt'].get('source_pdf_sha256')==source['pdf_sha256'],
          f'Retained catalog-page metadata differs on page {page}')
        item['document_page_id']=link['document_page_id']
    return catalog_id


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--geometry-dir',type=Path,required=True)
    parser.add_argument('--page',type=int,help='Limit this run to one catalog page')
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args()
    catalog,all_pages,version=prepare(json.loads(args.manifest.read_text()),args.geometry_dir)
    selected=[x for x in all_pages if args.page is None or x['source']['catalog_page_number']==args.page]
    membership.require(bool(selected) and (args.page is None or len(selected)==1),'Requested page is not in the verified manifest')
    origin=os.environ.get('VITE_SUPABASE_URL','').rstrip('/');u=urllib.parse.urlsplit(origin)
    membership.require(u.scheme=='https' and re.fullmatch(r'[a-z0-9-]+\.supabase\.co',u.netloc or '')
      and not u.path and not u.query and not u.fragment,'Invalid configured project URL')
    key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','');membership.require(key.startswith('sb_secret_'),'Use the configured dotenvx service environment')
    catalog_id=retained_links(origin,key,catalog,selected)
    if not args.execute:
        print(json.dumps({'status':'verified_local_and_link_metadata_no_write','catalog_id':catalog_id,
          'pages':len(selected),'words':sum(x['word_count'] for x in selected),
          'extractor_version':version,'source_qualification':'writer_rechecks_on_admission','model_calls':0}));return
    inserted=replayed=words=0
    for item in selected:
        page=item['source']['catalog_page_number']
        result=membership.service_json(origin+'/functions/v1/index-reference-document',key,method='POST',
          body={'mode':'catalog_page_word_geometry','catalog_id':catalog_id,'catalog_page_number':page,
                'catalog_edition_sha256':catalog['full_pdf_sha256'],'geometry':item['geometry'],'extractor_version':version})
        membership.require(isinstance(result,dict) and result.get('success') is True
          and result.get('source_geometry_only') is True and result.get('model_calls')==0
          and result.get('page_id')==item['document_page_id'] and result.get('word_count')==item['word_count']
          and isinstance(result.get('extraction_id'),str) and membership.UUID.fullmatch(result['extraction_id']) is not None
          and isinstance(result.get('duplicate'),bool)
          and result.get('extractor_version')==version
          and result.get('geometry_status')=='client_attested_not_server_reextracted',
          f'Unexpected word-geometry receipt on page {page}')
        replayed+=int(result['duplicate']);inserted+=int(not result['duplicate']);words+=item['word_count']
        if len(selected)>1 and (inserted+replayed)%20==0:
            print(json.dumps({'processed':inserted+replayed,'pages':len(selected),'inserted':inserted,'replayed':replayed}),flush=True)
    print(json.dumps({'success':True,'catalog_id':catalog_id,'pages':len(selected),'words':words,
      'inserted':inserted,'replayed':replayed,'geometry_status':'client_attested_not_server_reextracted','model_calls':0}))


if __name__=='__main__':
    main()

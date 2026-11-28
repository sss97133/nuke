#!/usr/bin/env python3
"""Qualify local source-page comparisons and link retained catalog pages.

Default: verify files, current publisher bytes and retained metadata only.
--execute calls the service-only catalog page membership owner. It does not
create product, applicability, assembly, vehicle or installation assertions.
The original PDF and the page comparisons remain client-attested.
"""
import argparse
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HASH=re.compile(r'^[a-f0-9]{64}$')
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',re.I)


def require(ok,message):
    if not ok: raise RuntimeError(message)


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        require(stream.read(5)==b'%PDF-','Local source is not a PDF')
        stream.seek(0)
        for block in iter(lambda:stream.read(1024*1024),b''): h.update(block)
    return h.hexdigest()


def digest_publisher(url):
    request=urllib.request.Request(url,headers={'Accept-Encoding':'identity'})
    with urllib.request.urlopen(request,timeout=120) as response:
        require(response.geturl()==url,'Publisher source redirected; inspect before continuing')
        h=hashlib.sha256()
        for block in iter(lambda:response.read(1024*1024),b''): h.update(block)
        return h.hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl): return None


def service_json(url,key,*,method='GET',body=None):
    payload=None if body is None else json.dumps(body,ensure_ascii=False).encode()
    request=urllib.request.Request(url,data=payload,method=method,
        headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=120) as response: return json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Protected source request refused HTTP {e.code}') from None


def prepare(manifest):
    require(isinstance(manifest,dict) and set(manifest)=={'catalog','full_pdf_path','word_comparisons_path','pages'},'Unexpected manifest')
    c=manifest['catalog']
    keys={'name','provider','base_url','full_pdf_sha256','expected_page_count','reader_actor','reader_run_id','reader_verified_at'}
    require(isinstance(c,dict) and set(c)==keys and isinstance(c['expected_page_count'],int) and not isinstance(c['expected_page_count'],bool)
        and 1<=c['expected_page_count']<=5000 and HASH.fullmatch(c['full_pdf_sha256']) is not None,'Invalid catalog manifest')
    url=urllib.parse.urlsplit(c['base_url'])
    require(url.scheme=='https' and url.hostname and url.path not in ('','/') and not url.username and not url.password
        and not url.query and not url.fragment,'Invalid publisher source URL')
    full=Path(manifest['full_pdf_path']).expanduser()
    require(digest(full)==c['full_pdf_sha256'],'Full PDF differs from the recorded hash')
    word=json.loads(Path(manifest['word_comparisons_path']).expanduser().read_text())
    require(word.get('full_pdf_sha256')==c['full_pdf_sha256'] and word.get('pages')==c['expected_page_count'],
        'Word comparison source differs')
    words=word.get('comparisons')
    require(isinstance(words,list) and len(words)==c['expected_page_count'],'Word comparison count differs')
    by_no={x.get('source_page'):x for x in words if isinstance(x,dict)}
    require(len(by_no)==len(words) and set(by_no)==set(range(1,c['expected_page_count']+1)),'Word comparison page numbers differ')
    pages=manifest['pages']
    require(isinstance(pages,list) and 1<=len(pages)<=c['expected_page_count'],'Invalid source-page list')
    prepared=[]; seen_numbers=set();seen_documents=set()
    for item in pages:
        require(isinstance(item,dict) and set(item)=={'catalog_page_number','document_id','local_pdf','render_comparison_path','source_url'},'Invalid source-page manifest')
        n=item['catalog_page_number']; doc=item['document_id']
        require(isinstance(n,int) and not isinstance(n,bool) and n in by_no and n not in seen_numbers
            and isinstance(doc,str) and UUID.fullmatch(doc) is not None and doc.lower() not in seen_documents,'Duplicate or invalid source page')
        seen_numbers.add(n);seen_documents.add(doc.lower())
        comparison=by_no[n]; visual=json.loads(Path(item['render_comparison_path']).expanduser().read_text())
        file_hash=digest(Path(item['local_pdf']).expanduser())
        require(comparison.get('source_url')==item['source_url'] and comparison.get('pdf_sha256')==file_hash
            and comparison.get('geometry_and_words_equal') is True
            and visual.get('source_page')==n and visual.get('individual_pdf_sha256')==file_hash
            and visual.get('full_pdf_sha256')==c['full_pdf_sha256'] and visual.get('normalized_layout_text_equal') is True
            and visual.get('render_dpi')==72 and visual.get('render_png_equal') is True,'Source comparison differs')
        g1,g2=comparison.get('full_page_geometry_sha256'),comparison.get('individual_page_geometry_sha256')
        r1,r2=visual.get('full_render_sha256'),visual.get('individual_render_sha256')
        require(isinstance(g1,str) and HASH.fullmatch(g1) is not None and g1==g2
            and isinstance(r1,str) and HASH.fullmatch(r1) is not None and r1==r2,'Comparison hashes differ')
        prepared.append({'catalog_page_number':n,'document_id':doc,'pdf_sha256':file_hash,'source_url':item['source_url'],
            'full_geometry_sha256':g1,'individual_geometry_sha256':g2,
            'full_render_sha256':r1,'individual_render_sha256':r2})
    require(digest(full)==c['full_pdf_sha256'],'Full PDF changed during preparation')
    return c,sorted(prepared,key=lambda x:x['catalog_page_number'])


def fetch_metadata(origin,key,pages):
    docs={}; page_rows={}
    for offset in range(0,len(pages),50):
        chunk=pages[offset:offset+50]; ids=','.join(x['document_id'] for x in chunk)
        for table,fields,target in (
            ('reference_documents','id,file_hash,source_url,source_capture,superseded_by,page_count,category',docs),
            ('document_pages','id,document_id,page_number',page_rows)):
            col='id' if table=='reference_documents' else 'document_id'
            query=urllib.parse.urlencode({'select':fields,col:'in.('+ids+')'})
            response=service_json(origin+'/rest/v1/'+table+'?'+query,key)
            require(isinstance(response,list),'Unexpected retained-source response')
            for row in response:
                identity=row.get('id') if table=='reference_documents' else row.get('document_id')
                require(identity not in target,'Multiple retained source/page rows')
                target[identity]=row
    output=[]
    for item in pages:
        d=docs.get(item['document_id']);p=page_rows.get(item['document_id'])
        require(isinstance(d,dict) and isinstance(p,dict) and d.get('file_hash')==item['pdf_sha256']
          and d.get('source_url')==item['source_url'] and d.get('category')=='parts_catalog'
          and d.get('page_count')==1 and d.get('superseded_by') is None and p.get('page_number')==1
          and isinstance(p.get('id'),str) and UUID.fullmatch(p['id']) is not None
          and isinstance(d.get('source_capture'),dict)
          and d['source_capture'].get('schema') in ('attested_pdf_text_v1','supplied_reference_v1'),
          'Retained page metadata differs or is missing')
        output.append({k:v for k,v in item.items() if k!='source_url'}|{'document_page_id':p['id']})
    return output


def main():
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    catalog,pages=prepare(json.loads(args.manifest.read_text()))
    require(digest_publisher(catalog['base_url'])==catalog['full_pdf_sha256'],'Current publisher PDF differs')
    origin=os.environ.get('VITE_SUPABASE_URL','').rstrip('/');u=urllib.parse.urlsplit(origin)
    require(u.scheme=='https' and re.fullmatch(r'[a-z0-9-]+\.supabase\.co',u.netloc or '')
        and not u.path and not u.query and not u.fragment,'Invalid configured project URL')
    key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','');require(key.startswith('sb_secret_'),'Use the configured dotenvx service environment')
    linked=fetch_metadata(origin,key,pages)
    if not args.execute:
        print(json.dumps({'status':'verified_no_write','pages':len(linked),'source':'retained_metadata_only',
          'mapping':'client_attested_not_server_reextracted'}));return
    receipt=service_json(origin+'/functions/v1/index-reference-document',key,method='POST',
                        body={'mode':'catalog_page_membership','catalog':catalog,'pages':linked})
    require(isinstance(receipt,dict) and receipt.get('success') is True and receipt.get('source_membership_only') is True
        and receipt.get('pages_submitted')==len(linked) and receipt.get('mapping_status')=='client_attested_not_server_reextracted'
        and isinstance(receipt.get('catalog_id'),str) and UUID.fullmatch(receipt['catalog_id']) is not None
        and isinstance(receipt.get('inserted'),int) and isinstance(receipt.get('replayed'),int)
        and receipt['inserted']+receipt['replayed']==len(linked),'Unexpected source-membership receipt')
    print(json.dumps(receipt))


if __name__=='__main__':main()

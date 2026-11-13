import json,os,sys,urllib.request,concurrent.futures as cf
from pathlib import Path
m=json.load(open('meta.json')); st={x['image_id']:x['state'] for x in json.load(open('ledger_start.json'))}
priv=set(open('/workspace/sortrun/garage/gross_mismatch_v1/privacy_local_union.txt').read().split())
D=Path('img'); D.mkdir(exist_ok=True)
todo=[o for o in m if o['image_url'] and 'supabase.co/storage' in o['image_url'] and not o['is_sensitive'] and o['id'] not in priv and (o['redaction_level'] in (None,'none'))]
json.dump([o['id'] for o in todo],open('universe_ids.json','w'))
print('universe',len(todo),'of',len(m),flush=True)
def get(o):
    p=D/f"{o['id']}.jpg"
    if p.exists() and p.stat().st_size>0: return 'have'
    u=o['image_url'].replace('/storage/v1/object/public/','/storage/v1/render/image/public/')
    u+=('&' if '?' in u else '?')+'width=360&quality=70&resize=contain'
    for url in (u,o['image_url']):
        try:
            b=urllib.request.urlopen(url,timeout=60).read()
            if b: p.write_bytes(b); return 'ok'
        except Exception as e: err=str(e)
    return 'fail:'+err[:60]
import collections;c=collections.Counter()
with cf.ThreadPoolExecutor(16) as ex:
    for i,r in enumerate(ex.map(get,todo)):
        c[r.split(':')[0]]+=1
        if i%1000==0: print(i,dict(c),flush=True)
print(dict(c))

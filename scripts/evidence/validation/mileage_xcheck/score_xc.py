import json,datetime as D
ex=json.load(open('../extracted_v2.json')); ex.update(json.load(open('extra_extracted.json')))
def bm(v):
    c=[e for e in ex.get(v,[]) if e['field']=='mileage_claimed' and e.get('value_num') is not None]
    if not c: return None
    e=c[0]; return e['value_num']*(0.621371 if e.get('unit')=='km' else 1)
res=json.load(open('cross_mi.json'))+json.load(open('cross_mi_extra.json'))
import re
norm=lambda u:re.sub(r'^https?://(www\.)?','',u).rstrip('/')
seen=set();vs=set();n=a=0;dis=[]
for r in res:
    v,src,url,od,bd=r['row']
    if not r.get('mi') or not od or not bd or v in vs: continue
    b=bm(v)
    if b is None: continue
    vs.add(v); o=r['mi']
    od_=D.date.fromisoformat(od[:10]); bd_=D.date.fromisoformat(bd[:10]); dt=abs((od_-bd_).days)/365.25
    ok=abs(b-o)<=max(1000,0.05*max(b,o))+12000*dt
    e,l=((b,o) if bd_<=od_ else (o,b))
    ok=ok and l>=e-max(500,0.02*e)
    n+=1;a+=ok
    if not ok: dis.append(dict(v=v,src=src,url=url,bat=b,other=o,bd=bd,od=od))
print(n,a,a/n if n else 0, {s:sum(1 for d in dis if d['src']==s) for s in('mecum','pcarmarket')})
json.dump(dis,open('xc_disagree.json','w'),indent=1)

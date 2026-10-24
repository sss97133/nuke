import json,re,numpy as np,pickle,bisect,datetime,resource,hashlib
G,V,VA=pickle.load(open('comps_v9.pkl','rb'))
def fam(md):
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
od=lambda s: datetime.date.fromisoformat(s).toordinal()
R=json.load(open('../rows.json'))
WIN=[3,3,9]; WIDE=[6,6,9,9]; out=[]
def cands(L,key,d,yr,v,w,k):
  A=G[L].get(key,[]); i=bisect.bisect_left(A,(d,))
  c=[x for x in A[max(0,i-4000):i] if abs(x[1]-yr)<=w and x[2]!=v][-k:]
  return c
for r in R:
  v=r['v']
  if v not in V or not r['d']: continue
  mk,md,yr=V[v]; d=od(r['d']); mi,sg=VA.get(v,(np.nan,''))
  keys=[(mk,md),(mk,fam(md)),(mk,yr//10),(sg,yr//10)]
  lv=3
  for L in range(3):
    if len(cands(L,keys[L],d,yr,v,WIN[L],40))>=3: lv=L; break
  C={L:np.array([(x[0]-d,x[1]-yr,x[3],x[5]) for x in cands(L,keys[L],d,yr,v,WIDE[L],120)]).reshape(-1,4) for L in range(3)}
  C[3]=np.array([(x[0]-d,x[1]-yr,x[3],x[5]) for x in cands(3,keys[3],d,yr,v,9,120)]).reshape(-1,4) if sg else np.zeros((0,4))
  out.append(dict(v=v,p=float(r['p']),e=float(r['e']),lo=float(r['lo'] or 0),hi=float(r['hi'] or 0),d=r['d'],c=r['c'],lv=lv,yr=yr,mi=mi,sg=sg,mk=mk,C=C))
pickle.dump(out,open('feat_v9.pkl','wb'))
import collections
print(len(out),collections.Counter(o['lv'] for o in out),'rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

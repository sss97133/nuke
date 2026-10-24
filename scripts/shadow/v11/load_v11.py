import json,re,numpy as np,collections,resource,pickle,datetime,math
src=open('../v9/load_v9.py').read().split('VA={}')[0]; exec(src)
MF=["b3e98ba9-8a95-42e4-8540-9fb63ea93088","ecd20f67-b763-4b4e-ae48-5b8aea55ed41","1fe3341f-eb7b-457b-8d92-e866d33d5e53","83d1c671-01d6-4220-86b3-59ac7fa4a925","3caecdb4-94be-4c84-95f0-7167e25c8f1e","68c8ca7d-e1bf-40a8-870b-1b55560c555d","4354af4f-a8bc-4522-a1e3-6b9973637eed"]
MF.append("cd4739c3-ff79-4e32-a271-06f20cc891c8")
LM={}; TMU=set()
for f in MF:
  for l in rd(f).split('\n'):
    p=l.split('|')
    if len(p)==4 and p[3]=='t': TMU.add((p[0],p[1]))
    elif len(p)==4 and p[2]: LM[(p[0],p[1])]=float(p[2])
SEGV={}
for f in VF:
  for l in rd(f).split('\n'):
    p=l.split('|')
    if len(p)==3 and p[2]: SEGV[p[0]]=p[2]
NM={(o['platform'],o['make_l'],o['model_raw']):o['model_canon'] for o in json.load(open('../v10/norm_v10.json'))}
SM={(o['make_l'],o['model_canon']):o['segment_slug'] for o in json.load(open('../v10/segmap_v10.json'))}
def fam(md):
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
def canon(pl,mk,md): return NM.get((pl,mk,md)) or fam(md)
od=lambda s: datetime.date.fromisoformat(s).toordinal()
G=[collections.defaultdict(list) for _ in range(4)]; V={}; n=0; nm=0
for f in CF:
  for l in rd(f).split('\n'):
    p=l.split('|')
    if len(p)!=7: continue
    vid,mk,md,yr,pl,d,h=p; yr=int(yr); n+=1
    cf=canon(pl,mk,md)
    if pl=='bat': V.setdefault(vid,(mk,md,yr,cf))
    mi=LM.get((vid,d),np.nan); nm+=mi==mi
    sg=SEGV.get(vid) or SM.get((mk,cf),'')
    x=(od(d),yr,vid,math.log(float(h)),pl,mi)
    G[0][(mk,md)].append(x); G[1][(mk,cf)].append(x); G[2][(mk,yr//10)].append(x)
    if sg: G[3][(sg,yr//10)].append(x)
for g in G:
  for k in g: g[k].sort()
VS={v:(SEGV.get(v) or SM.get((t[0],t[3]),'')) for v,t in V.items()}
pickle.dump((G,V,LM,VS),open('comps_v11.pkl','wb')); pickle.dump(TMU,open('tmu_v11.pkl','wb'))
print('tmu',len(TMU),'comps',n,'with listing mileage',nm,'seg comps',sum(len(x) for x in G[3].values()),'rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

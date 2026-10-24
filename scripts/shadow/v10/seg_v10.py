# learn (make, family) -> segment. votes from labelled vehicles; else neighbours in same make by name similarity + co-pricing (pre-2024-07-01 sales, excluding held-out f5==0 vehicles)
import pickle,json,re,collections,hashlib,datetime,numpy as np,resource
G,V,VA=pickle.load(open('../v9/comps_v9.pkl','rb'))
NM={(o['platform'],o['make_l'],o['model_raw']):o for o in json.load(open('norm_v10.json'))}
def fam(md):
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
def canon(pl,mk,md):
  o=NM.get((pl,mk,md)); return o['model_canon'] if o else fam(md)
h=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)
CUT=datetime.date(2024,7,1).toordinal()
votes=collections.defaultdict(collections.Counter); seen=collections.defaultdict(set)
price=collections.defaultdict(list); names=collections.defaultdict(collections.Counter)
for (mk,md),L in G[0].items():
  for d,yr,vid,lp,pl,mi in L:
    f=canon(pl,mk,md); k=(mk,f); names[k][md]+=1
    sg=VA.get(vid,(0,''))[1]
    if sg and vid not in seen[k]: seen[k].add(vid); votes[k][sg]+=1
    if d<CUT and h(vid)%5!=0: price[(mk,f,yr//10)].append(lp)
del G
med={k:float(np.median(v)) for k,v in price.items() if len(v)>=3}
tri=lambda s:{s[i:i+3] for i in range(max(1,len(s)-2))}
toks=lambda k:{t for md in names[k] for t in re.split(r'[\s\-/]+',md)}
out=[]; bymake=collections.defaultdict(list)
for k,c in votes.items():
  n=sum(c.values()); sg,top=c.most_common(1)[0]; share=top/n
  if share<0.5: continue
  conf=round(share*n/(n+2),3)
  out.append(dict(make_l=k[0],model_canon=k[1],segment_slug=sg,confidence=conf,method='label_votes_v1',evidence=dict(labelled_vehicles=n,votes=dict(c.most_common(4)))))
  if conf>=0.6: bymake[k[0]].append((k[1],sg,conf))
lab={(o['make_l'],o['model_canon']) for o in out}
nn=0
for k in names:
  if k in lab or not bymake.get(k[0]): continue
  mk,f=k; T=toks(k); best=None
  for f2,sg,c2 in bymake[mk]:
    k2=(mk,f2); ns=max(len(tri(f)&tri(f2))/len(tri(f)|tri(f2)), len(T&toks(k2))/max(1,len(T|toks(k2))))
    dec=[(abs(med[(mk,f,d)]-med[(mk,f2,d)])) for d in range(190,203) if (mk,f,d) in med and (mk,f2,d) in med]
    ps=float(np.exp(-np.median(dec)/0.3)) if dec else None
    sc=(0.5*ns+0.5*ps) if ps is not None else 0.5*ns
    if best is None or sc>best[0]: best=(sc,f2,sg,ns,ps,len(dec))
  if best and best[0]>=0.35:
    nn+=1; out.append(dict(make_l=mk,model_canon=f,segment_slug=best[2],confidence=round(min(0.6,best[0]),3),method='name_copricing_nn_v1',evidence=dict(neighbour_family=best[1],name_sim=round(best[3],3),copricing_sim=None if best[4] is None else round(best[4],3),shared_decades=best[5],price_window='sales before 2024-07-01, held-out f5==0 vehicles excluded')))
json.dump(out,open('segmap_v10.json','w'))
print('labelled fams',len(lab),'nn fams',nn,'total',len(out),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

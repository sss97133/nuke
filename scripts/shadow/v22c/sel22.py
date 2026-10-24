# v22 feature selection (same origins and rule as v21; condition claims split by source): rolling-origin on TRAINING rows only (f5!=0, sale date < 2024-07-01, i.e. before every gate
# window). Origins 2023-01-01/2023-07-01/2024-01-01, each validated on the next 6 months. Comp sets: the 2024-07-01 cut.
# Pre-registered rule: greedy forward over groups G1d/G1s/G1c condition claims by source (description, seller comment, commenter), G2 service/provenance/ownership,
# G3 seller comments/answers; add the group that lowers mean validation MdAPE (all levels) most, if by >= 0.001.
import numpy as np,json,resource,time
from sklearn.ensemble import HistGradientBoostingRegressor as H
exec(open('common18.py').read())
F=np.log1p(np.load('F22.npy')); C=None
G={'G1d_cond_desc':[0,1,2],'G1s_cond_seller_cmt':[3,4,5],'G1c_cond_commenter':[6,7,8],'G2_svc_prov_own':[9,10,11],'G3_seller':[13,14]}
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
OR=['2023-01-01','2023-07-01','2024-01-01','2024-07-01']
Z,Nn,MM=getsets('2024-07-01'); z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
base=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS,TMU,MM,ATT]
cache={}
def score(groups):
  r=[]
  for i,c in enumerate(OR[:3]):
    tr=(d<c)&(f5!=0)&(lv<3)&np.isfinite(z0); y=lp-z0; tr&=np.abs(y)<np.log(5)
    if c not in cache: cache[c]=tok_te(np.where(tr,y,0.),tr,f4)
    va=(d>=c)&(d<OR[i+1])&(f5!=0)&(lv<3)&np.isfinite(z0)
    X=np.c_[tuple(base+[cache[c]]+[F[:,G[g]] for g in groups]+[z0])]
    s=np.exp(z0+H(loss='absolute_error',random_state=0,**prm).fit(X[tr],y[tr]).predict(X))
    r.append(dict(cut=c,all=E(s,va),**{f'L{L}':E(s,va&(lv==L)) for L in range(3)},bat=E(s,va&~ismec),n_val=int(va.sum())))
  m={k:round(float(np.mean([x[k] for x in r])),4) for k in ['all','L0','L1','L2','bat']}
  print(groups,m,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True); return m,r
log=[]; cur=[]; best,_=score(cur); log.append(dict(groups=[],**best))
while True:
  cand={g:score(cur+[g]) for g in G if g not in cur}
  for g,(m,_) in cand.items(): log.append(dict(groups=cur+[g],**m))
  if not cand: break
  g=min(cand,key=lambda k:cand[k][0]['all'])
  if best['all']-cand[g][0]['all']>=0.001: cur.append(g); best=cand[g][0]
  else: break
print('PICK',cur,best)
json.dump(dict(pick=cur,best=best,log=log,rule=open(__file__).read().split('\n')[3]),open('sel22.json','w'),indent=0)

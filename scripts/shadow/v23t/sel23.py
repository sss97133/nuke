# v23 feature selection: forward rolling-origin on TRAINING rows only (f5!=0, sale date < 2024-07-01, before every gate window).
# Origins 2023-01-01/2023-07-01/2024-01-01, each validated on the next 6 months; comp sets: 2024-07-01 cut. Base = v21 (v20 + sel21 claim groups).
# Pre-registered rule: greedy forward over groups T_seg (segment 90/365-day index), T_fam (shrunk family 90/365-day index), W_wide (wide same-model comps); add the group that lowers mean validation MdAPE (all levels) most, if by >= 0.001.
import numpy as np,json,resource
from sklearn.ensemble import HistGradientBoostingRegressor as H
exec(open('common18.py').read())
F21=np.log1p(np.load('F21.npy')); S21=json.load(open('sel21.json')); G21={'G1_cond':[0,1,2],'G2_svc_prov_own':[3,4,5],'G3_seller':[7,8]}
X21=[F21[:,G21[g]] for g in S21['pick']]
F=np.load('F23.npy'); G={'T_seg':[0,1,2],'T_fam':[3,4,5],'W_wide':[6,7,8,9]}
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
OR=['2023-01-01','2023-07-01','2024-01-01','2024-07-01']
Z,Nn,MM=getsets('2024-07-01'); z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
def gx(g): X=F[:,G[g]].copy(); return np.c_[X[:,0]-z0,X[:,1:]] if g=='W_wide' else X
base=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS,TMU,MM,ATT]; cache={}
def score(groups):
  r=[]
  for i,c in enumerate(OR[:3]):
    tr=(d<c)&(f5!=0)&(lv<3)&np.isfinite(z0); y=lp-z0; tr&=np.abs(y)<np.log(5)
    if c not in cache: cache[c]=tok_te(np.where(tr,y,0.),tr,f4)
    va=(d>=c)&(d<OR[i+1])&(f5!=0)&(lv<3)&np.isfinite(z0)
    X=np.c_[tuple(base+[cache[c]]+X21+[gx(g) for g in groups]+[z0])]
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
json.dump(dict(pick=cur,best=best,log=log,rule=open(__file__).read().split('\n')[2]),open('sel23.json','w'),indent=0)

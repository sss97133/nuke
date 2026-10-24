# v13 selection: forward rolling-origin on TRAINING rows only (f5!=0); random holdout f5==0 unused. Base = v12 var2.
import numpy as np,json,collections,resource,os
from sklearn.ensemble import HistGradientBoostingRegressor as H
os.chdir('../v12'); exec(open('../v13b/fam.py').read())
S=np.load('sets_v11.npz'); Me=np.load('meta_v11.npz')
lp,p,lv,f5,f4,TM,TMU,TMISS=[S[k] for k in ['lp','p','lv','f5','f4','TM','TMU','TMISS']]
yr=Me['yr']; d=Me['d']; mk=Me['mk']; sy=np.array([int(x[:4]) for x in d])
F=np.load('../v13b/feat_v13b_pit.npz'); TK=json.load(open('../v13/tok_v13.json'))
ATT=np.c_[F['man'],F['spd'],F['cf'],F['dt'],F['bd']]
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
prm=json.load(open('../v10/gbm_best.json'))
KS=20.
def te(y,tr,fold):
  # shrunk mean residual per (make,token) from training rows; OOF (by f4) for training rows
  def stats(m):
    s=collections.defaultdict(float); n=collections.Counter()
    for i in np.flatnonzero(m):
      for t in TK[i]: s[(mk[i],t)]+=y[i]; n[(mk[i],t)]+=1
    return s,n
  out=np.zeros((len(y),4)); out[:,0]=np.nan
  full=stats(tr); per={k:stats(tr&(fold!=k)) for k in range(4)}
  for i in range(len(y)):
    s,n=per[fold[i]] if tr[i] else full
    v=[s[(mk[i],t)]/(n[(mk[i],t)]+KS) for t in TK[i] if n[(mk[i],t)]>=3]
    if v: out[i]=[sum(v),min(v),max(v),len(v)]
  return out

import datetime,itertools,time
od=lambda x: datetime.date.fromisoformat(x).toordinal()
v=Me['v']; dord=np.array([od(x) for x in d]); excl=set(v[f5==0])
GRID=[dict(s=s_,c=0.3,l=0.7,mode=m_) for s_ in (0.35,0.5,0.7) for m_ in ('l2feat','swap','swapfeat')]
res=[]; CLS={}
for c_i,c in enumerate(CUTS[:3]):
  FS=np.load(f'fwdsets11_{c}.npz'); Z,Nn,MM=FS['Z'],FS['N'],FS['M']
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
  base=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS.astype(float),TMU.astype(float),MM]
  tr=(d<c)&(f5!=0)&(lv<3)&np.isfinite(z0); y=lp-z0; tr&=np.abs(y)<np.log(5)
  T=te(np.where(tr,y,0.),tr,f4)
  va=(d>=c)&(d<CUTS[c_i+1])&(f5!=0)&(lv<3)&np.isfinite(z0)
  for gi,g in enumerate([None]+GRID):
    t0=time.time(); extra=[ATT,T]; name='v13pit' if g is None else f"s{g['s']}_{g['mode']}"
    if g is not None:
      CL,ed=clusters(od(c),excl,g['s'],g['c'],g['l']); FF=feats(CL,v,dord); l2=(lv==2)&np.isfinite(FF[:,0])
      if False: pass
      print(name,'edges',ed,'L2 w/ fam comps',int(l2.sum()),'of',int((lv==2).sum()),flush=True)
      zb=np.where(l2,FF[:,0],z0) if g['mode'].startswith('swap') else z0
      Fm=np.where(l2[:,None],FF,np.nan)
      extra=extra+([Fm[:,0]-zb,Fm[:,1:]] if g['mode'] in ('l2feat','swapfeat') else [])+([l2.astype(float),z0-zb] if g['mode'].startswith('swap') else [])
    else: zb=z0
    yb=lp-zb; trb=(d<c)&(f5!=0)&(lv<3)&np.isfinite(zb)&(np.abs(yb)<np.log(5))
    X=np.c_[tuple([Z-zb[:,None]]+base[1:]+extra+[zb])]
    gb=H(loss='absolute_error',random_state=0,**prm).fit(X[trb],yb[trb]); s_=np.exp(zb+gb.predict(X))
    r=dict(cut=c,var=name,all=round(E(s_,va),4),**{f'L{L}':round(E(s_,va&(lv==L)),4) for L in range(3)})
    res.append(r); print(r,'sec',round(time.time()-t0),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
  del FS,Z,Nn,MM
agg={}
for nm in dict.fromkeys(r['var'] for r in res):
  rr=[r for r in res if r['var']==nm]; agg[nm]={k:round(float(np.mean([r[k] for r in rr])),4) for k in ['all','L0','L1','L2']}
print('AGG',json.dumps(agg)); json.dump(dict(agg=agg,res=res,criterion='min mean fwd L2 among variants with mean fwd all <= v13pit all (PIT attrs base)'),open('../v13b/sel_v13b_r2.json','w'),indent=0)

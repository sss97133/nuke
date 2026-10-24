# v18 selection: forward rolling-origin on TRAINING rows only (f5!=0); random holdout f5==0 unused. Same grid and
# pre-registered rule as v14/v13b: min mean fwd L2 among family-swap variants with mean fwd all <= no-family all.
import numpy as np,json,resource,time
from sklearn.ensemble import HistGradientBoostingRegressor as H
exec(open('common18.py').read())
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
excl=set(v[f5==0])
GRID=[dict(s=s_,c=0.3,l=0.7,mode='swap') for s_ in (0.35,0.5,0.7)]
res=[]
for c_i,c in enumerate(CUTS[:3]):
  Z,Nn,MM=getsets(c)
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
  base=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS,TMU,MM]
  tr=(d<c)&(f5!=0)&(lv<3)&np.isfinite(z0); y=lp-z0; tr&=np.abs(y)<np.log(5)
  Tt=tok_te(np.where(tr,y,0.),tr,f4)
  va=(d>=c)&(d<CUTS[c_i+1])&(f5!=0)&(lv<3)&np.isfinite(z0)
  for g in [None]+GRID:
    t0=time.time(); extra=[ATT,Tt]; name='nofam' if g is None else f"s{g['s']}_{g['mode']}"
    if g is not None:
      CL,ed=clusters(od(c),excl,g['s'],g['c'],g['l']); FF=feats(CL,v,DORD); l2=(lv==2)&np.isfinite(FF[:,0])
      zb=np.where(l2,FF[:,0],z0); extra=extra+[l2.astype(float),z0-zb]
    else: zb=z0
    yb=lp-zb; trb=(d<c)&(f5!=0)&(lv<3)&np.isfinite(zb)&(np.abs(yb)<np.log(5))
    X=np.c_[tuple([Z-zb[:,None]]+base[1:]+extra+[zb])]
    gb=H(loss='absolute_error',random_state=0,**prm).fit(X[trb],yb[trb]); s_=np.exp(zb+gb.predict(X))
    r=dict(cut=c,var=name,n_train=int(trb.sum()),n_val=int(va.sum()),all=round(E(s_,va),4),**{f'L{L}':round(E(s_,va&(lv==L)),4) for L in range(3)})
    res.append(r); print(r,'sec',round(time.time()-t0),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
agg={}
for nm in dict.fromkeys(r['var'] for r in res):
  rr=[r for r in res if r['var']==nm]; agg[nm]={k:round(float(np.mean([r[k] for r in rr])),4) for k in ['all','L0','L1','L2']}
ok=[k for k in agg if k!='nofam' and agg[k]['all']<=agg['nofam']['all']]
pick=min(ok,key=lambda k:agg[k]['L2']) if ok else 'nofam'
print('AGG',json.dumps(agg),'PICK',pick)
json.dump(dict(agg=agg,res=res,pick=pick,criterion='v18 (pre-registered, same as v13b/v14): min mean fwd L2 among family-swap variants with mean fwd all <= no-family all; else no-family. Gross basis; training rows only (f5!=0).'),open('sel18.json','w'),indent=0)

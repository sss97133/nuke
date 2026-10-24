# v13 selection: forward rolling-origin on TRAINING rows only (f5!=0); random holdout f5==0 unused. Base = v12 var2.
import numpy as np,json,collections,resource,os
from sklearn.ensemble import HistGradientBoostingRegressor as H
os.chdir('../v12')
S=np.load('sets_v11.npz'); Me=np.load('meta_v11.npz')
lp,p,lv,f5,f4,TM,TMU,TMISS=[S[k] for k in ['lp','p','lv','f5','f4','TM','TMU','TMISS']]
yr=Me['yr']; d=Me['d']; mk=Me['mk']; sy=np.array([int(x[:4]) for x in d])
F=np.load('../v13/feat_v13.npz'); TK=json.load(open('../v13/tok_v13.json'))
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
res=[]
for c_i,c in enumerate(CUTS[:3]):
  FS=np.load(f'fwdsets11_{c}.npz'); Z,Nn,MM=FS['Z'],FS['N'],FS['M']
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
  base=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS.astype(float),TMU.astype(float),MM]
  tr=(d<c)&(f5!=0)&(lv<3)&np.isfinite(z0); y=lp-z0; tr&=np.abs(y)<np.log(5)
  T=te(np.where(tr,y,0.),tr,f4)
  va=(d>=c)&(d<CUTS[c_i+1])&(f5!=0)&(lv<3)&np.isfinite(z0)
  for name,extra in [('v12var2',[]),('attr',[ATT]),('tok',[T]),('attr+tok',[ATT,T])]:
    X=np.c_[tuple(base+extra+[z0])]
    g=H(loss='absolute_error',random_state=0,**prm).fit(X[tr],y[tr]); s=np.exp(z0+g.predict(X))
    r=dict(cut=c,var=name,all=round(E(s,va),4),**{f'L{L}':round(E(s,va&(lv==L)),4) for L in range(3)})
    res.append(r); print(r,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
  del FS,Z,Nn,MM
agg={}
for v in ['v12var2','attr','tok','attr+tok']:
  rr=[r for r in res if r['var']==v]; agg[v]={k:round(float(np.mean([r[k] for r in rr])),4) for k in ['all','L0','L1','L2']}
print('AGG',agg); json.dump(dict(agg=agg,res=res),open('../v13/sel_v13.json','w'),indent=0)

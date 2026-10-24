# v11 model selection: forward rolling-origin on TRAINING rows only (f5!=0); random holdout f5==0 never used.
import numpy as np,json,sys,itertools
from sklearn.ensemble import HistGradientBoostingRegressor as H
S=np.load('sets_v11.npz'); Me=np.load('meta_v11.npz')
lp,p,lv,f5,TM,TMU,TMISS=[S[k] for k in ['lp','p','lv','f5','TM','TMU','TMISS']]
yr=Me['yr']; d=Me['d']; sy=np.array([int(x[:4]) for x in d])
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
FS={c:np.load(f'fwdsets11_{c}.npz') for c in CUTS[:3]}
def Xmat(F,var):
  Z,Nn,M=F['Z'],F['N'],F['M']; z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
  cols=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy]
  if var>=1: cols+=[TMISS.astype(float),TMU.astype(float)]
  if var>=2: cols+=[M]
  cols+=[z0]; return z0,np.c_[tuple(cols)]
base=json.load(open('../v10/gbm_best.json'))
grid=[base,dict(base,max_iter=600),dict(base,max_leaf_nodes=15),dict(base,min_samples_leaf=100)]
res=[]
for var,prm in itertools.product([0,1,2],grid):
  sc=[];lvl={0:[],1:[],2:[]}
  for i,c in enumerate(CUTS[:3]):
    z0,X=Xmat(FS[c],var); tr=(d<c)&(f5!=0)&(lv<3)&np.isfinite(z0); y=lp-z0; tr&=np.abs(y)<np.log(5)
    g=H(loss='absolute_error',random_state=0,**prm).fit(X[tr],y[tr]); s=np.exp(z0+g.predict(X))
    va=(d>=c)&(d<CUTS[i+1])&(f5!=0)&(lv<3)&np.isfinite(s); sc.append(E(s,va))
    for L in range(3): lvl[L].append(E(s,va&(lv==L)))
  r=dict(var=var,prm=prm,mean=round(float(np.mean(sc)),4),cuts=[round(x,4) for x in sc],lvl={L:round(float(np.mean(v)),4) for L,v in lvl.items()})
  res.append(r); print(r,flush=True)
best=min(res,key=lambda r:r['mean']); json.dump(dict(best=best,all=res),open('sel_v11.json','w'),indent=0); print('BEST',best)

import numpy as np,json,resource,sys
from sklearn.ensemble import HistGradientBoostingRegressor as H
S=np.load('sets_v9.npz'); M=np.load('meta_v9.npz')
lp,p,e,lo,hi,lv,f5,f4,TM=[S[k] for k in ['lp','p','e','lo','hi','lv','f5','f4','TM']]
yr=M['yr']; sy=np.array([int(x[:4]) for x in M['d']]); te=f5==0
def X(k):
  Z=S[f'Z{k}'].astype(float); Nn=S[f'N{k}']; z0=np.choose(np.minimum(lv,2),Z[:,:3].T)
  D=Z-z0[:,None]; return z0,np.c_[D,np.log1p(Nn),lv,yr,TM,sy,z0]
A=lambda z,m: float(np.median(np.abs(np.exp(z[m])-p[m])/p[m]))
ok0=lv<3
def fitpred(tr,k,params):
  z0,Xk=X(k); m=tr&ok0&np.isfinite(z0); y=lp-z0; m&=np.abs(y)<np.log(5)
  g=H(loss='absolute_error',random_state=0,**params).fit(Xk[m],y[m]); return z0+g.predict(Xk)
grid=[dict(max_iter=it,learning_rate=lr,max_leaf_nodes=ml,min_samples_leaf=50) for it in (300,600) for lr in (0.05,) for ml in (15,31)]
best=None
for prm in grid:
  sc={L:[] for L in range(3)}
  for k in range(4):
    tr=~te&(f4!=k); va=~te&(f4==k); z=fitpred(tr,k,prm)
    for L in range(3): sc[L].append(A(z,va&(lv==L)&np.isfinite(z)))
  s={L:round(np.mean(sc[L]),4) for L in sc}; print(prm,s,flush=True)
  tot=sum(s[L]*(lv[~te]==L).sum() for L in s)
  if best is None or tot<best[0]: best=(tot,prm)
json.dump(best[1],open('gbm_best.json','w')); print('best',best[1],'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

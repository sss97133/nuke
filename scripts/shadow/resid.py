import json,numpy as np,hashlib
B={b['v']:b for b in json.load(open('bases.json'))}; R=json.load(open('rows.json'))
F=['fc','fo','fd','fr','fw','fi']
rs=[r for r in R if r['v'] in B]
h5=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)%5
p=np.array([r['p'] for r in rs],float); b0=np.array([B[r['v']]['base'] for r in rs])
X=np.array([[float(r[k]) if r[k] is not None else np.nan for k in F] for r in rs])
ns=np.array([r['ns'] or 0 for r in rs]); te=np.array([h5(r['v'])==0 for r in rs]); fold=np.array([h5(r['v']) for r in rs])
y=np.log(p/b0); ok=np.abs(y)<np.log(5)
for j,k in enumerate(F):
  x=X[:,j]; pr=~np.isnan(x); print(k,'present',pr.mean().round(3),'uniq',len(np.unique(x[pr])),'q',np.nanquantile(x,[.1,.5,.9]).round(3) if pr.any() else None)
tr=~te&ok; a0=np.median(y[tr]); r0=y-a0
# presence vs value decomposition; centred within present
P=~np.isnan(X); V=np.where(P,X,0); mu=np.array([V[tr&P[:,j],j].mean() if (tr&P[:,j]).any() else 0 for j in range(6)])
Vc=np.where(P,X-mu,0)
def fit(Z,m,lam):
  Z1=np.c_[np.ones(len(Z)),Z]; L=lam*np.eye(Z1.shape[1]); L[0,0]=0
  return np.linalg.lstsq(Z1[m].T@Z1[m]+L,Z1[m].T@y[m],rcond=None)[0]
def md(s,m): return np.median(np.abs(s[m]-p[m])/p[m])
for nm,Z in [('presence',P.astype(float)),('value_centred',Vc),('both',np.c_[P,Vc])]:
  for lam in [10,100,1000]:
    b=fit(Z,tr,lam); s=b0*np.exp(np.c_[np.ones(len(Z)),Z]@b)
    print(nm,lam,'coef',b.round(3),'held',round(md(s,te),4),'ns2+',round(md(s,te&(ns>=2)),4))
  # stability: fit on each of 4 train folds-out
  bs=np.array([fit(Z,tr&(fold!=f),100) for f in range(1,5)]); print(' stability sd',bs.std(0).round(3),'sign-consistent',(np.sign(bs)==np.sign(bs[0])).all(0))
print('comps-only held',round(md(b0*np.exp(a0),te),4),'ns2+',round(md(b0*np.exp(a0),te&(ns>=2)),4),'n',(te&(ns>=2)).sum())
# univariate residual correlation on train
for j,k in enumerate(F):
  m=tr&P[:,j]
  if m.sum()>30: print(k,'n',m.sum(),'corr(val,resid)',np.corrcoef(X[m,j],r0[m])[0,1].round(3),'presence mean resid',r0[m].mean().round(3),'absent',r0[tr&~P[:,j]].mean().round(3))
# is evidence already in comps? corr of feature with log base vs price-level
for j,k in enumerate(F):
  m=tr&P[:,j]
  if m.sum()>30: print(k,'corr(val,log base)',np.corrcoef(X[m,j],np.log(b0[m]))[0,1].round(3),'corr(val,log price)',np.corrcoef(X[m,j],np.log(p[m]))[0,1].round(3))

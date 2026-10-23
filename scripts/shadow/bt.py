import json,numpy as np,hashlib
R=json.load(open('rows.json'))
F=['fc','fo','fd','fr','fw','fi']
def h(v): return int(hashlib.md5(v.encode()).hexdigest()[:8],16)%5
R=[r for r in R if r['p'] and float(r['e'])>0]
eq=sum(abs(float(r['e'])-r['p'])<1 for r in R); after=sum(bool(r['c'] and r['d'] and r['c']>r['d']) for r in R)
print('n',len(R),'est==sale',eq,'est computed after sale',after)
import collections; print(collections.Counter(r['m'] for r in R).most_common(8))
X=np.array([[1]+[float(r[k] or 0) for k in F]+[np.log1p(r['np'] or 0)] for r in R]); 
y=np.log(np.array([r['p'] for r in R],float)/np.array([float(r['e']) for r in R]))
ns=np.array([min(r['ns'] or 0,3) for r in R]); te=np.array([h(r['v'])==0 for r in R])
lo=np.array([float(r['lo'] or 0) for r in R]); hi=np.array([float(r['hi'] or 0) for r in R]); e=np.array([float(r['e']) for r in R]); p=np.exp(y)*e
ok=np.abs(y)<np.log(5)  # train robustness only
tr=~te&ok
lam=10*np.eye(X.shape[1]); lam[0,0]=0
b=np.linalg.solve(X[tr].T@X[tr]+lam,X[tr].T@y[tr])
names=['intercept']+['f_condition','f_originality','f_documented_work','f_records','f_ownership','f_identity','log1p_photos']
print(dict(zip(names,np.round(b,4))))
res=y-X@b; q={str(k):list(np.quantile(res[tr&(ns==k)],[.1,.9])) for k in range(4)}
mult=np.exp(X@b); s=e*mult
slo=s*np.exp([q[str(k)][0] for k in ns]); shi=s*np.exp([q[str(k)][1] for k in ns])
def rep(m,name):
  ape_l=np.abs(e[m]-p[m])/p[m]; ape_s=np.abs(s[m]-p[m])/p[m]
  cl=((p[m]>=lo[m])&(p[m]<=hi[m])).mean(); cs=((p[m]>=slo[m])&(p[m]<=shi[m])).mean()
  wl=np.median((hi[m]-lo[m])/e[m]); ws=np.median((shi[m]-slo[m])/s[m])
  win=(ape_s<ape_l).mean()
  print(f"{name}: n={m.sum()} MdAPE live={np.median(ape_l):.4f} shadow={np.median(ape_s):.4f} | cov live={cl:.3f} (w{wl:.2f}) shadow80={cs:.3f} (w{ws:.2f}) | shadow closer {win:.3f}")
rep(te,'heldout all')
rep(te&(np.abs(e-p)>=1),'heldout est!=sale')
for k in range(4): rep(te&(ns==k),f'heldout ns={k}')
json.dump({'coef':dict(zip(names,map(float,b))),'q':q,'n':int(tr.sum())},open('model.json','w'))

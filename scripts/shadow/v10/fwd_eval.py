import numpy as np,json,sys
from sklearn.ensemble import HistGradientBoostingRegressor as H
S=np.load('../v9/sets_v9.npz'); M=np.load('../v9/meta_v9.npz')
lp,p,e,lo,hi,lv,f4,TM=[S[k] for k in ['lp','p','e','lo','hi','lv','f4','TM']]
yr=M['yr']; d=M['d']; sy=np.array([int(x[:4]) for x in d])
prm=json.load(open('../v9/gbm_best.json'))
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
C=lambda l,u,m: float(((p[m]>=l[m])&(p[m]<=u[m])).mean())
def run(Z,Nn,tr):
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float); Xk=np.c_[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,z0]
  def fit(m):
    m=m&(lv<3)&np.isfinite(z0); y=lp-z0; m&=np.abs(y)<np.log(5)
    return H(loss='absolute_error',random_state=0,**prm).fit(Xk[m],y[m])
  s=z0+fit(tr).predict(Xk); oof=np.full(len(p),np.nan)
  for k in range(4):
    mm=tr&(f4==k); oof[mm]=(z0+fit(tr&(f4!=k)).predict(Xk))[mm]
  sl=np.full(len(p),np.nan); sh=sl.copy()
  for L in range(3):
    m=tr&(lv==L)&np.isfinite(oof); q=np.quantile(lp[m]-oof[m],[.1,.9]); mm=lv==L; sl[mm]=np.exp(s[mm]+q[0]); sh[mm]=np.exp(s[mm]+q[1])
  return np.exp(s),sl,sh,np.exp(z0)
out={}
for i,c in enumerate(CUTS[:3]):
  F=np.load(f'fwdsets_{c}.npz'); tr=d<c; te=(d>=c)&(d<CUTS[i+1])
  sv,sl,sh,co=run(F['Z'],F['N'],tr)
  for L in [0,1,2,'all']:
    m=te&np.isfinite(sv)&np.isfinite(co)&(e>0)&((lv<3) if L=='all' else (lv==L))
    r=dict(n=int(m.sum()),v9=round(E(sv,m),4),comps=round(E(co,m),4),live=round(E(e,m),4),cov_v9=round(C(sl,sh,m),3),cov_live=round(C(lo,hi,m),3))
    out[f'{c}|{L}']=r; print(c,L,r,flush=True)
  np.savez(f'fwdpred_v9_{c}.npz',s=sv,lo=sl,hi=sh,co=co)
json.dump(out,open('fwd_v9.json','w'),indent=0)

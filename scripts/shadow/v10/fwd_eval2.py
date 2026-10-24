import numpy as np,json,sys
from sklearn.ensemble import HistGradientBoostingRegressor as H
tag,base,pref,prmf,nosy=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],int(sys.argv[5])
S=np.load(base); M=np.load('meta_v10.npz'); lv9=np.load('../v9/sets_v9.npz')['lv']
lp,p,e,lo,hi,lv,f4,f5,TM=[S[k] for k in ['lp','p','e','lo','hi','lv','f4','f5','TM']]
yr=M['yr']; d=M['d']; sy=np.array([int(x[:4]) for x in d]); prm=json.load(open(prmf))
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
C=lambda l,u,m: float(((p[m]>=l[m])&(p[m]<=u[m])).mean())
def run(Z,Nn,tr):
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float); cols=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM]+([] if nosy else [sy])+[z0]; Xk=np.c_[tuple(cols)]
  def fit(m):
    m=m&(lv<3)&np.isfinite(z0); y=lp-z0; m&=np.abs(y)<np.log(5)
    return H(loss='absolute_error',random_state=0,**prm).fit(Xk[m],y[m])
  s=z0+fit(tr).predict(Xk); oof=np.full(len(p),np.nan)
  for k in range(4):
    mm=tr&(f4==k); oof[mm]=(z0+fit(tr&(f4!=k)).predict(Xk))[mm]
  sl=np.full(len(p),np.nan); sh=sl.copy()
  for L in range(3):
    m=tr&(lv==L)&np.isfinite(oof); q=np.quantile(lp[m]-oof[m],[.1,.9]); mm=lv==L; sl[mm]=np.exp(s[mm]+q[0]); sh[mm]=np.exp(s[mm]+q[1])
  return np.exp(s),sl,sh
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']; out={}
splits=[('random','all',f5!=0,f5==0)]+[(c,c,d<c,(d>=c)&(d<CUTS[i+1])) for i,c in enumerate(CUTS[:3])]
for name,zk,tr,te in splits:
  if name=='random': Z,Nn=S['Zall'],S['Nall']
  else: F=np.load(f'{pref}{name}.npz'); Z,Nn=F['Z'],F['N']
  sv,sl,sh=run(Z,Nn,tr); np.savez(f'pred_{tag}_{name}.npz',s=sv,lo=sl,hi=sh)
  for L in [0,1,2,'all']:
    m=te&np.isfinite(sv)&(e>0)&((lv9<3) if L=='all' else (lv9==L))
    out[f'{name}|{L}']=r=dict(n=int(m.sum()),mdape=round(E(sv,m),4),live=round(E(e,m),4),cov80=round(C(sl,sh,m),3))
    print(tag,name,L,r,flush=True)
json.dump(out,open(f'eval_{tag}.json','w'),indent=0)

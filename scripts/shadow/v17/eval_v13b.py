import numpy as np,json,sys,datetime,os
exec(open('fam.py').read())
from sklearn.ensemble import HistGradientBoostingRegressor as H
tag,base,pref,prmf,nosy=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],int(sys.argv[5])
S=np.load(base); M=np.load('meta_v11.npz'); TMU=S['TMU'].astype(float); TMISS=S['TMISS'].astype(float); lv9=np.load('../v9/sets_v9.npz')['lv']
lp,p,e,lo,hi,lv,f4,f5,TM=[S[k] for k in ['lp','p','e','lo','hi','lv','f4','f5','TM']]
yr=M['yr']; d=M['d']; sy=np.array([int(x[:4]) for x in d]); prm=json.load(open(prmf))
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
C=lambda l,u,m: float(((p[m]>=l[m])&(p[m]<=u[m])).mean())
def run(Z,Nn,MM,tr):
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float)
  CL,ed=clusters(CUTORD[0],EXCL,0.35,0.3,0.7); FF=feats(CL,Mv,DORD); l2=(lv==2)&np.isfinite(FF[:,0]); FAM.append((CL,int(l2.sum())))
  zs=np.where(l2,FF[:,0],z0); EXTRA0=[l2.astype(float),z0-zs]; z0=zs
  cols=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM]+([] if nosy else [sy])+[TMISS,TMU,MM]+EXTRA(tr,z0)+EXTRA0+[z0]; Xk=np.c_[tuple(cols)]
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
import json,collections,numpy as np
_Me=np.load('meta_v11.npz'); mk=_Me['mk']
_F=np.load('../v13b/feat_v13b_pit.npz'); TK=json.load(open('../v13/tok_v13.json'))
ATT=np.c_[_F['man'],_F['spd'],_F['cf'],_F['dt'],_F['bd']]
KS=20.
def tok_te(y,tr,fold):
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

def EXTRA(tr,z0):
  y=lp-z0; m=tr&(lv<3)&np.isfinite(z0)&(np.abs(y)<np.log(5))
  return [ATT,tok_te(np.where(m,y,0.),m,f4)]
Mv=M['v']; DORD=np.array([datetime.date.fromisoformat(x).toordinal() for x in d]); EXCL=set(Mv[f5==0]); CUTORD=[0]; FAM=[]
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']; out={}
splits=[('random','all',f5!=0,f5==0)]+[(c,c,d<c,(d>=c)&(d<CUTS[i+1])) for i,c in enumerate(CUTS[:3])]
for name,zk,tr,te in splits:
  if name=='random': Z,Nn,MM=S['Zall'],S['Nall'],S['Mall']
  else: F=np.load(f'{pref}{name}.npz'); Z,Nn,MM=F['Z'],F['N'],F['M']
  CUTORD[0]=datetime.date.fromisoformat('2099-01-01' if name=='random' else name).toordinal()
  sv,sl,sh=run(Z,Nn,MM,tr); np.savez(f'pred_{tag}_{name}.npz',s=sv,lo=sl,hi=sh)
  for L in [0,1,2,'all']:
    m=te&np.isfinite(sv)&(e>0)&((lv9<3) if L=='all' else (lv9==L))
    out[f'{name}|{L}']=r=dict(n=int(m.sum()),cov=round(float(m.sum()/max(1,(te&(e>0)&((lv9<3) if L=='all' else (lv9==L))).sum())),4),mdape=round(E(sv,m),4),live=round(E(e,m),4),cov80=round(C(sl,sh,m),3))
    print(tag,name,L,r,flush=True)
json.dump(out,open(f'eval_{tag}.json','w'),indent=0)
import pickle; pickle.dump(FAM,open('fam_cl_{}.pkl'.format(tag),'wb'))

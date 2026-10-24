# v23 eval = v21 eval + sel23 trend/wide-comp groups (F23.npy). Base text from v18 eval: v13b's model (eval_v13b.py run()) refit on v18 data (gross basis, Mecum comps+targets). Variant from sel18.json.
# Reports: old test set (v13b's f5==0 rows with live e>0, level = v9 level, exactly v13b's mask, restricted to rows whose
# event survived the v18 filters) on gross and hammer-equivalent basis, plus the new larger test set (old + Mecum f5==0),
# by level and platform, with coverage. v13b reference preds: v17/pred_v13brep_* (exact v13b reproduction).
import numpy as np,json,sys,os
F23P='F23.npy'; S23P='sel23.json'
from sklearn.ensemble import HistGradientBoostingRegressor as H
exec(open('common18.py').read())
F21=np.log1p(np.load('F21.npy')); S21=json.load(open('sel21.json')); G21={'G1_cond':[0,1,2],'G2_svc_prov_own':[3,4,5],'G3_seller':[7,8]}
X21=[F21[:,G21[g]] for g in S21['pick']]
F23=np.load(F23P); S23=json.load(open(S23P)); G23={'T_seg':[0,1,2],'T_fam':[3,4,5],'W_wide':[6,7,8,9]}
def X23(z0): return [np.c_[F23[:,G23[g]][:,0]-z0,F23[:,G23[g]][:,1:]] if g=='W_wide' else F23[:,G23[g]] for g in S23['pick']]
tag=sys.argv[1]; SEL=json.load(open('sel18.json')); pick=sys.argv[2] if len(sys.argv)>2 else SEL['pick']
fam_s=None if pick=='nofam' else float(pick[1:].split('_')[0])
EXCL=set(v[f5==0]); FAM=[]
def run(Z,Nn,MM,tr,cut_ord):
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float); EXTRA0=[]
  if fam_s is not None:
    CL,ed=clusters(cut_ord,EXCL,fam_s,0.3,0.7); FF=feats(CL,v,DORD); l2=(lv==2)&np.isfinite(FF[:,0]); FAM.append((CL,int(l2.sum())))
    zs=np.where(l2,FF[:,0],z0); EXTRA0=[l2.astype(float),z0-zs]; z0=zs
  y=lp-z0; m=tr&(lv<3)&np.isfinite(z0)&(np.abs(y)<np.log(5))
  cols=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS,TMU,MM,ATT,tok_te(np.where(m,y,0.),m,f4)]+X21+X23(z0)+EXTRA0+[z0]; Xk=np.c_[tuple(cols)]
  def fit(mm):
    mm=mm&(lv<3)&np.isfinite(z0); yy=lp-z0; mm&=np.abs(yy)<np.log(5)
    return H(loss='absolute_error',random_state=0,**prm).fit(Xk[mm],yy[mm])
  s=z0+fit(tr).predict(Xk); oof=np.full(len(p),np.nan)
  for k in range(4):
    mm=tr&(f4==k); oof[mm]=(z0+fit(tr&(f4!=k)).predict(Xk))[mm]
  sl=np.full(len(p),np.nan); sh=sl.copy(); Q={}
  for L in range(3):
    mm=tr&(lv==L)&np.isfinite(oof); q=np.quantile(lp[mm]-oof[mm],[.1,.9]); Q[L]=q.tolist(); w=lv==L; sl[w]=np.exp(s[w]+q[0]); sh[w]=np.exp(s[w]+q[1])
  return np.exp(s),sl,sh,Q
MdA=lambda z,y,m: float(np.median(np.abs(z[m]-y[m])/y[m])) if m.sum() else None
Cv=lambda l,u,y,m: float(((y[m]>=l[m])&(y[m]<=u[m])).mean()) if m.sum() else None
splits=[('random',f5!=0,f5==0)]+[(c,d<c,(d>=c)&(d<CUTS[i+1])) for i,c in enumerate(CUTS[:3])]
OLDN=50156; out={}; QS={}
for name,tr,te in splits:
  Z,Nn,MM=getsets(name); cut=od('2099-01-01' if name=='random' else name)
  sv,sl,sh,Q=run(Z,Nn,MM,tr,cut); QS[name]=Q; np.savez(f'pred_{tag}_{name}.npz',s=sv,lo=sl,hi=sh)
  # v13b reference on the same rows (old index), hammer basis -> gross via BaT fee
  R=np.load(f'/workspace/nuke-strategy/shadow/v17/pred_v13brep_{name}.npz'); r13=np.full(len(p),np.nan); r13[old>=0]=R['s'][old[old>=0]]
  r13g=r13+bat_fee(r13,d); sv_h=np.where(plat=='bat',bat_hammer(sv,d),sv/1.10)
  LVR=np.where(old>=0,lv9,lv)
  for L in [0,1,2,'all']:
    lvm=(LVR<3) if L=='all' else (LVR==L)
    elig_old=te&(old>=0)&(e>0)&lvm; m=elig_old&np.isfinite(sv)&np.isfinite(r13)
    out[f'{name}|old|{L}']=dict(n=int(m.sum()),cov=round(m.sum()/max(1,elig_old.sum()),4),
      v18_gross=round(MdA(sv,p,m),4),v13b_gross=round(MdA(r13g,p,m),4),v18_hammer_eq=round(MdA(sv_h,ph,m),4),v13b_hammer=round(MdA(r13,ph,m),4),
      live_hammer=round(MdA(e,ph,m),4),cov80=round(Cv(sl,sh,p,m),3))
    for pl_,pm in [('all',np.ones(len(p),bool)),('bat',plat=='bat'),('mecum',ismec)]:
      el=te&lvm&pm&((old<0)|(e>0)); mm=el&np.isfinite(sv)
      if el.sum()==0: continue
      out[f'{name}|new|{pl_}|{L}']=dict(n=int(mm.sum()),elig=int(el.sum()),cov=round(mm.sum()/el.sum(),4),v18_gross=round(MdA(sv,p,mm),4) if mm.sum() else None,cov80=round(Cv(sl,sh,p,mm),3) if mm.sum() else None)
  print(name,{k:v_ for k,v_ in out.items() if k.startswith(name) and k.endswith('|all')},flush=True)
json.dump(dict(pick=pick,out=out,quantiles=QS),open(f'eval_{tag}.json','w'),indent=0)
import pickle; pickle.dump(FAM,open(f'fam_cl_{tag}.pkl','wb'))

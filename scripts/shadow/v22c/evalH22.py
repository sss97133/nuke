# v18 eval: v13b's model (eval_v13b.py run()) refit on v18 data (gross basis, Mecum comps+targets). Variant from sel18.json.
# Reports: old test set (v13b's f5==0 rows with live e>0, level = v9 level, exactly v13b's mask, restricted to rows whose
# event survived the v18 filters) on gross and hammer-equivalent basis, plus the new larger test set (old + Mecum f5==0),
# by level and platform, with coverage. v13b reference preds: v17/pred_v13brep_* (exact v13b reproduction).
import numpy as np,json,sys,os
from sklearn.ensemble import HistGradientBoostingRegressor as H
exec(open('common18.py').read())
F21=np.log1p(np.load('F22H.npy')); S21=json.load(open('/workspace/v22c/run/sel22.json')); G21={'G1d_cond_desc':[0,1,2],'G1s_cond_seller_cmt':[3,4,5],'G1c_cond_commenter':[6,7,8],'G2_svc_prov_own':[9,10,11],'G3_seller':[13,14]}
X21=[F21[:,G21[g]] for g in S21['pick']] if sys.argv[3]=='claims' else []
tag=sys.argv[1]; pick=sys.argv[2]
fam_s=None if pick=='nofam' else float(pick[1:].split('_')[0])
EXCL=set(v[f5==0]); FAM=[]
def run(Z,Nn,MM,tr,cut_ord):
  z0=np.choose(np.minimum(lv,2),Z[:,:3].T).astype(float); EXTRA0=[]
  if fam_s is not None:
    CL,ed=clusters(cut_ord,EXCL,fam_s,0.3,0.7); FF=feats(CL,v,DORD); l2=(lv==2)&np.isfinite(FF[:,0]); FAM.append((CL,int(l2.sum())))
    zs=np.where(l2,FF[:,0],z0); EXTRA0=[l2.astype(float),z0-zs]; z0=zs
  y=lp-z0; m=tr&(lv<3)&np.isfinite(z0)&(np.abs(y)<np.log(5))
  cols=[Z-z0[:,None],np.log1p(Nn),lv,yr,TM,sy,TMISS,TMU,MM,ATT,tok_te(np.where(m,y,0.),m,f4)]+X21+EXTRA0+[z0]; Xk=np.c_[tuple(cols)]
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

fresh=np.array([bool(t.get('fresh')) for t in T]); assert (d[fresh]>='2026-05-01').all() and (d[~fresh]<'2026-05-01').all()
tr=d<'2026-05-01'; Z,Nn,MM=getsets('2026-05-01')
sv,sl,sh,Q=run(Z,Nn,MM,tr,od('2026-05-01')); np.savez(f'predH_{tag}.npz',s=sv,lo=sl,hi=sh); print(tag,'done',json.dumps(Q))

import json,numpy as np,sys
from sklearn.linear_model import QuantileRegressor
from sklearn.model_selection import KFold
sys.path.insert(0,'/workspace/v21'); import os; os.chdir('/workspace/v21')
T=json.load(open('targets18.json')); B=np.load('pred_v21_2025-07-01.npz')['s']; R=np.load('/workspace/nuke-strategy/shadow/v17/pred_v13brep_2025-07-01.npz')['s']
os.chdir('/workspace/img26'); S=json.load(open('sample.json')); SC=json.load(open('scores_v1.json'))['scores']
def fee(h,dd): return min(max(h*0.05,250),7500 if dd>='2024-01-29' else 5000)
rows=[]
for r in S:
  t=T[r['i']]; sc=SC.get(r['v'])
  if sc is None or t['old']<0: continue
  g13=R[t['old']]+fee(R[t['old']],t['d']); s=np.exp(.75*np.log(B[r['i']])+.25*np.log(g13))
  rows.append((t['p'],s,sc['cond'],sc['orig'],sc['conf'],r['seg']))
p,s,c,o,cf=[np.array([x[k] for x in rows]) for k in range(5)]; y=np.log(p/s); n=len(y)
X={'intercept':np.zeros((n,0)),'cond':c[:,None],'cond+orig':np.c_[c,o],'cond+orig+conf':np.c_[c,o,c*cf]}
mda=lambda z: float(np.median(np.abs(z-p)/p))
res={'n':n,'base_v21':round(mda(s),4)}; preds={}
for rep in range(20):
  for k,Xk in X.items():
    ph=np.zeros(n)
    for tr,te in KFold(10,shuffle=True,random_state=rep).split(y):
      q=QuantileRegressor(quantile=.5,alpha=0,solver='highs').fit(Xk[tr] if Xk.shape[1] else np.zeros((len(tr),1)),y[tr])
      ph[te]=q.predict(Xk[te] if Xk.shape[1] else np.zeros((len(te),1)))
    preds.setdefault(k,[]).append(s*np.exp(ph))
for k in X: res[k]=round(float(np.mean([mda(z) for z in preds[k]])),4)
# paired bootstrap of (cond+orig) vs intercept-only on held-out preds (rep 0)
rng=np.random.default_rng(0); a=np.abs(preds['cond+orig'][0]-p)/p; b=np.abs(preds['intercept'][0]-p)/p
bs=[np.median(a[i])-np.median(b[i]) for i in (rng.integers(0,n,n) for _ in range(2000))]
res['delta_cond_orig_vs_intercept']=round(float(np.median(a)-np.median(b)),4); res['ci95']=[round(float(x),4) for x in np.percentile(bs,[2.5,97.5])]
res['corr_resid_cond']=round(float(np.corrcoef(y,c)[0,1]),3); res['corr_resid_orig']=round(float(np.corrcoef(y,o)[0,1]),3)
res['spearman_cond_logp_vs_pred']=round(float(np.corrcoef(np.argsort(np.argsort(c)),np.argsort(np.argsort(y)))[0,1]),3)
print(json.dumps(res)); json.dump(res,open('heldout_v1.json','w'),indent=0)

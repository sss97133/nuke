import numpy as np,json
exec(open('gbm_v10.py').read().split('grid=')[0])
prm=json.load(open('gbm_best.json'))
oof=np.full(len(p),np.nan)
for k in range(4):
  tr=~te&(f4!=k); z=fitpred(tr,k,prm); m=~te&(f4==k); oof[m]=z[m]
s=fitpred(~te,'all',prm)
Q={}; slo=np.full(len(p),np.nan); shi=slo.copy()
for L in range(3):
  m=~te&(lv==L)&np.isfinite(oof); Q[L]=[float(x) for x in np.quantile(lp[m]-oof[m],[.1,.9])]
  mm=lv==L; slo[mm]=np.exp(s[mm]+Q[L][0]); shi[mm]=np.exp(s[mm]+Q[L][1])
sv=np.exp(s); C=lambda l,u,m: float(((p[m]>=l[m])&(p[m]<=u[m])).mean())
E=lambda z,m: float(np.median(np.abs(z[m]-p[m])/p[m]))
rep={}
for L in [0,1,2,'all']:
  m=te&np.isfinite(s)&(e>0)&((lv<3) if L=='all' else (lv==L))
  rep[str(L)]=dict(n=int(m.sum()),v9=round(E(sv,m),4),live=round(E(e,m),4),cov80_v9=round(C(slo,shi,m),3),cov80_live=round(C(lo,hi,m),3),width_v9=round(float(np.median((shi[m]-slo[m])/sv[m])),2))
  print(L,rep[str(L)])
json.dump(dict(gbm=prm,q=Q,held=rep),open('model_v10.json','w'))
np.savez('pred_v10.npz',s=sv,lo=slo,hi=shi)

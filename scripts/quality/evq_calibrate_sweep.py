import numpy as np,json
exec(open('fit_evq.py').read().split("Sp=score(w0,s0)")[0])
from scipy.optimize import minimize
def hub(r,d=0.15): a=np.abs(r); return np.where(a<d,0.5*r*r,d*(a-0.5*d))
def fit2(m,lam):
    def L(x):
        w,s_,a,b=unpack(x); return np.mean(hub(y[m]-(a+b*score(w,s_)/100)[m]))+lam*np.mean(x[:2*K]**2)
    return minimize(L,np.r_[np.zeros(2*K),np.median(y[m]),-0.3],method='L-BFGS-B',options=dict(maxiter=3000))
res={}
for lam in [0,0.0005,0.002,0.01,0.05]:
    r=fit2(fold<1,lam); w,s_,a,b=unpack(r.x); S1=score(w,s_)
    d1=dec(S1,fold==1)
    res[lam]=(d1['rho_row_score_err'],d1['adjacent_increases'],d1['bottom_minus_top'])
    print(lam,res[lam],np.round(w,1).tolist(),np.round(s_,1).tolist(),flush=True)
best=min(res,key=lambda l:res[l][0]); print('chosen lam (fold1 only)',best)
Sc=np.full(len(R),np.nan); fits=[]
for k in [1,2]:
    r=fit2(fold<k,best); w,s_,a,b=unpack(r.x); Sc[fold==k]=score(w,s_)[fold==k]; fits.append(dict(test_fold=k,b=round(float(b),4),w=dict(zip(T,np.round(w,2).tolist())),sat=dict(zip(T,np.round(s_,2).tolist()))))
Sp=score(w0,s0); te=fold>=1
rf=fit2(np.ones(len(R),bool),best); w,s_,a,b=unpack(rf.x)
out=dict(lam=best,sweep_fold1={str(k):v for k,v in res.items()},prior=dec(Sp,te),cal=dec(Sc,te),prior_f2=dec(Sp,fold==2),cal_f2=dec(Sc,fold==2),fits=fits,
  final=dict(a=float(a),b=float(b),w=dict(zip(T,np.round(w,3).tolist())),sat=dict(zip(T,np.round(s_,3).tolist()))))
json.dump(out,open('fit_out2.json','w'),indent=1)
for k in ['prior','cal','prior_f2','cal_f2']: print(k,json.dumps({x:out[k][x] for x in ['med_abs_log_err','spearman_decile_vs_err','adjacent_increases','bottom_minus_top','rho_row_score_err','rho_row_score_width','cov80']}))
print(json.dumps(out['final']))

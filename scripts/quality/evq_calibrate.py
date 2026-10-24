# evq calibration v2: fit weight/saturation per evidence type (trust + half-life stay cited priors) so the score
# predicts v21 forward out-of-sample abs log error. Rolling origin: fit on folds < k, evaluate on fold k.
import json,numpy as np
from scipy.optimize import minimize
from scipy.stats import spearmanr,rankdata
C={v:c for v,c in json.load(open('comps.json'))}
P={r['source_type']:r for r in json.load(open('priors.json'))}
R=[r for r in json.load(open('calib_rows.json')) if r['v'] in C]
T=[t for t in P if P[t]['weight']>0]
g=lambda r,t,k: C[r['v']][t][k]
n=np.array([[g(r,t,'n') for t in T] for r in R],float); eff=np.array([[g(r,t,'eff') for t in T] for r in R],float)
tr=np.array([[g(r,t,'trust') if g(r,t,'trust') is not None else (P[t]['trust'] or 0) for t in T] for r in R],float)
app=np.array([P[t]['applies_when']=='always' for t in T])[None,:]|(n>0)
w0=np.array([P[t]['weight'] for t in T],float); s0=np.array([P[t]['saturation_n'] for t in T],float)
A=lambda k: np.array([r[k] for r in R])
p,sv,lo,hi=A('p'),A('s'),A('lo'),A('hi'); y=np.abs(np.log(sv/p)); wid=np.log(hi/lo); cov=(p>=lo)&(p<=hi); fold=A('fold'); lvl=A('lv')
def score(w,s):
    return 100*(w*tr*(1-np.exp(-eff/s))*app).sum(1)/(w*app).sum(1)
K=len(T); LAM=0.02
def unpack(x): return w0*np.exp(np.clip(x[:K],-5,5)), s0*np.exp(np.clip(x[K:2*K],-5,5)), x[-2], x[-1]
def loss(x,m):
    w,s_,a,b=unpack(x); pred=a+b*score(w,s_)/100
    return np.mean(np.abs(y[m]-pred[m]))+LAM*np.mean(x[:2*K]**2)
def fit(m):
    best=None
    for b0 in [-0.1,-0.4]:
        r=minimize(loss,np.r_[np.zeros(2*K),np.median(y[m]),b0],args=(m,),method='Powell',options=dict(maxiter=40000,xtol=1e-4,ftol=1e-8))
        if best is None or r.fun<best.fun: best=r
    return best
def dec(S,m):
    rk=rankdata(S[m],method='ordinal'); q=np.minimum((rk-1)*10//len(rk),9)
    md=[float(np.median(y[m][q==k])) for k in range(10)]
    return dict(med_abs_log_err=[round(v,4) for v in md],width=[round(float(np.median(wid[m][q==k])),3) for k in range(10)],
      cov80=[round(float(cov[m][q==k].mean()),3) for k in range(10)],score_min=[round(float(S[m][q==k].min()),1) for k in range(10)],
      n_distinct_scores=int(len(np.unique(np.round(S[m],2)))),
      spearman_decile_vs_err=round(float(spearmanr(range(10),md)[0]),3),adjacent_increases=int(sum(md[k+1]>md[k] for k in range(9))),
      bottom_minus_top=round(md[0]-md[9],4),rho_row_score_err=round(float(spearmanr(S[m],y[m])[0]),4),rho_row_score_width=round(float(spearmanr(S[m],wid[m])[0]),4))
Sp=score(w0,s0); Sc=np.full(len(R),np.nan); fits=[]
for k in [1,2]:
    r=fit(fold<k); w,s_,a,b=unpack(r.x); Sc[fold==k]=score(w,s_)[fold==k]
    fits.append(dict(test_fold=k,train_n=int((fold<k).sum()),b=round(b,4),w=dict(zip(T,np.round(w,2).tolist())),sat=dict(zip(T,np.round(s_,2).tolist()))))
te=fold>=1
out=dict(n=len(R),folds={int(k):int((fold==k).sum()) for k in range(3)},forward_test_n=int(te.sum()),
  prior=dec(Sp,te),calibrated_forward=dec(Sc,te),
  per_fold={int(k):dict(prior=dec(Sp,fold==k),cal=dec(Sc,fold==k)) for k in [1,2]},fits=fits)
rf=fit(np.ones(len(R),bool)); w,s_,a,b=unpack(rf.x)
out['final']=dict(a=round(a,4),b=round(b,4),loss=round(float(rf.fun),5),w=dict(zip(T,np.round(w,3).tolist())),sat=dict(zip(T,np.round(s_,3).tolist())))
out['coverage_types']={t:int((n[:,i]>0).sum()) for i,t in enumerate(T)}
out['err_by_level']={int(L):[int((te&(lvl==L)).sum()),round(float(np.median(y[te&(lvl==L)])),4)] for L in range(3) if (te&(lvl==L)).sum()}
out['width_by_level']={int(L):round(float(np.median(wid[lvl==L])),3) for L in range(3) if (lvl==L).sum()}
json.dump(out,open('fit_out.json','w'),indent=1)
for k in ['n','folds','forward_test_n','coverage_types','err_by_level','width_by_level','final']: print(k,json.dumps(out[k]))
for k in ['prior','calibrated_forward']: print(k,json.dumps(out[k]))
for f in fits: print(json.dumps(f))

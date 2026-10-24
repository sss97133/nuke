import numpy as np,json
exec(open('sweep.py').read().split("res={}")[0])
from scipy.stats import spearmanr
o=json.load(open('fit_out2.json')); lam=o['lam']
Sc=np.full(len(R),np.nan)
for k in [1,2]:
    r=fit2(fold<k,lam); w,s_,a,b=unpack(r.x); Sc[fold==k]=score(w,s_)[fold==k]
Sp=score(w0,s0); rng=np.random.default_rng(0)
for nm,m in [('fwd',fold>=1),('f2',fold==2)]:
    ix=np.flatnonzero(m); D=[]
    for _ in range(1000):
        b_=rng.choice(ix,len(ix)); D.append(spearmanr(Sc[b_],y[b_])[0]-spearmanr(Sp[b_],y[b_])[0])
    print(nm,'rho diff cal-prior',round(float(np.mean(D)),4),np.round(np.percentile(D,[2.5,97.5]),4).tolist())

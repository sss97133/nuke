# v23 fresh hold-out (sales 2026-05-01..2026-10-23): v23 blend vs v21 blend (v23c/run/predH_v21base.npz, scored with c2301 claims)
# and vs v13b. Frozen sel23 pick, frozen sel19 blend weights, one refit on sales before 2026-05-01, no tuning.
# Paired bootstrap 2000 (seed 0). Pre-registered pass: overall v23-v21 MdAPE difference with its whole 95% CI below 0.
import json,numpy as np
T=json.load(open('targets18.json')); S=np.load('sets18.npz'); lv=S['lv']; p=S['p']
fresh=np.array([bool(t.get('fresh')) for t in T]); pl=np.array([t['pl'] for t in T]); d=np.array([t['d'] for t in T])
B=np.load('/workspace/v23c/run/predH_v13b.npz')['s']; A23=np.load('predH_v23base.npz')['s']; A21=np.load('/workspace/v23c/run/predH_v21base.npz')['s']
W={0:.25,1:.75,2:.5}; w=np.array([W.get(int(min(L,2)),1.) for L in lv]); bl=lambda A: np.exp(w*np.log(A)+(1-w)*np.log(B))
V23,V21=bl(A23),bl(A21); ok=fresh&(lv<3)&np.isfinite(V23)&np.isfinite(V21)&np.isfinite(B)
rng=np.random.default_rng(0)
def stat(m,K=2000):
  ix=np.flatnonzero(m); e=lambda X: np.abs(X[ix]-p[ix])/p[ix]; a,b,c=e(V23),e(V21),e(B)
  bs=np.array([(np.median(a[j]),np.median(b[j]),np.median(c[j])) for j in (rng.integers(0,len(ix),len(ix)) for _ in range(K))])
  r=lambda x: round(float(x),4); ci=lambda x: np.percentile(x,[2.5,97.5]).round(4).tolist()
  return dict(n=len(ix),v23=r(np.median(a)),v21=r(np.median(b)),v13b=r(np.median(c)),d_v21=r(np.median(a)-np.median(b)),d_v21_ci=ci(bs[:,0]-bs[:,1]),
    d_v13b=r(np.median(a)-np.median(c)),d_v13b_ci=ci(bs[:,0]-bs[:,2]),v23_unblended=r(np.median(e(A23))),v21_unblended=r(np.median(e(A21))))
out={'all':stat(ok)}
for L in range(3): out[f'L{L}']=stat(ok&(lv==L))
for h in ['bat','cars_and_bids']: out[h]=stat(ok&(pl==h)) if (ok&(pl==h)).sum()>=20 else dict(n=int((ok&(pl==h)).sum()))
for mo in sorted(set(x[:7] for x in d[ok])): out[mo]=stat(ok&np.char.startswith(d.astype(str),mo),1000)
o=out['all']; out['passes_v21']=o['d_v21_ci'][1]<0; out['register']=out['passes_v21']
json.dump(out,open('fresh_holdout_v23.json','w'),indent=0)
for k,v in out.items(): print(k,v)

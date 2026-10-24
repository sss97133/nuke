# fresh hold-out (sales 2026-05-01..2026-10-23, never scored by any version). Both recipes refit once on all sales before
# 2026-05-01, frozen settings, no tuning. v21 = exp(w*log v21base + (1-w)*log v13b) with frozen v19 weights.
import json,numpy as np
T=json.load(open('targets18.json')); S=np.load('sets18.npz'); lv=S['lv']; p=S['p']
fresh=np.array([bool(t.get('fresh')) for t in T]); pl=np.array([t['pl'] for t in T]); d=np.array([t['d'] for t in T])
A=np.load('predH_v21base.npz')['s']; B=np.load('predH_v13b.npz')['s']
W={0:.25,1:.75,2:.5}; w=np.array([W.get(int(min(L,2)),1.) for L in lv]); V21=np.exp(w*np.log(A)+(1-w)*np.log(B))
ok=fresh&(lv<3)&np.isfinite(V21)&np.isfinite(B)
rng=np.random.default_rng(0)
def stat(m,K=2000):
  ix=np.flatnonzero(m); a=np.abs(V21[ix]-p[ix])/p[ix]; b=np.abs(B[ix]-p[ix])/p[ix]; c=np.abs(A[ix]-p[ix])/p[ix]
  bs=np.array([(np.median(a[j]),np.median(b[j])) for j in (rng.integers(0,len(ix),len(ix)) for _ in range(K))])
  dd=bs[:,0]-bs[:,1]
  return dict(n=len(ix),v21=round(float(np.median(a)),4),v21_ci=np.percentile(bs[:,0],[2.5,97.5]).round(4).tolist(),
    v13b=round(float(np.median(b)),4),v13b_ci=np.percentile(bs[:,1],[2.5,97.5]).round(4).tolist(),
    diff=round(float(np.median(a)-np.median(b)),4),diff_ci=np.percentile(dd,[2.5,97.5]).round(4).tolist(),p_v21_better=round(float((dd<0).mean()),3),
    v21_unblended=round(float(np.median(c)),4))
out={'all':stat(ok)}
for L in range(3): out[f'L{L}']=stat(ok&(lv==L))
for h in ['bat','cars_and_bids','mecum']:
  if (ok&(pl==h)).sum()>=20: out[h]=stat(ok&(pl==h))
  else: out[h]=dict(n=int((ok&(pl==h)).sum()),note='too few to score')
for h in ['bat']:
  for L in range(3): out[f'{h}|L{L}']=stat(ok&(pl==h)&(lv==L))
for mo in sorted(set(x[:7] for x in d[ok])): out[mo]=stat(ok&(np.char.startswith(d.astype(str),mo)),500)
out['coverage']=dict(fresh_rows=int(fresh.sum()),scored=int(ok.sum()),level3_unscored=int((fresh&(lv>=3)).sum()),dates=[min(d[fresh]),max(d[fresh])])
json.dump(out,open('fresh_holdout.json','w'),indent=0)
for k,v in out.items(): print(k,v)

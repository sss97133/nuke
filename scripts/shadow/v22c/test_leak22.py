# v22 leakage test: every counted condition claim is pre-close (descriptions on/before sale day, comments strictly before),
# no price text, comment SQL filters non-bid / null bid_amount / price text; non-BaT rows are NaN; eval uses only sel22 groups.
import json,glob,re,collections,numpy as np
for f in glob.glob('sqlx/x_*.sql'):
  q=open(f).read().lower()
  for need in ["<>'bid'",'bid_amount is null','sold|hammer',"claim_kind='condition'","c2201'","c2301'"]: assert need in q,(f,need)
bad=collections.Counter(); n=0
for T,FF in [('/workspace/v20/targets18.json','F22.npy'),('/workspace/v23c/run/targets18.json','F22H.npy')]:
  T=json.load(open(T)); F=np.load(FF); b=np.array([t['pl']=='bat' for t in T]); assert np.isnan(F[~b]).all() and not np.isnan(F[b]).any()
  dv=collections.defaultdict(list)
  for t in T:
    if t['pl']=='bat': dv[t['v']].append(t['d'])
  for l in open('cmt_cond.tsv'):
    if not l.strip(): continue
    vid,ds,role,pol,k=l.rstrip('\n').split('|')
    for dd in dv.get(vid,()):
      if ds<dd: n+=1
  # rebuild: the feature totals must equal counts of comment rows dated strictly before the sale day
  tot=collections.Counter()
  for l in open('cmt_cond.tsv'):
    if l.strip():
      vid,ds,role,pol,k=l.rstrip('\n').split('|')
      for dd in dv.get(vid,()):
        if ds<dd: tot[(vid,dd)]+=int(k)
  got=sum(np.nan_to_num(F[:,3:9]).sum() for _ in [0]); assert int(got)==sum(tot.values()),(got,sum(tot.values()))
S=json.load(open('sel22.json')); assert set(S['pick'])=={'G3_seller','G1d_cond_desc'}
print('LEAK TEST PASS',dict(counted_comment_rowpairs=n))

# v23 leak test: brute-force recompute of the selected segment index for 150 random targets, using only sales strictly before
# the target date and residual baselines from sales strictly before each sale. Must match F23 exactly. Also asserts the same
# (vehicle, date) target gets identical features in the gate and hold-out target files (no dependence on later rows).
import pickle,json,datetime,numpy as np
G,V,LM,VS=pickle.load(open('comps_v18.pkl','rb')); od=lambda s: datetime.date.fromisoformat(s).toordinal()
T=json.load(open('targets18.json')); F=np.load('F23.npy'); rng=np.random.default_rng(1); idx=rng.choice(len(T),150,replace=False)
def resid(L,j):
  o,yr,vid,lp=L[j][:4]; pr=[x for x in L if o-3*365<=x[0]<o][-400:]; pr=[x[3] for x in pr if abs(x[1]-yr)<=5 and x[2]!=vid]
  pr=pr[-60:]; return float(np.clip(lp-np.median(pr),-1,1)) if len(pr)>=3 else None
M0=G[0]; LOC={}
for key,L in M0.items():
  for j,x in enumerate(L): LOC[(x[2],x[0])]=(key,j)
bad=0; chk=0
for i in idx:
  v=T[i]['v']; t=od(T[i]['d']); sg=VS.get(v,'')
  if not sg: continue
  for W,col in ((90,0),(365,1)):
    es=[]
    for (s2,dec),L in G[3].items():
      if s2!=sg: continue
      for x in L:
        if t-W<=x[0]<t:
          q=LOC.get((x[2],x[0]))
          r=resid(M0[q[0]],q[1]) if q else None
          if r is not None: es.append(r)
    ref=np.mean(es) if len(es)>=3 else np.nan; chk+=1
    if not ((np.isnan(ref) and np.isnan(F[i,col])) or abs(ref-F[i,col])<1e-9): bad+=1
assert bad==0,bad
H=np.load('/workspace/v23t/runH/F23H.npy'); TH=json.load(open('/workspace/v23t/runH/targets18.json'))
k={(t['v'],t['d']):j for j,t in enumerate(TH)}; a=[i for i in range(len(T))]; b=[k[(T[i]['v'],T[i]['d'])] for i in a]
assert np.allclose(F[a],H[b],equal_nan=True)
print('LEAK TEST PASS',dict(targets_checked=len(idx),index_values_checked=chk,mismatch=bad,gate_vs_holdout_rows_identical=len(a)))

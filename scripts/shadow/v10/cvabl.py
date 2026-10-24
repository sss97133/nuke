import numpy as np,json,sys
exec(open('gbm_v10.py').read().split('grid=')[0])
S9=np.load('../v9/sets_v9.npz'); prm=json.load(open('gbm_best.json'))
Sd={k:S[k] for k in S.files}
def variant(cols,tm9):
  global S,TM
  D=dict(Sd)
  for k in ['0','1','2','3','all']:
    Z=D[f'Z{k}'].copy(); N=D[f'N{k}'].copy()
    for c in cols: Z[:,c]=S9[f'Z{k}'][:,c]; N[:,c]=S9[f'N{k}'][:,c]
    D[f'Z{k}']=Z; D[f'N{k}']=N
  S=D; TM=S9['TM'] if tm9 else Sd['TM']
  sc={L:[] for L in range(3)}
  for k in range(4):
    tr=~te&(f4!=k); va=~te&(f4==k); z=fitpred(tr,k,prm)
    for L in range(3): sc[L].append(A(z,va&(lv==L)&np.isfinite(z)))
  s={L:round(float(np.mean(sc[L])),4) for L in sc}; tot=sum(s[L]*(lv[~te]==L).sum() for L in s)/(lv[~te]<3).sum()
  return s,round(tot,4)
for name,cols,tm9 in [('v10',[],0),('v10+v9seg',[3],0),('v10+v9fam',[1],0),('v10+v9 fam,seg',[1,3],0),('v9 sets,pitTM',[0,1,2,3,4],0),('v10 sets,curTM',[],1)]:
  print(name,*variant(cols,tm9),flush=True)

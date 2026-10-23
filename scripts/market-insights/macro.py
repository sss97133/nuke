"""Macro factor lead/lag + out-of-sample test. Input: engine_out.json index, macro/*.csv (FRED, Manheim)."""
import json,csv,math,collections,numpy as np,openpyxl
R='/workspace/nuke-strategy/'
o=json.load(open('engine_out.json'))
idx={k:math.log(v) for k,v in o['index_all'].items()}
def fred(s,agg='mean'):
  d=collections.defaultdict(list)
  for r in csv.DictReader(open(R+f'macro/{s}.csv')):
    v=r[s]
    if v in('','.'):continue
    d[r['observation_date'][:7]].append(float(v))
  return {k:sum(v)/len(v) for k,v in d.items()}
F={'M2 money supply':('M2SL','log'),'Fed funds rate':('FEDFUNDS','lvl'),'10-year Treasury yield':('DGS10','lvl'),'Real 10-year yield (TIPS)':('DFII10','lvl'),'Personal savings rate':('PSAVERT','lvl'),'Nasdaq Composite':('NASDAQCOM','log'),'S&P 500':('SP500','log'),'Consumer sentiment (U. Michigan)':('UMCSENT','lvl'),'CPI used cars & trucks':('CUSR0000SETA02','log'),'Unemployment rate':('UNRATE','lvl'),'Top 1% net worth (Fed DFA)':('WFRBLT01026','log'),'Top 1% share of wealth':('WFRBST01134','lvl'),'High-yield credit spread':('BAMLH0A0HYM2','lvl')}
S={}
for n,(s,t) in F.items():
  x=fred(s)
  if s.startswith('WFRB'):  # quarterly: carry forward to months in quarter
    y={}
    for k,v in x.items():
      yy,mm=int(k[:4]),int(k[5:])
      for j in range(3): y[f'{yy}-{mm+j:02d}']=v
    x=y
  S[n]=({k:math.log(v) for k,v in x.items()} if t=='log' else x,t)
wb=openpyxl.load_workbook(R+'macro/manheim.xlsx',data_only=True); ws=wb['DATA']
S['Manheim wholesale used-car index']=({r[0].strftime('%Y-%m'):math.log(r[1]) for r in ws.iter_rows(min_row=2,values_only=True) if r[0] and r[1]},'log')
months=sorted(idx); 
def mi(k): return int(k[:4])*12+int(k[5:])-1
def lab(m): return f'{m//12}-{m%12+1:02d}'
# smooth index (3-mo trailing mean of log) to cut sampling noise; 12-mo change
I={mi(k):v for k,v in idx.items()}
Is={m:np.mean([I[m-j] for j in range(3) if m-j in I]) for m in I if all(m-j in I for j in range(3))}
def chg(d,m,h=12): return d[m]-d[m-h] if m in d and m-h in d else None
def fchg(n,m,h=12):
  d,t=S[n]; a,b=d.get(lab(m)),d.get(lab(m-h))
  return None if a is None or b is None else a-b
Y={m:chg(Is,m) for m in Is if chg(Is,m) is not None}
lead={}
for n in S:
  best=None; row={}
  for L in range(0,25,3):
    pts=[(Y[m],fchg(n,m-L)) for m in Y if fchg(n,m-L) is not None]
    if len(pts)<36: continue
    a=np.array(pts); r=np.corrcoef(a[:,0],a[:,1])[0,1]; row[L]=(round(float(r),3),len(pts))
  lead[n]=row
# effective-sample note: overlapping 12-mo changes -> ~n/12 independent obs
# OOS: target = index change over NEXT 6 months; predictors known at t: factor 12-mo change. lag choice by training corr only.
H=6
T={m:Is[m+H]-Is[m] for m in Is if m+H in Is}
cut=2021*12+11
train=[m for m in T if m+H<=cut]; test=[m for m in T if m>cut]
def feat(n,m): return fchg(n,m)
sel=[]
for n in S:
  pts=[(T[m],feat(n,m)) for m in train if feat(n,m) is not None]
  if len(pts)<48: continue
  a=np.array(pts); r=np.corrcoef(a[:,0],a[:,1])[0,1]; sel.append((abs(r),n,r,len(pts)))
sel.sort(reverse=True)
res={'train_corr':[(n,round(float(r),3),k) for _,n,r,k in sel]}
def evalmodel(names):
  tr=[m for m in train if all(feat(n,m) is not None for n in names)]
  te=[m for m in test if all(feat(n,m) is not None for n in names)]
  X=np.array([[1]+[feat(n,m) for n in names] for m in tr]); y=np.array([T[m] for m in tr])
  # ridge with small penalty, standardized; lambda fixed at 1 (per-feature unit variance) to avoid tuning on test
  mu=X[:,1:].mean(0); sd=X[:,1:].std(0); Z=np.c_[np.ones(len(X)),(X[:,1:]-mu)/sd]
  lam=np.eye(Z.shape[1])*1.0; lam[0,0]=0; beta=np.linalg.solve(Z.T@Z+lam,Z.T@y)
  Xt=np.array([[feat(n,m) for n in names] for m in te]); Zt=np.c_[np.ones(len(Xt)),(Xt-mu)/sd]
  pred=Zt@beta; yt=np.array([T[m] for m in te])
  naive0=np.zeros_like(yt); naivemom=np.array([Is[m]-Is[m-H] for m in te])
  mae=lambda p:float(np.mean(np.abs(p-yt)))*100
  return dict(factors=names,n_train=len(tr),n_test=len(te),mae_model=round(mae(pred),2),mae_nochange=round(mae(naive0),2),mae_momentum=round(mae(naivemom),2),
    beta={n:round(float(b),4) for n,b in zip(names,beta[1:])},series=[(lab(m),round(float(p)*100,2),round(float(a)*100,2)) for m,p,a in zip(te,pred,yt)])
res['oos']={k:evalmodel([s[1] for s in sel[:k]]) for k in (1,2,3,5)}
# current read: latest factor 12-mo change, percentile vs 2010+ history, and model forecast
cur={}
for n in S:
  ms=[m for m in range(2010*12,2027*12) if fchg(n,m) is not None]
  if not ms: continue
  last=ms[-1]; v=fchg(n,last); hist=[fchg(n,m) for m in ms]
  pct=float(np.mean([h<=v for h in hist])); 
  # similar past months: within +-10 pct
  sim=[m for m in ms if abs(np.mean([h<=fchg(n,m) for h in hist])-pct)<0.1 and m+H in Is and m in Is]
  fwd=[ (Is[m+H]-Is[m])*100 for m in sim]
  cur[n]=dict(asof=lab(last),chg12=round(v*(100 if S[n][1]=='log' else 1),2),unit='%' if S[n][1]=='log' else 'pts',pctile=round(pct,2),fwd6_median=round(float(np.median(fwd)),1) if fwd else None,fwd6_iqr=[round(float(np.percentile(fwd,25)),1),round(float(np.percentile(fwd,75)),1)] if fwd else None,n_sim=len(fwd))
res['current']=cur
# forecast now with best k model refit on all data
best=min(res['oos'].values(),key=lambda r:r['mae_model'])
names=best['factors']; allm=[m for m in T if all(feat(n,m) is not None for n in names)]
X=np.array([[feat(n,m) for n in names] for m in allm]); y=np.array([T[m] for m in allm]); mu=X.mean(0);sd=X.std(0)
Z=np.c_[np.ones(len(X)),(X-mu)/sd]; lam=np.eye(Z.shape[1]);lam[0,0]=0; beta=np.linalg.solve(Z.T@Z+lam,Z.T@y)
lastm=max(m for m in Is if all(feat(n,m) is not None for n in names)); z=np.r_[1,(np.array([feat(n,lastm) for n in names])-mu)/sd]
resid=y-Z@beta
res['forecast']=dict(asof=lab(lastm),factors=names,next6_pct=round(float(z@beta)*100,1),band80=[round(float(z@beta+np.percentile(resid,10))*100,1),round(float(z@beta+np.percentile(resid,90))*100,1)])
res['lead']=lead
res['index_s']={lab(m):round(math.exp(v),3) for m,v in Is.items()}
res['factor_yoy']={n:{lab(m):round(fchg(n,m),4) for m in range(2012*12,2027*12) if fchg(n,m) is not None} for n in S}
# run-up / cooldown decomposition: contribution = beta_std * z over each window using full-sample fit on top-5 factors
json.dump(res,open('macro_out.json','w'))
print(json.dumps({k:v for k,v in res.items() if k in('train_corr','forecast')},indent=0)[:3000])
for k,v in res['oos'].items(): print(k,{x:v[x] for x in v if x!='series'})
for n,r in lead.items(): print(n, max(r.items(),key=lambda kv:abs(kv[1][0])) if r else None)

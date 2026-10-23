import json,re,numpy as np,hashlib,bisect,collections,resource
files=["dad68dcf-227e-4c46-8c02-f0798c6f9e9c","bb169f83-d367-46fe-b00a-56b3b0e211d6","7b7b3951-3cbe-4710-ba0e-05905e9866e2","4945d9ae-823b-449a-8490-8cafc96c3b70"]
G=collections.defaultdict(list); V={}
for f in files:
    t=open(f"/workspace/agent-tools/{f}.txt").read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    s=json.loads(re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S).group(1))[0]['s']
    for line in s.split('\n'):
        parts=line.split('|')
        if len(parts)!=9: continue
        vid,mk,md,yr,pl,d,cur,h,g=parts
        if not yr: continue
        yr=int(yr)
        if pl=='bat': V.setdefault(vid,(mk,md,yr))
        if cur=='USD': G[(mk,md)].append((d,yr,vid,float(h),pl))
for k in G: G[k].sort()
R=json.load(open('rows.json'))
def h5(v): return int(hashlib.md5(v.encode()).hexdigest()[:8],16)%5
def batfee(hm,d):
    cap=7500 if d>='2024-01-29' else 5000
    return min(max(hm*0.05,250),cap)
out=[]
for r in R:
    v=r['v']; 
    if v not in V or not r['d']: continue
    mk,md,yr=V[v]; L=G.get((mk,md),[])
    i=bisect.bisect_left(L,(r['d'],)) # strictly before sale date
    c=[x for x in L[max(0,i-400):i] if abs(x[1]-yr)<=3 and x[2]!=v][-40:]
    if len(c)<3: continue
    pls=collections.Counter(x[4] for x in c)
    out.append(dict(r,base=float(np.median([x[3] for x in c])),nc=len(c),pls=dict(pls)))
print('targets with >=3 point-in-time hammer comps',len(out),'of',len(R),'maxrss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)
F=['fc','fo','fd','fr','fw','fi']
X=np.array([[1]+[float(r[k] or 0) for k in F] for r in out]); p=np.array([r['p'] for r in out],float)
b0=np.array([r['base'] for r in out]); e=np.array([float(r['e']) for r in out]); lo=np.array([float(r['lo'] or 0) for r in out]); hi=np.array([float(r['hi'] or 0) for r in out])
ns=np.array([min(r['ns'] or 0,2) for r in out]); te=np.array([h5(r['v'])==0 for r in out])
y=np.log(p/b0); tr=~te&(np.abs(y)<np.log(5))
lam=10*np.eye(X.shape[1]); lam[0,0]=0
b=np.linalg.solve(X[tr].T@X[tr]+lam,X[tr].T@y[tr])
names=['intercept','f_condition','f_originality','f_documented_work','f_records','f_ownership','f_identity']
res=y-X@b; q={str(k):[float(a) for a in np.quantile(res[tr&(ns==k)],[.1,.9])] for k in range(3)}; q['3']=q['2']
s=b0*np.exp(X@b); slo=s*np.exp([q[str(k)][0] for k in ns]); shi=s*np.exp([q[str(k)][1] for k in ns])
# comp-only (no evidence), same intercept refit, to isolate the evidence contribution
a0=np.median(y[tr]); sc=b0*np.exp(a0)
def rep(m,name):
  A=lambda z: np.median(np.abs(z[m]-p[m])/p[m])
  cl=((p[m]>=lo[m])&(p[m]<=hi[m])).mean(); cs=((p[m]>=slo[m])&(p[m]<=shi[m])).mean()
  print(f"{name}: n={m.sum()} MdAPE live={A(e):.4f} comp-only(hammer)={A(sc):.4f} shadow={A(s):.4f} | cov live band={cl:.3f} shadow 80%={cs:.3f} w={np.median((shi[m]-slo[m])/s[m]):.2f} | shadow beats live on {((np.abs(s-p)<np.abs(e-p))[m]).mean():.3f}")
rep(te,'heldout')
for k in range(3): rep(te&(ns==k),f'heldout n_sources={k}{"+" if k==2 else ""}')
mixed=np.array([len(r['pls'])>1 for r in out]); rep(te&mixed,'heldout mixed-platform comp sets'); rep(te&~mixed,'heldout BaT-only comps')
print(dict(zip(names,np.round(b,4))),q)
json.dump({'coef':dict(zip(names,map(float,b))),'q':q,'train_n':int(tr.sum()),'test_n':int(te.sum())},open('model_v2.json','w'))
json.dump([{'v':r['v'],'base':r['base'],'nc':r['nc'],'pls':r['pls'],'d':r['d']} for r in out],open('bases.json','w'))

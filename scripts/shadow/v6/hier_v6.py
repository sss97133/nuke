import json,re,numpy as np,hashlib,bisect,collections,resource
files=["5ddc1b2e-c6a6-4f55-a3b0-054e782df654","8673374c-6c74-4a52-801a-107ed010da09","663cd4eb-5afa-493b-9156-75a67a924300","5efae9a5-10a9-4ce9-a815-e8aa07314747"]
def fam(md): 
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
G=[collections.defaultdict(list) for _ in range(3)]; V={}
for f in files:
    t=open(f"/workspace/agent-tools/{f}.txt").read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    s=json.loads(re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S).group(1))[0]['s']; s=s['s'] if isinstance(s,dict) else s
    for line in s.split('\n'):
        parts=line.split('|')
        if len(parts)!=9: continue
        vid,mk,md,yr,pl,d,cur,h,g=parts
        if not yr: continue
        yr=int(yr)
        if pl=='bat': V.setdefault(vid,(mk,md,yr))
        if cur=='USD' and d:
          x=(d,yr,vid,float(h),pl); G[0][(mk,md)].append(x); G[1][(mk,fam(md))].append(x); G[2][(mk,yr//10)].append(x)
for g in G:
  for k in g: g[k].sort()
R=json.load(open('../rows.json')); h5=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)%5
win=[3,3,0]; out=[]
for r in R:
  v=r['v']
  if v not in V or not r['d']: continue
  mk,md,yr=V[v]; keys=[(mk,md),(mk,fam(md)),(mk,yr//10)]
  for lv in range(3):
    L=G[lv].get(keys[lv],[]); i=bisect.bisect_left(L,(r['d'],))
    c=[x for x in L[max(0,i-2000):i] if abs(x[1]-yr)<=(win[lv] if lv<2 else 9) and x[2]!=v][-40:]
    if len(c)>=3: out.append((v,r['p'],float(r['e']),float(r['lo'] or 0),float(r['hi'] or 0),lv,float(np.median([x[3] for x in c])),len(c),r['d'],collections.Counter(z[4] for z in c))); break
  else: out.append((v,r['p'],float(r['e']),float(r['lo'] or 0),float(r['hi'] or 0),3,np.nan,0,r['d'],collections.Counter()))
print('rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)
v=[o[0] for o in out]; p=np.array([o[1] for o in out],float); e=np.array([o[2] for o in out]); lo=np.array([o[3] for o in out]); hi=np.array([o[4] for o in out])
lv=np.array([o[5] for o in out]); b0=np.array([o[6] for o in out]); te=np.array([h5(x)==0 for x in v])
M={}; s=np.full(len(p),np.nan); slo=s.copy(); shi=s.copy()
for L in range(3):
  m=lv==L; y=np.log(p/b0); tr=m&~te&(np.abs(y)<np.log(5))
  a=float(np.median(y[tr])); q=[float(x) for x in np.quantile(y[tr]-a,[.1,.9])]
  M[L]=dict(intercept=a,q=q,train_n=int(tr.sum()))
  s[m]=b0[m]*np.exp(a); slo[m]=s[m]*np.exp(q[0]); shi[m]=s[m]*np.exp(q[1])
conf={0:'high',1:'medium',2:'low',3:'none'}
for L in range(4):
  m=te&(lv==L); A=lambda z: np.median(np.abs(z[m]-p[m])/p[m])
  if L<3: print(f"L{L} {conf[L]}: total={int((lv==L).sum())} held n={m.sum()} MdAPE shadow={A(s):.4f} live={A(e):.4f} cov80={((p[m]>=slo[m])&(p[m]<=shi[m])).mean():.3f} width={np.median((shi[m]-slo[m])/s[m]):.2f}")
  else: print(f"L3 none: total={int((lv==3).sum())} held n={m.sum()} live MdAPE={A(e):.4f}")
m=te&(lv<3); print('all covered held n',m.sum(),'MdAPE',np.median(np.abs(s[m]-p[m])/p[m]).round(4),'live',np.median(np.abs(e[m]-p[m])/p[m]).round(4))
json.dump({'levels':M,'conf':conf},open('model_v6_hier.json','w'))
json.dump([dict(v=o[0],lv=int(o[5]),base=o[6],nc=o[7],d=o[8],s=float(s[i]),lo=float(slo[i]),hi=float(shi[i])) for i,o in enumerate(out) if o[5]<3],open('hier_rows_v6.json','w'))

fee=lambda x,d: min(max(x*0.05,250),7500 if d>='2024-01-29' else 5000)
dd=[o[8] for o in out]; pg=np.array([p[i]+fee(p[i],dd[i]) for i in range(len(p))]); sg=np.array([s[i]+fee(s[i],dd[i]) if s[i]==s[i] else np.nan for i in range(len(p))])
eg=np.array([e[i]+fee(e[i],dd[i]) for i in range(len(p))])
m=te&(lv<3)
print('NET(hammer) all covered MdAPE',np.median(np.abs(s[m]-p[m])/p[m]).round(4),'| GROSS(+BaT fee) shadow',np.median(np.abs(sg[m]-pg[m])/pg[m]).round(4),'live',np.median(np.abs(eg[m]-pg[m])/pg[m]).round(4))
print('all covered cov80',((p[m]>=slo[m])&(p[m]<=shi[m])).mean().round(3),'live band cov',((p[m]>=lo[m])&(p[m]<=hi[m])).mean().round(3))
pc=collections.Counter(); ps=collections.Counter()
for i,o in enumerate(out):
  if o[5]<3:
    pc.update(o[9])
    for k in o[9]: ps[k]+=1
print('comp rows used by platform',dict(pc)); print('targets with >=1 comp from platform',dict(ps))
for P in ['barrett-jackson','mecum','bonhams','collecting-cars','cars_and_bids','pcarmarket']:
  mm=m&np.array([P in o[9] for o in out])
  if mm.sum(): print(P,'held n',mm.sum(),'MdAPE',np.median(np.abs(s[mm]-p[mm])/p[mm]).round(4))

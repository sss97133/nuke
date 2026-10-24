import pickle,numpy as np,hashlib,json,sys,resource,itertools
F=pickle.load(open('feat_v11.pkl','rb'))
N=len(F); h=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)
f5=np.array([h(o['v'])%5 for o in F]); f4=np.array([(h(o['v'])//5)%4 for o in F]); te=f5==0
p=np.array([o['p'] for o in F]); e=np.array([o['e'] for o in F]); lo=np.array([o['lo'] for o in F]); hi=np.array([o['hi'] for o in F]); lv=np.array([o['lv'] for o in F])
lp=np.log(p); WIN=[3,3,9]
def tm(o): return np.log1p(o['mi']) if o['mi']==o['mi'] else np.nan
TM=np.array([tm(o) for o in F]); TMU=np.array([o['tmu'] for o in F]); TMISS=~np.isfinite(TM)
# flatten comps per set S in 0..3: ptr, a(yrs ago), dy, logp, dm
P={}
for S in range(4):
  ln=[len(o['C'][S]) for o in F]; ptr=np.concatenate([[0],np.cumsum(ln)])
  X=np.concatenate([o['C'][S] for o in F if len(o['C'][S])] or [np.zeros((0,4))]).astype(np.float32)
  a=-X[:,0]/365.25; dy=X[:,1]; l=X[:,2]; cm=np.log1p(X[:,3]); tid=np.repeat(np.arange(N),ln)
  dm=TM[tid]-cm; dm=np.where(np.isfinite(dm),dm,0).astype(np.float32)
  ci=(~np.isfinite(cm))&np.isfinite(TM[tid]); ti=np.isfinite(cm)&~np.isfinite(TM[tid])
  P[S]=dict(ptr=ptr,a=a,dy=dy,l=l,dm=dm,tid=tid,ci=ci.astype(np.float32),ti=ti.astype(np.float32),cmf=np.isfinite(cm).astype(np.float32))
del F
def wmed(v,w):
  o=np.argsort(v); c=np.cumsum(w[o]); return v[o][np.searchsorted(c,c[-1]/2)]
def point(S,cfg,beta):
  """per target log-estimate from set S. cfg: k (n most recent), yw (year window), tau_a, tau_y, tau_m"""
  Q=P[S]; bt,by,bm,bc,bi=beta; out=np.full(N,np.nan); n=np.zeros(N,int)
  adj=Q['l']+bt*Q['a']-by*Q['dy']+bm*Q['dm']+bc*Q['ci']+bi*Q['ti']
  w=np.exp(-Q['a']/cfg['ta'])*np.exp(-np.abs(Q['dy'])/cfg['ty'])*np.exp(-np.abs(Q['dm'])/cfg['tm'])
  ok=np.abs(Q['dy'])<=cfg['yw']
  for i in range(N):
    s,t=Q['ptr'][i],Q['ptr'][i+1]
    if t==s: continue
    m=ok[s:t]; idx=np.nonzero(m)[0][-cfg['k']:]
    if len(idx)<3: continue
    n[i]=len(idx); out[i]=wmed(adj[s:t][idx],w[s:t][idx]) if cfg['w'] else np.median(adj[s:t][idx])
  return out,n
def fitbeta(S,tr,yw):
  """OLS on training pairs: lp_target - lp_comp = c + bt*a - by*dy + bm*dm (robust: trim |res|>log5)"""
  Q=P[S]; m=tr[Q['tid']]&(np.abs(Q['dy'])<=yw)
  y=lp[Q['tid'][m]]-Q['l'][m]; X=np.c_[np.ones(m.sum()),Q['a'][m],-Q['dy'][m],Q['dm'][m],Q['ci'][m],Q['ti'][m]]
  k=np.abs(y-np.median(y))<np.log(5); b=np.linalg.lstsq(X[k],y[k],rcond=None)[0]
  return tuple(float(x) for x in b[1:])
A=lambda z,m: float(np.median(np.abs(np.exp(z[m])-p[m])/p[m]))

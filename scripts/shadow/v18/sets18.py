# Z/N/CMF comp-set point estimates per target, one set in memory at a time (same math as v11 run3/run4/dump5/fwd_sets11)
import numpy as np,json,sys,resource,hashlib
BC={int(k):v for k,v in json.load(open('/workspace/nuke-strategy/shadow/v17/cfg_v11.json')).items()}
def wmed(v,w):
  o=np.argsort(v); c=np.cumsum(w[o]); return v[o][np.searchsorted(c,c[-1]/2)]
def derive(X,ln,TM,S):
  N=len(ln); ptr=np.concatenate([[0],np.cumsum(ln)]); tid=np.repeat(np.arange(N,dtype=np.int32),ln)
  cm=np.log1p(X[:,3]); dm=TM[tid]-cm
  Q=dict(ptr=ptr,a=-X[:,0]/np.float32(365.25) if S<4 else -X[:,0]/365.25,dy=X[:,1],l=X[:,2],dm=np.where(np.isfinite(dm),dm,0).astype(np.float32),tid=tid,
         ci=((~np.isfinite(cm))&np.isfinite(TM[tid])).astype(np.float32),ti=(np.isfinite(cm)&~np.isfinite(TM[tid])).astype(np.float32),cmf=np.isfinite(cm).astype(np.float32))
  if S==4: Q['j']=X[:,4]
  Q['a']=Q['a'].astype(np.float32); return Q
def fitbeta(Q,lp,tr,yw,CH=2_000_000):
  """same model as v11 fitbeta (OLS of lp_target-lp_comp on a,-dy,dm,ci,ti; trim |res-median|>=log5), solved by
  float64 normal equations accumulated in chunks to stay under the RSS cap"""
  m=np.flatnonzero(tr[Q['tid']]&(np.abs(Q['dy'])<=yw))
  y=(lp[Q['tid'][m]]-Q['l'][m]).astype(np.float32); med=np.median(y); keep=np.abs(y-med)<np.log(5); del y
  A=np.zeros((6,6)); b=np.zeros(6)
  for s in range(0,len(m),CH):
    ix=m[s:s+CH][keep[s:s+CH]]
    X=np.c_[np.ones(len(ix)),Q['a'][ix],-Q['dy'][ix],Q['dm'][ix],Q['ci'][ix],Q['ti'][ix]].astype(np.float64)
    yy=lp[Q['tid'][ix]]-Q['l'][ix]; A+=X.T@X; b+=X.T@yy; del X,yy
  return tuple(float(x) for x in np.linalg.solve(A,b)[1:])
def point(Q,S,cfg,beta,N):
  bt,by,bm,bc,bi=beta; out=np.full(N,np.nan); n=np.zeros(N,int); cmf=np.full(N,np.nan)
  adj=(Q['l']+np.float32(bt)*Q['a']-np.float32(by)*Q['dy']+np.float32(bm)*Q['dm']+np.float32(bc)*Q['ci']+np.float32(bi)*Q['ti'])
  ptr=Q['ptr']
  if S==4:
    w=np.exp(-Q['a']/cfg['ta'])*np.exp(-np.abs(Q['dy'])/cfg['ty'])*Q['j']**cfg['g']
    for i in range(N):
      s,t=ptr[i],ptr[i+1]
      if t-s<1: continue
      n[i]=t-s; out[i]=wmed(adj[s:t],w[s:t]); cmf[i]=Q['cmf'][s:t].mean()
    return out,n,cmf
  w=np.exp(-Q['a']/cfg['ta'])*np.exp(-np.abs(Q['dy'])/cfg['ty'])*np.exp(-np.abs(Q['dm'])/cfg['tm'])
  ok=np.abs(Q['dy'])<=cfg['yw']
  for i in range(N):
    s,t=ptr[i],ptr[i+1]
    if t==s: continue
    idx=np.nonzero(ok[s:t])[0][-cfg['k']:]
    if len(idx)<1: continue
    n[i]=len(idx); out[i]=wmed(adj[s:t][idx],w[s:t][idx]); cmf[i]=Q['cmf'][s:t][idx].mean()
  return out,n,cmf
def build(load,lp,TM,trs):
  """load(S)->(X,ln); trs: dict name->mask. returns name->(Z,N,M)"""
  N=len(lp); R={k:(np.full((N,5),np.nan),np.zeros((N,5),np.int32),np.full((N,5),np.nan)) for k in trs}
  for S in range(5):
    X,ln=load(S); Q=derive(X,ln,TM,S); del X
    for k,tr in trs.items():
      beta=fitbeta(Q,lp,tr,BC[S]['yw']); z,n,c=point(Q,S,BC[S],beta,N); R[k][0][:,S]=z; R[k][1][:,S]=n; R[k][2][:,S]=c
      print('set',S,k,'beta',np.round(beta,4),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
    del Q
  return R
if __name__=='__main__':
  T=json.load(open('targets18.json')); p=np.array([t['p'] for t in T]); d=np.array([t['d'] for t in T]); vv=[t['v'] for t in T]; del T
  Mt=np.load('fs/meta.npz'); N=len(p)
  ln4=np.load('fs/ln4.npy'); ln=Mt['ln']
  def load(S):
    if S==4: return np.fromfile('fs/C4.f32',np.float32).reshape(-1,5),ln4
    return np.fromfile(f'fs/C{S}.f32',np.float32).reshape(-1,4),ln[:,S]
  lp=np.log(p); mi=Mt['mi']; TM=np.where(np.isfinite(mi),np.log1p(mi),np.nan)
  h=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)
  f5=np.array([h(x)%5 for x in vv]); f4=np.array([(h(x)//5)%4 for x in vv])
  trs={'all':f5!=0,'2024-07-01':d<'2024-07-01','2025-01-01':d<'2025-01-01','2025-07-01':d<'2025-07-01'}
  R=build(load,lp,TM,trs)
  np.savez('sets18.npz',lp=lp,p=p,f5=f5,f4=f4,TM=TM,TMU=Mt['tmu'],TMISS=~np.isfinite(TM),lv=Mt['lv'],**{f'Z_{k}':R[k][0] for k in R},**{f'N_{k}':R[k][1] for k in R},**{f'M_{k}':R[k][2] for k in R})
  print('done rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

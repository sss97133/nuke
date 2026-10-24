exec(open('run3.py').read().split('res={L:')[0])
F4=pickle.load(open('feat4_v11.pkl','rb'))
ln=[len(F4[i]) if i in F4 else 0 for i in range(N)]; ptr=np.concatenate([[0],np.cumsum(ln)])
X=np.concatenate([F4[i] for i in range(N) if i in F4]); tid=np.repeat(np.arange(N),ln); del F4
cm=np.log1p(X[:,3]); dm=TM[tid]-cm; P[4]=dict(ptr=ptr,a=-X[:,0]/365.25,dy=X[:,1],l=X[:,2],dm=np.where(np.isfinite(dm),dm,0).astype(np.float32),tid=tid,j=X[:,4],ci=((~np.isfinite(cm))&np.isfinite(TM[tid])).astype(np.float32),ti=(np.isfinite(cm)&~np.isfinite(TM[tid])).astype(np.float32),cmf=np.isfinite(cm).astype(np.float32)); del X
_old=_pt
def _pt(S,cfg,beta,mn):
  if S!=4: return _old(S,cfg,beta,mn)
  CMF[4][:]=np.nan
  Q=P[4]; bt,by,bm,bc,bi=beta; out=np.full(N,np.nan); n=np.zeros(N,int)
  adj=Q['l']+bt*Q['a']-by*Q['dy']+bm*Q['dm']+bc*Q['ci']+bi*Q['ti']
  w=np.exp(-Q['a']/cfg['ta'])*np.exp(-np.abs(Q['dy'])/cfg['ty'])*Q['j']**cfg['g']
  for i in range(N):
    s,t=Q['ptr'][i],Q['ptr'][i+1]
    if t-s<mn: continue
    n[i]=t-s; out[i]=wmed(adj[s:t],w[s:t]); CMF[4][i]=Q['cmf'][s:t].mean()
  return out,n
_fb=fitbeta
def fitbeta(S,tr,yw): return _fb(S if S!=4 else 4,tr,yw)
NS=5
def sets(tr):
  Z={};Nn={}
  for S in range(NS):
    beta=fitbeta(S,tr,BC[S]['yw']); Z[S],Nn[S]=_pt(S,BC[S],beta,1)
  return Z,Nn
def design(L,Z,Nn):
  z=Z[L]; cols=[np.ones(N),z]
  for j in range(NS):
    if j==L: continue
    av=np.isfinite(Z[j])&(Nn[j]>0); d=np.where(av,Z[j]-z,0)
    cols+= [d, d*np.log(np.maximum(Nn[j],1))]
  return np.c_[tuple(cols)]
for g in ([1,2,4] if len(sys.argv)<2 else [float(sys.argv[1])]):
  BC[4]=dict(k=300,w=1,ta=5,ty=3,tm=1e9,yw=9,g=g)
  res={L:[] for L in range(3)}
  for k in range(4):
    tr=~te&(f4!=k); va=~te&(f4==k); Z,Nn=sets(tr)
    for L in range(3):
      m=va&(lv==L)&np.isfinite(Z[L]); b=fitstack(L,tr,Z,Nn); res[L].append(A(design(L,Z,Nn)@b,m))
  print('g',g,{L:round(np.mean(res[L]),4) for L in res},'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)

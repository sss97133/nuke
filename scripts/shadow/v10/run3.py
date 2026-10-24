exec(open('run1.py').read().split('t=time.time()')[0])
import re
_p=point
def point(S,cfg,beta,mn=3):
  global point
  src=open('exp_v10.py').read(); 
  return _pt(S,cfg,beta,mn)
def _pt(S,cfg,beta,mn):
  Q=P[S]; bt,by,bm=beta; out=np.full(N,np.nan); n=np.zeros(N,int)
  adj=Q['l']+bt*Q['a']-by*Q['dy']+bm*Q['dm']
  w=np.exp(-Q['a']/cfg['ta'])*np.exp(-np.abs(Q['dy'])/cfg['ty'])*np.exp(-np.abs(Q['dm'])/cfg['tm'])
  ok=np.abs(Q['dy'])<=cfg['yw']
  for i in range(N):
    s,t=Q['ptr'][i],Q['ptr'][i+1]
    if t==s: continue
    idx=np.nonzero(ok[s:t])[0][-cfg['k']:]
    if len(idx)<mn: continue
    n[i]=len(idx); out[i]=wmed(adj[s:t][idx],w[s:t][idx])
  return out,n
BC={int(k):v for k,v in json.load(open('best_cfg.json')).items()}
BC[3]=dict(BC[2])
def sets(tr):
  Z={};Nn={}
  for S in range(4):
    beta=fitbeta(S,tr,BC[S]['yw']); Z[S],Nn[S]=_pt(S,BC[S],beta,1)
  return Z,Nn
def design(L,Z,Nn):
  z=Z[L]; cols=[np.ones(N),z]
  for j in range(4):
    if j==L: continue
    av=np.isfinite(Z[j])&(Nn[j]>0); d=np.where(av,Z[j]-z,0)
    cols+= [d, d*np.log(np.maximum(Nn[j],1))]
  return np.c_[tuple(cols)]
def fitstack(L,tr,Z,Nn):
  X=design(L,Z,Nn); m=tr&(lv==L)&np.isfinite(X).all(1); y=lp[m]
  r=y-X[m][:,1]; k=np.abs(r-np.median(r))<np.log(5)
  b=np.linalg.lstsq(X[m][k],y[k],rcond=None)[0]; return b
res={L:[[],[]] for L in range(3)}
for k in range(4):
  tr=~te&(f4!=k); va=~te&(f4==k)
  Z,Nn=sets(tr)
  for L in range(3):
    m=va&(lv==L)&np.isfinite(Z[L])
    r=lp-Z[L]; a=np.median(r[tr&(lv==L)&np.isfinite(Z[L])&(np.abs(r)<np.log(5))])
    b=fitstack(L,tr,Z,Nn); zs=design(L,Z,Nn)@b
    res[L][0].append(A(Z[L]+a,m)); res[L][1].append(A(zs,m))
  print('fold',k,flush=True)
for L in range(3): print('L',L,'single',round(np.mean(res[L][0]),4),'stack',round(np.mean(res[L][1]),4))
print('rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

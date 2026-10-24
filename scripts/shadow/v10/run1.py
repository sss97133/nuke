exec(open('exp_v10.py').read())
import time
base=dict(k=40,w=0,ta=1e9,ty=1e9,tm=1e9)
def evalcfg(L,cfg,adj):
  cfg=dict(cfg,yw=cfg.get('yw',WIN[L])); m=lv==L
  sc=[]
  for k in range(4):
    tr=~te&(f4!=k)&m; va=~te&(f4==k)&m
    beta=fitbeta(L,tr,cfg['yw']) if adj else (0,0,0)
    if k==0 or adj: z,_=point(L,cfg,beta)
    r=lp-z; a=np.median(r[tr&np.isfinite(z)&(np.abs(r)<np.log(5))])
    sc.append(A(z+a,va&np.isfinite(z)))
  return np.mean(sc)
t=time.time()
for L in range(3):
  print('L',L,'base',round(evalcfg(L,base,0),4),'adj',round(evalcfg(L,base,1),4),flush=True)
print('sec',time.time()-t,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

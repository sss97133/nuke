import sys,os; sys.argv=['x','4']; os.environ['PCACHE_REBUILD']='1'
exec(open('run4.py').read().split('_old=_pt')[0])
import pickle
d={'key':FEATKEY,'N':N,'f5':f5,'f4':f4,'p':p,'e':e,'lo':lo,'hi':hi,'lv':lv,'TM':TM,'TMU':TMU}
for S in range(5):
  for k,v in P[S].items(): d[f'P{S}_{k}']=np.ascontiguousarray(v.astype(np.float32) if v.dtype==np.float64 and k!='ptr' else v)
np.savez('pcache.npz',**d); print('rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

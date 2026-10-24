import sys,numpy as np
CUT=sys.argv[1]
sys.argv=['x','4']
exec(open('run4.py').read().split('for g in')[0]); BC[4]=dict(k=300,w=1,ta=5,ty=3,tm=1e9,yw=9,g=4)
d=np.load('meta_v9.npz')['d']; tr=d<CUT
Z,Nn=sets(tr)
np.savez(f'../v10/fwdsets_{CUT}.npz',Z=np.c_[tuple(Z[s] for s in range(NS))].astype(np.float32),N=np.c_[tuple(Nn[s] for s in range(NS))].astype(np.int32))
print(CUT,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

# check sets18.fitbeta/point reproduce v17 sets_v11.npz Zall/Nall/Mall from the same pcache.npz the v17 dump5 used
import numpy as np,sys; sys.path.insert(0,'.'); import sets18
c=np.load('/workspace/nuke-strategy/shadow/v17/pcache.npz'); S0=np.load('/workspace/nuke-strategy/shadow/v17/sets_v11.npz')
N=int(c['N']); lp=np.log(c['p']); tr=c['f5']!=0
for S in range(5):
  Q={k:c[f'P{S}_{k}'] for k in ['ptr','a','dy','l','dm','tid','ci','ti','cmf']+(['j'] if S==4 else [])}
  b=sets18.fitbeta(Q,lp,tr,sets18.BC[S]['yw']); z,n,m=sets18.point(Q,S,sets18.BC[S],b,N)
  print(S,'Z identical',np.array_equal(z,S0['Zall'][:,S],equal_nan=True),'max|dz|',np.nanmax(np.abs(z-S0['Zall'][:,S])),'N',np.array_equal(n,S0['Nall'][:,S]),'M',np.nanmax(np.abs(m-S0['Mall'][:,S])),flush=True)

# v19 selection inputs: v18 (s0.5_swap) refit at each forward cut on TRAINING rows only (d<c, f5!=0).
import sys; sys.argv=['x','sel19','s0.5_swap']
src=open('eval18.py').read(); exec(src.split("MdA=lambda")[0])
o={}
for c in CUTS[:3]:
  Z,Nn,MM=getsets(c); sv,_,_,_=run(Z,Nn,MM,(d<c)&(f5!=0),od(c)); o[c.replace('-','_')]=sv; print(c,'done',flush=True)
np.savez('sel19_v18_preds.npz',**o)

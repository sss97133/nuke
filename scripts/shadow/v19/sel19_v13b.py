# v19 selection inputs: v13b (exact repro, repA comp sets) refit at each forward cut on TRAINING rows only (d<c, f5!=0).
import sys; sys.argv=['x','sel19','repA/sets_v11.npz','repA/fwdsets11_','../v10/gbm_best.json','0']
src=open('eval_v13b.py').read(); exec(src.split("CUTS=['2024")[0])
import datetime
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']; o={}
for c in CUTS[:3]:
  F=np.load(f'repA/fwdsets11_{c}.npz'); CUTORD[0]=datetime.date.fromisoformat(c).toordinal()
  sv,_,_=run(F['Z'],F['N'],F['M'],(d<c)&(f5!=0)); o[c]=sv; print(c,'done',flush=True)
np.savez('sel19_v13b_preds.npz',**{k.replace('-','_'):v for k,v in o.items()})

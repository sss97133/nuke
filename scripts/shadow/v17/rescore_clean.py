# Re-score saved predictions on the cleaned test set: eval_v13b.py's test masks minus target rows whose
# vehicle has any vehicle_events row flagged source_suspect 'vehicle_id' (flagged.json = dump_flagged_v17.sql).
import numpy as np,json,sys,datetime
S=np.load('sets_v11.npz'); M=np.load('meta_v11.npz'); lv9=np.load('../v9/sets_v9.npz')['lv']
p,e,f5=S['p'],S['e'],S['f5']; v=M['v'] if 'v' in M.files else None
d=np.array([datetime.date.fromisoformat(x).toordinal() for x in M['d']])
FL={x[1] for x in json.load(open(sys.argv[1]))}
bad=np.array([str(x) in FL for x in v]); print('targets on flagged vehicles',int(bad.sum()))
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']; co=[datetime.date.fromisoformat(c).toordinal() for c in CUTS]
out={}
for tag in sys.argv[2:]:
  for i,name in enumerate(['random']+CUTS[:3]):
    te=(f5==0) if name=='random' else (d>=co[i-1])&(d<co[i])
    sv=np.load(f'pred_{tag}_{name}.npz')['s']
    for clean in (0,1):
      m=te&np.isfinite(sv)&(e>0)&(lv9<3)&(~bad if clean else True)
      out[f'{tag}|{name}|{"clean" if clean else "orig"}']=r=dict(n=int(m.sum()),mdape=round(float(np.median(np.abs(sv[m]-p[m])/p[m])),4))
      print(tag,name,'clean' if clean else 'orig',r)
json.dump(out,open('rescore_clean.json','w'),indent=0)

# v19 = per-level log-blend of v18 (gross) and v13b (hammer -> gross via BaT fee), weights from sel19.json.
# Test predictions: pred_v18_<split>.npz (v18 rows) + v17/pred_v13brep_<split>.npz (exact v13b repro, old order).
# Rows without a v13b prediction (Mecum / new rows) use v18 alone. Same masks and gate as eval18.
import numpy as np,json
T=json.load(open('targets18.json')); S=np.load('sets18.npz'); lv=S['lv']; f5=S['f5']
g=lambda k: np.array([t[k] for t in T])
p,ph,d,old,lv9,e,plat=g('p'),g('ph'),g('d'),g('old'),g('lv9'),g('e'),g('pl')
def bat_fee(h,dd): return np.minimum(np.maximum(h*0.05,250),np.where(dd>='2024-01-29',7500,5000))
def bat_hammer(gr,dd):
  cap=np.where(dd>='2024-01-29',7500,5000); h=gr/1.05
  return np.where(h*0.05<250,gr-250,np.where(h*0.05>cap,gr-cap,h))
Wp={int(k):v for k,v in json.load(open('sel19.json'))['pick'].items()}; w=np.array([Wp.get(int(L),1.0) for L in np.minimum(lv,2)])
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']
MdA=lambda z,y,m: round(float(np.median(np.abs(z[m]-y[m])/y[m])),4) if m.sum() else None
Cv=lambda l,u,y,m: round(float(((y[m]>=l[m])&(y[m]<=u[m])).mean()),3) if m.sum() else None
splits=[('random',f5==0)]+[(c,(d>=c)&(d<CUTS[i+1])) for i,c in enumerate(CUTS[:3])]
REG={'random':.2577,'2024-07-01':.2683,'2025-01-01':.2865,'2025-07-01':.2434}; out={}; gate=[]
for name,te in splits:
  B=np.load(f'pred_v21_{name}.npz'); R=np.load(f'/workspace/nuke-strategy/shadow/v17/pred_v13brep_{name}.npz')
  A={}
  for k in ['s','lo','hi']:
    a=np.full(len(p),np.nan); a[old>=0]=R[k][old[old>=0]]; A[k]=a+bat_fee(a,d)
  have=np.isfinite(A['s'])
  bl={k:np.where(have,np.exp(w*np.log(B[k])+(1-w)*np.log(np.where(have,A[k],1))),B[k]) for k in ['s','lo','hi']}
  sv=bl['s']; sv_h=np.where(plat=='bat',bat_hammer(sv,d),sv/1.10); r13h=np.where(have,np.nan,np.nan); r13h[old>=0]=R['s'][old[old>=0]]
  LVR=np.where(old>=0,lv9,lv)
  for L in [0,1,2,'all']:
    lvm=(LVR<3) if L=='all' else (LVR==L); el=te&(old>=0)&(e>0)&lvm; m=el&np.isfinite(sv)&have
    out[f'{name}|old|{L}']=dict(n=int(m.sum()),cov=round(m.sum()/max(1,el.sum()),4),v19_gross=MdA(sv,p,m),v18_gross=MdA(B['s'],p,m),v13b_gross=MdA(A['s'],p,m),
      v19_hammer_eq=MdA(sv_h,ph,m),v13b_hammer=MdA(r13h,ph,m),cov80=Cv(bl['lo'],bl['hi'],p,m))
    for pl_,pm in [('all',np.ones(len(p),bool)),('bat',plat=='bat'),('mecum',plat=='mecum')]:
      el=te&lvm&pm&((old<0)|(e>0)); mm=el&np.isfinite(sv)
      if el.sum(): out[f'{name}|new|{pl_}|{L}']=dict(n=int(mm.sum()),cov=round(mm.sum()/el.sum(),4),v19_gross=MdA(sv,p,mm),cov80=Cv(bl['lo'],bl['hi'],p,mm))
  o=out[f'{name}|old|all']; win=o['v19_gross']<o['v13b_gross'] and o['v19_hammer_eq']<REG[name]; gate.append(win)
  print(name,o,'WIN' if win else 'LOSE')
json.dump(dict(weights=Wp,out=out,gate=gate,qualifies=all(gate)),open('eval_v21_blend.json','w'),indent=0); print('QUALIFIES',all(gate))

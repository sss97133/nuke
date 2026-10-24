# target-level static attributes (transmission, colour family, drivetrain, body) + title tokens; cites vehicles cols
import json,re,numpy as np
A=json.load(open('attrs_v13.json')); M=np.load('../v12/meta_v11.npz'); v=M['v']; yr=M['yr']; mk=M['mk']
def code(vals):
  u={x:i for i,x in enumerate(sorted(set(vals)-{''}))}; return np.array([u.get(x,-1) for x in vals],float),u
tr=[A.get(x,['']*7) for x in v]
t=[(r[0]+' '+r[1]).lower() for r in tr]
man=np.array([1. if 'manual' in s else 0. if ('auto' in s or 'cvt' in s or 'pdk' in s or 'dct' in s) else np.nan for s in t])
spd=np.array([float(m.group(1)) if (m:=re.search(r'(\d)[- ]?speed',s)) else np.nan for s in t])
cf,ucf=code([r[2] for r in tr])
def dtn(s):
  s=s.lower(); return '4wd' if ('4wd' in s or '4x4' in s) else 'awd' if 'awd' in s else 'rwd' if 'rwd' in s else 'fwd' if 'fwd' in s else ''
dt,_=code([dtn(r[4]) for r in tr]); bd,_=code([r[5].lower() for r in tr])
STOP=set('the a an of with and for in on by w/ no reserve original owner'.split())
def toks(title,make,y):
  s=re.sub(r'\b(19|20)\d\d\b',' ',title.lower()); s=re.sub(r'[^a-z0-9\-\+ ]',' ',s)
  return sorted({w for w in s.split() if len(w)>1 and w not in STOP and w!=make})
TK=[toks(r[6],m,y) for r,m,y in zip(tr,mk,yr)]
np.savez('feat_v13.npz',man=man,spd=spd,cf=cf,dt=dt,bd=bd)
json.dump(TK,open('tok_v13.json','w'))
print('man',np.isfinite(man).mean().round(3),'spd',np.isfinite(spd).mean().round(3),'cf',(cf>=0).mean().round(3),'dt',(dt>=0).mean().round(3),'tok/row',np.mean([len(x) for x in TK]).round(2))

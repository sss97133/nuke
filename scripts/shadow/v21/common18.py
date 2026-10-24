# shared v18 inputs for sel18.py / eval18.py
import numpy as np,json,collections,datetime
exec(open('fam18.py').read())
T=json.load(open('targets18.json')); Mt=np.load('fs/meta.npz'); S=np.load('sets18.npz')
lp,p,lv,f5,f4,TM=[S[k] for k in ['lp','p','lv','f5','f4','TM']]; TMU=S['TMU'].astype(float); TMISS=S['TMISS'].astype(float)
yr=Mt['yr']; mk=Mt['mk']; d=np.array([t['d'] for t in T]); v=np.array([t['v'] for t in T]); sy=np.array([int(x[:4]) for x in d])
old=np.array([t['old'] for t in T]); lv9=np.array([t['lv9'] for t in T]); e=np.array([t['e'] for t in T]); ph=np.array([t['ph'] for t in T])
plat=np.array([t['pl'] for t in T]); ismec=plat=='mecum'
ATT=np.load('att18.npy'); TK=json.load(open('tok18.json'))
od=lambda x: datetime.date.fromisoformat(x).toordinal(); DORD=np.array([od(x) for x in d])
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']
prm=json.load(open('/workspace/nuke-strategy/shadow/v10/gbm_best.json'))
KS=20.
def tok_te(y,tr,fold):
  def stats(m):
    s=collections.defaultdict(float); n=collections.Counter()
    for i in np.flatnonzero(m):
      for t in TK[i]: s[(mk[i],t)]+=y[i]; n[(mk[i],t)]+=1
    return s,n
  out=np.zeros((len(y),4)); out[:,0]=np.nan
  full=stats(tr); per={k:stats(tr&(fold!=k)) for k in range(4)}
  for i in range(len(y)):
    s,n=per[fold[i]] if tr[i] else full
    vv=[s[(mk[i],t)]/(n[(mk[i],t)]+KS) for t in TK[i] if n[(mk[i],t)]>=3]
    if vv: out[i]=[sum(vv),min(vv),max(vv),len(vv)]
  return out
def getsets(name):
  k='all' if name=='random' else name
  return S[f'Z_{k}'],S[f'N_{k}'],S[f'M_{k}']
# BaT buyer fee (mk_v11.py): 5%, min $250, cap $5,000 (before 2024-01-29) / $7,500
def bat_fee(h,dd): return np.minimum(np.maximum(h*0.05,250),np.where(dd>='2024-01-29',7500,5000))
def bat_hammer(g,dd):
  cap=np.where(dd>='2024-01-29',7500,5000); h=g/1.05
  return np.where(h*0.05<250,g-250,np.where(h*0.05>cap,g-cap,h))

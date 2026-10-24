# target attributes: old targets = v13b PIT attrs (feat_v13b_pit.npz codes) + v13 tokens; Mecum targets = vehicles row
# (lot-page import) only when the vehicle has no later sold event (else blank, so no post-sale info leaks in).
import json,re,numpy as np,pickle,collections
SH='/workspace/nuke-strategy/shadow'
T=json.load(open('targets18.json')); EV=pickle.load(open('ev_v18.pkl','rb'))
M=np.load(f'{SH}/v17/meta_v11.npz'); A=json.load(open(f'{SH}/v13b/attrs_v13b_pit.json')); F=np.load(f'{SH}/v13b/feat_v13b_pit.npz'); TK0=json.load(open(f'{SH}/v13/tok_v13.json'))
MV={l.split('\t')[0]:l.split('\t') for l in open('mecum_veh.tsv').read().split('\n') if l.count('\t')>=11}
_G,VV,_LM,_VS=pickle.load(open('comps_v18.pkl','rb')); del _G,_LM,_VS
later=collections.defaultdict(list)
for v,d,pl,g,s in EV.values(): later[v].append(d)
old=[A.get(x,['']*7) for x in M['v']]
def codes(vals): return {x:i for i,x in enumerate(sorted(set(vals)-{''}))}
def dtn(s):
  s=s.lower(); return '4wd' if ('4wd' in s or '4x4' in s) else 'awd' if 'awd' in s else 'rwd' if 'rwd' in s else 'fwd' if 'fwd' in s else ''
def frommap(vals,arr):
  # value -> code as stored in feat_v13b_pit.npz (attrs json was regenerated after the npz; use the npz codes)
  c=collections.defaultdict(collections.Counter)
  for x,k in zip(vals,arr):
    if x!='' and k>=0: c[x][int(k)]+=1
  u={x:cc.most_common(1)[0][0] for x,cc in c.items()}; nxt=[int(np.nanmax(arr))+1]
  return u
ucf=frommap([r[2] for r in old],F['cf']); udt=frommap([dtn(r[4]) for r in old],F['dt']); ubd=frommap([r[5].lower() for r in old],F['bd'])
for u,a in ((ucf,F['cf']),(udt,F['dt']),(ubd,F['bd'])): u['__next']=int(np.nanmax(a))+1
STOP=set('the a an of with and for in on by w/ no reserve original owner'.split())
def toks(title,make):
  s=re.sub(r'\b(19|20)\d\d\b',' ',title.lower()); s=re.sub(r'[^a-z0-9\-\+ ]',' ',s)
  return sorted({w for w in s.split() if len(w)>1 and w not in STOP and w!=make})
def ext(u,x):
  if x=='': return -1
  if x not in u: u[x]=u['__next']; u['__next']+=1
  return u[x]
ATT=np.full((len(T),5),np.nan); TK=[]; nblank=0
for i,t in enumerate(T):
  if t['old']>=0:
    j=t['old']; ATT[i]=[F['man'][j],F['spd'][j],F['cf'][j],F['dt'][j],F['bd'][j]]; TK.append(TK0[j]); continue
  if t.get('fresh') and t['v'] not in MV:
    import pickle as _p
    ATT[i]=[np.nan,np.nan,-1,-1,-1]; TK.append(toks(VV[t['v']][1] or '',VV[t['v']][0])); continue
  p=MV[t['v']]
  if any(d>t['d'] for d in later[t['v']]): nblank+=1; ATT[i]=[np.nan,np.nan,-1,-1,-1]; TK.append(toks(p[11],p[1])); continue
  r=[p[5],p[6],p[7],p[8],p[9],p[10]]; s=(r[0]+' '+r[1]).lower()
  man=1. if 'manual' in s else 0. if ('auto' in s or 'cvt' in s or 'pdk' in s or 'dct' in s) else np.nan
  m=re.search(r'(\d)[- ]?speed',s); spd=float(m.group(1)) if m else np.nan
  ATT[i]=[man,spd,ext(ucf,r[2]),ext(udt,dtn(r[4])),ext(ubd,r[5].lower())]; TK.append(toks(p[11],p[1]))
np.save('att18.npy',ATT); json.dump(TK,open('tok18.json','w'))
mm=np.array([t['old']<0 and not t.get('fresh') for t in T])
print('mecum blanked (later sale)',nblank,'mecum man',np.isfinite(ATT[mm,0]).mean().round(3),'cf',(ATT[mm,2]>=0).mean().round(3),'bd',(ATT[mm,4]>=0).mean().round(3),'tok/row',np.mean([len(TK[i]) for i in np.flatnonzero(mm)]).round(2))

# v19 selection: per fallback level (v18 lv), log-blend weight w of v18 vs v13b (w=1 -> v18 only, 0 -> v13b only),
# chosen by mean MdAPE (gross basis) over the 3 forward rolling-origin cuts on TRAINING rows only (f5!=0; both models
# refit on d<c & f5!=0). Pre-set rule: argmin over W per level; ties -> smaller w (incumbent v13b).
import numpy as np,json
T=json.load(open('targets18.json')); S=np.load('sets18.npz'); lv=S['lv']; f5=S['f5']
p=np.array([t['p'] for t in T]); d=np.array([t['d'] for t in T]); old=np.array([t['old'] for t in T])
def bat_fee(h,dd): return np.minimum(np.maximum(h*0.05,250),np.where(dd>='2024-01-29',7500,5000))
A=np.load('/workspace/nuke-strategy/shadow/v17/sel19_v13b_preds.npz'); B=np.load('sel19_v18_preds.npz')
CUTS=['2024-07-01','2025-01-01','2025-07-01','2099-01-01']; W=[0,.25,.5,.75,1]; res={}
for i,c in enumerate(CUTS[:3]):
  k=c.replace('-','_'); s18=B[k]; s13=np.full(len(p),np.nan); s13[old>=0]=A[k][old[old>=0]]; s13g=s13+bat_fee(s13,d)
  va=(d>=c)&(d<CUTS[i+1])&(f5!=0)&(lv<3)&(old>=0)&np.isfinite(s18)&np.isfinite(s13)
  for L in range(3):
    m=va&(lv==L)
    for w in W:
      b=np.exp(w*np.log(s18[m])+(1-w)*np.log(s13g[m])); res.setdefault(f'L{L}|{w}',[]).append(round(float(np.median(np.abs(b-p[m])/p[m])),4))
    res.setdefault(f'L{L}|n',[]).append(int(m.sum()))
pick={}
for L in range(3):
  mean={w:np.mean(res[f'L{L}|{w}']) for w in W}; pick[L]=min(W,key=lambda w:(round(mean[w],6),w))
  print('L',L,'n',res[f'L{L}|n'],{w:(res[f'L{L}|{w}'],round(mean[w],4)) for w in W},'pick w_v18=',pick[L])
json.dump(dict(res=res,pick=pick,criterion=open(__file__).read().split('\n')[1:4]),open('sel19.json','w'),indent=0)

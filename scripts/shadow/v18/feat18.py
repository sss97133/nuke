# per-target PIT comp sets (same rules as v11 feat_v11.py: comps strictly before sale date, other vehicles only), streamed to disk
import collections,json,numpy as np,pickle,bisect,datetime,resource,os
G,V,LM,VS=pickle.load(open('comps_v18.pkl','rb'))
od=lambda s: datetime.date.fromisoformat(s).toordinal()
LV=collections.defaultdict(list)
for (vv,dd),mm in LM.items(): LV[vv].append((od(dd),mm))
def lmi(v,d):
  c=[(abs(a-d),m) for a,m in LV.get(v,[]) if abs(a-d)<=3]
  return min(c)[1] if c else np.nan
TMU=pickle.load(open('tmu_v18.pkl','rb')); TV=collections.defaultdict(list)
for (vv,dd) in TMU: TV[vv].append(od(dd))
T=json.load(open('targets18.json'))
WIN=[3,3,9]; WIDE=[6,6,9,9]
def cands(L,key,d,yr,v,w,k):
  A=G[L].get(key,[]); i=bisect.bisect_left(A,(d,))
  return [x for x in A[max(0,i-4000):i] if abs(x[1]-yr)<=w and x[2]!=v][-k:]
os.makedirs('fs',exist_ok=True)
fh=[open(f'fs/C{S}.f32','wb') for S in range(4)]; ln=np.zeros((len(T),4),np.int32)
meta=dict(lv=[],mi=[],tmu=[],sg=[],mk=[],yr=[])
for i,r in enumerate(T):
  v=r['v']; mk,md,yr,cf=V[v]; d=od(r['d']); mi=lmi(v,d); sg=VS.get(v,'')
  keys=[(mk,md),(mk,cf),(mk,yr//10),(sg,yr//10)]
  lv=3
  for L in range(3):
    if len(cands(L,keys[L],d,yr,v,WIN[L],40))>=3: lv=L; break
  for S in range(4):
    if S==3 and not sg: continue
    c=cands(S,keys[S],d,yr,v,WIDE[S] if S<3 else 9,120)
    if c:
      a=np.array([(x[0]-d,x[1]-yr,x[3],x[5]) for x in c],np.float32); fh[S].write(a.tobytes()); ln[i,S]=len(c)
  meta['lv'].append(lv); meta['mi'].append(mi); meta['tmu'].append(int(any(abs(a-d)<=3 for a in TV.get(v,[])))); meta['sg'].append(sg); meta['mk'].append(mk); meta['yr'].append(yr)
  if i%20000==0: print(i,'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,flush=True)
for f in fh: f.close()
np.savez('fs/meta.npz',ln=ln,**{k:np.array(v) for k,v in meta.items()})
print('done',len(T),collections.Counter(meta['lv']),'rss',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

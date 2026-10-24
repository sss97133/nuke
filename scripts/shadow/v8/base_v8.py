import json,re,numpy as np,hashlib,bisect,collections,resource
files=["7c1a9051-d755-4407-9730-e48c65c9d833","b802f16a-4435-4427-886a-17f66e9e2ef3","47973cd9-e3bd-4f15-b4f3-86cc4d62e587","7c6aeb7c-0f0d-49d7-a6a9-588324a4b8c3"]
def fam(md): 
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
G=[collections.defaultdict(list) for _ in range(3)]; V={}
for f in files:
    t=open(f"/workspace/agent-tools/{f}.txt").read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    s=json.loads(re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S).group(1))[0]['s']; s=s['s'] if isinstance(s,dict) else s
    for line in s.split('\n'):
        parts=line.split('|')
        if len(parts)!=9: continue
        vid,mk,md,yr,pl,d,cur,h,g=parts
        if not yr: continue
        yr=int(yr)
        if pl=='bat': V.setdefault(vid,(mk,md,yr))
        if cur=='USD' and d:
          x=(d,yr,vid,float(h),pl); G[0][(mk,md)].append(x); G[1][(mk,fam(md))].append(x); G[2][(mk,yr//10)].append(x)
for g in G:
  for k in g: g[k].sort()
R=json.load(open('../rows.json')); h5=lambda v:int(hashlib.md5(v.encode()).hexdigest()[:8],16)%5
win=[3,3,0]; out=[]
for r in R:
  v=r['v']
  if v not in V or not r['d']: continue
  mk,md,yr=V[v]; keys=[(mk,md),(mk,fam(md)),(mk,yr//10)]
  for lv in range(3):
    L=G[lv].get(keys[lv],[]); i=bisect.bisect_left(L,(r['d'],))
    c=[x for x in L[max(0,i-2000):i] if abs(x[1]-yr)<=(win[lv] if lv<2 else 9) and x[2]!=v][-40:]
    if len(c)>=3: out.append((v,r['p'],float(r['e']),float(r['lo'] or 0),float(r['hi'] or 0),lv,float(np.median([x[3] for x in c])),len(c),r['d'],collections.Counter(z[4] for z in c))); break
  else: out.append((v,r['p'],float(r['e']),float(r['lo'] or 0),float(r['hi'] or 0),3,np.nan,0,r['d'],collections.Counter()))

import pickle
pickle.dump(out,open('out_v8.pkl','wb'))
print('rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024,len(out))

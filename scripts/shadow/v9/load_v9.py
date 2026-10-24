import json,re,numpy as np,collections,resource,pickle,datetime,math
CF=["cb94769e-76b1-454c-a14c-1dfff61edfd8","31f61df0-9ae2-467c-9f9e-2ff58aec59fc","5a514a01-d7b3-4165-ae4b-d259be1b97ef","8d32bcab-07f7-4bc3-8bde-b54aab0345a9"]
VF=["d6660bc5-6824-4594-b37a-13dde981f6da","85c3f561-7765-4a3a-8206-e7fd32b4ce62","2858c386-1f37-4927-b510-73301697e67f","5043e599-973d-48d5-9df3-466edc1a9ffb"]
def rd(f):
    t=open(f"/workspace/agent-tools/{f}.txt").read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    s=json.loads(re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S).group(1))[0]['s']
    return s['s'] if isinstance(s,dict) else s
VA={}
for f in VF:
  for l in rd(f).split('\n'):
    p=l.split('|')
    if len(p)==3: VA[p[0]]=(float(p[1]) if p[1] else np.nan, p[2])
def fam(md):
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
od=lambda s: datetime.date.fromisoformat(s).toordinal()
G=[collections.defaultdict(list) for _ in range(4)]; V={}; n=0
for f in CF:
  for l in rd(f).split('\n'):
    p=l.split('|')
    if len(p)!=7: continue
    vid,mk,md,yr,pl,d,h=p; yr=int(yr); n+=1
    if pl=='bat': V.setdefault(vid,(mk,md,yr))
    mi,sg=VA.get(vid,(np.nan,''))
    x=(od(d),yr,vid,math.log(float(h)),pl,mi)
    G[0][(mk,md)].append(x); G[1][(mk,fam(md))].append(x); G[2][(mk,yr//10)].append(x)
    if sg: G[3][(sg,yr//10)].append(x)
for g in G:
  for k in g: g[k].sort()
pickle.dump((G,V,VA),open('comps_v9.pkl','wb'))
print('comps',n,'bat vehicles',len(V),'veh attrs',len(VA),'mileage',sum(1 for a in VA.values() if a[0]==a[0]),'seg',sum(1 for a in VA.values() if a[1]),'rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

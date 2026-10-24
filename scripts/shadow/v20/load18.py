# v20: same as v18 loader on refreshed inputs: mecum_ev = mecum_px_v1 + mecum_status754_v1 (class_v1 non-vehicle rows excluded), aelm = 07:22 dump + lot-page readings to 15:01 UTC.
# v18 comps + targets: fresh dump (shadow_sale_prices joined to snap_v8 for v13b dating/attrs) + Mecum run mecum_px_v1_20261024
# price basis: gross USD (buyer-paid incl. premium) for every comp and target; never net, never hammer mixed in.
import json,re,numpy as np,collections,resource,pickle,datetime,math,hashlib
SH='/workspace/nuke-strategy/shadow'
od=lambda s: datetime.date.fromisoformat(s).toordinal()
NM={(o['platform'],o['make_l'],o['model_raw']):o['model_canon'] for o in json.load(open(f'{SH}/v10/norm_v10.json'))}
SM={(o['make_l'],o['model_canon']):o['segment_slug'] for o in json.load(open(f'{SH}/v10/segmap_v10.json'))}
def fam(md):
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
def canon(pl,mk,md): return NM.get((pl,mk,md)) or fam(md)
UNTR=set(open('uid.txt').read().split())                      # vehicle_sale_price_untrusted_ids (7,977)
DROP={tuple(l.split('|')) for l in open(f'{SH}/v17/drop_vid_date.txt').read().split()}  # wrong-vehicle aggregator (vid,date)
SMI=set(open('smi.txt').read().split())                       # mileage_value_status suspect, not superseded
# mileage by event id (usable view), suspect vehicles excluded
EM={}; ETMU=set()
for l in open('aelm.txt').read().split('\n'):
  p=l.split('|')
  if len(p)!=3: continue
  if p[2]=='t': ETMU.add(p[0])
  elif p[1]: EM.setdefault(p[0],float(p[1]))
SEGV={}
VF=["d6660bc5-6824-4594-b37a-13dde981f6da","85c3f561-7765-4a3a-8206-e7fd32b4ce62","2858c386-1f37-4927-b510-73301697e67f","5043e599-973d-48d5-9df3-466edc1a9ffb"]
def rdo(f):
    t=open(f"/workspace/agent-tools/{f}.txt").read()
    try: t=json.loads(t)["result"]
    except Exception: pass
    s=json.loads(re.search(r'>\s*(\[.*\])\s*</untrusted',t,re.S).group(1))[0]['s']
    return s['s'] if isinstance(s,dict) else s
for f in VF:
  for l in rdo(f).split('\n'):
    p=l.split('|')
    if len(p)==3 and p[2]: SEGV[p[0]]=p[2]
MV={}
for l in open('mecum_veh.tsv').read().split('\n'):
  p=l.split('\t')
  if len(p)>=12: MV[p[0]]=p
  if len(p)>=12 and p[4]: SEGV.setdefault(p[0],p[4])
st=collections.Counter(); rows=[]
for l in open('comps_ev.txt').read().split('\n'):
  p=l.split('|')
  if len(p)!=11: continue
  eid,vid,mk,md,yr,pl,d1,d0,h,g,basis=p
  d=d1 or d0
  if not yr or not d: st['no_year_or_date']+=1; continue
  if not g or float(g)<=0: st['no_gross']+=1; continue
  if vid in UNTR: st['untrusted_vehicle']+=1; continue
  if (vid,d) in DROP: st['wrong_vehicle_flag']+=1; continue
  rows.append((eid,vid,mk,md,int(yr),pl,d,float(g),'ae'))
for l in open('mecum_ev.txt').read().split('\n'):
  p=l.split('|')
  if len(p)!=8: continue
  eid,vid,d,g,h,susp,role,dup=p
  v=MV.get(vid)
  if susp or role=='duplicate' or dup: st['mecum_flag']+=1; continue
  if v is None or not v[3]: st['mecum_no_year']+=1; continue
  if vid in UNTR: st['untrusted_vehicle_mecum']+=1; continue
  rows.append((eid,vid,v[1],v[2],int(v[3]),'mecum',d,float(g),'ve'))
# duplicates: same make, year, sale date within 1 day, same gross price (cents) on a different vehicle id -> keep auction_events row / first id
key=collections.defaultdict(list)
for r in rows: key[(r[2],canon(r[5],r[2],r[3]) if r[5]!='mecum' else fam(r[3]),r[4],round(r[7]))].append(r)
dup=set()
for k,L in key.items():
  if len(L)<2: continue
  L.sort(key=lambda r:(r[8]!='ae',r[0]))
  for i in range(len(L)):
    if L[i][0] in dup: continue
    for j in range(i+1,len(L)):
      if L[j][0] in dup or L[j][1]==L[i][1] and L[j][6]==L[i][6] and False: continue
      if abs(od(L[j][6])-od(L[i][6]))<=1 and (L[j][1]!=L[i][1] or L[j][6]==L[i][6]): dup.add(L[j][0])
st['duplicate']=len(dup); DUPPL=collections.Counter(r[5]+'/'+r[8] for r in rows if r[0] in dup); rows=[r for r in rows if r[0] not in dup]
dupb=collections.Counter(); 
G=[collections.defaultdict(list) for _ in range(4)]; V={}; LM={}; TMU=set(); EV={}
for eid,vid,mk,md,yr,pl,d,g,src in rows:
  cf=canon(pl,mk,md)
  if pl=='bat': V.setdefault(vid,(mk,md,yr,cf))
  mi=np.nan
  if vid not in SMI:
    if eid in EM: mi=EM[eid]; LM[(vid,d)]=mi
    if eid in ETMU: TMU.add((vid,d))
  sg=SEGV.get(vid) or SM.get((mk,cf),'')
  x=(od(d),yr,vid,math.log(g),pl,mi)
  G[0][(mk,md)].append(x); G[1][(mk,cf)].append(x); G[2][(mk,yr//10)].append(x)
  if sg: G[3][(sg,yr//10)].append(x)
  EV[eid]=(vid,d,pl,g,src)
for eid,vid,mk,md,yr,pl,d,g,src in rows:
  if src=='ve': V.setdefault(vid,(mk,md,yr,canon(pl,mk,md)))
for gg in G:
  for k in gg: gg[k].sort()
VS={v:(SEGV.get(v) or SM.get((t[0],t[3]),'')) for v,t in V.items()}
pickle.dump((G,V,LM,VS),open('comps_v18.pkl','wb')); pickle.dump(TMU,open('tmu_v18.pkl','wb'))
json.dump(dict(dup_by_platform=DUPPL,stats=st,kept=len(rows),by_platform=collections.Counter(r[5] for r in rows),mecum_ve=sum(1 for r in rows if r[8]=='ve'),with_mileage=int(sum(1 for r in rows if (r[1],r[6]) in LM))),open('load18.json','w'),indent=1)
pickle.dump(EV,open('ev_v18.pkl','wb'))
print(json.load(open('load18.json')),'rss MB',resource.getrusage(resource.RUSAGE_SELF).ru_maxrss//1024)

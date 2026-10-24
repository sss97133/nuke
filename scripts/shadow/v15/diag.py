import json,pickle,collections,datetime,gc
od=lambda s: datetime.date.fromisoformat(s).toordinal()
def lv(p):
  LM=pickle.load(open(p,'rb'))[2]; L=collections.defaultdict(list)
  for (v,d),m in LM.items(): L[v].append((od(d),m,d))
  return L
A=lv('v12/comps_v11.pkl'); gc.collect(); B=lv('v15/comps_v11.pkl')
R=json.load(open('rows.json')); lost=[]
hit=lambda L,v,d: [x for x in L.get(v,[]) if abs(x[0]-d)<=3]
for r in R:
  if not r.get('d'): continue
  d=od(r['d']); v=r['v']
  if hit(A,v,d) and not hit(B,v,d): lost.append((v,r['d'],hit(A,v,d)[0][2],hit(A,v,d)[0][1],sorted((x[2],x[1]) for x in B.get(v,[]))))
print('lost',len(lost)); c=collections.Counter('no_v15_reading' if not x[4] else 'same_miles_other_date' if any(m==x[3] for _,m in x[4]) else 'other' for x in lost); print(c)
for x in lost[:8]: print(x)
json.dump(lost,open('/workspace/v15/lost.json','w'))

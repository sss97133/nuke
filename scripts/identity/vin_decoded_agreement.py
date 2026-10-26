import json,re,sys,collections
sys.path.insert(0,'/workspace/v37'); from vmap import cat as vcat, make_ok
from parse import nb
def cat(b):
  if not b or re.search(r'(?i)three.wheel|autocycle|side car',b): return None
  return vcat(nb(b))
rows=json.load(open('rows.json'))
st=collections.Counter(); ag=collections.defaultdict(lambda:[0,0]); dis=collections.Counter(); cand=[]; vids=set()
for r in rows:
  vid,vin,b,vt,y,dm,dmod,vy,vm,vmod,vc,ev,cd=r
  c=cat(b)
  if not c: st['nomap']+=1; continue
  if not make_ok(dm,vm): st['make_fail']+=1; continue
  try: yok=abs(int(y)-int(vy))<=1
  except: yok=False
  if not yok: st['year_fail']+=1; continue
  st['pass']+=1
  if ev:
    e=set(ev.split(',')); ag[c][1]+=1
    if c in e: ag[c][0]+=1
    else: dis[(c,ev)]+=1
  elif vid not in vids: vids.add(vid); cand.append(r+[c])
print(dict(st)); T=[0,0]
for c,(a,n) in sorted(ag.items()): print(c,a,n,round(100*a/n,2)); T[0]+=a;T[1]+=n
print('overall',T,round(100*T[0]/T[1],2)); print(dis.most_common(15))
print('gap cand',len(cand),collections.Counter(x[-1] for x in cand))
json.dump(cand,open('cand.json','w'))

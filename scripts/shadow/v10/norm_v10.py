# learn model_canon (base family) per (platform, make, raw model) from token support in BaT family vocab
import json,re,collections
N=json.load(open('names.json'))
tok=lambda s: [t for t in re.split(r'[\s/]+',re.sub(r'[^\w\s/\-]','',(s or '').lower().replace('×','x'))) if t]
def fam(md):
  t=re.split(r'[\s\-/]+',(md or '').lower().strip()); return t[0] if t else ''
# family support from all platforms (counts of sales whose first token is f)
FS=collections.Counter(); BS=collections.Counter()
for pl,mk,md,n in N:
  FS[(mk,fam(md))]+=n
  if pl=='bat': BS[(mk,fam(md))]+=n
NOISE=set('custom resto-mod restomod resto mod 2 4 door 2-door 4-door hardtop coupe convertible sedan wagon pickup roadster the edition series new tribute replica'.split())
GM=collections.defaultdict(set)
for pl,mk,md,n in N:
  for t in tok(md)[1:]: GM[t].add(mk)
GEN={t for t,m in GM.items() if len(m)>=6}
out=[]
for pl,mk,md,n in N:
  f0=fam(md); cand=[]
  for i,t in enumerate(tok(md)):
    for tt in {t, t.replace('-','')}:
      if tt and tt not in NOISE and tt not in GEN and not re.fullmatch(r'\d{4}',tt): cand.append((BS[(mk,tt)],-i,tt))
  if not cand: continue
  s,negi,best=max(cand)
  own=BS[(mk,f0)]
  if best==f0 or s<20 or s<5*max(own,1): continue   # keep own family unless a much better-supported BaT family token exists
  conf=round(min(0.95,s/(s+own+5))*(0.9 if -negi==0 else 0.75),3)
  out.append(dict(platform=pl,make_l=mk,model_raw=md,model_canon=best,method='bat_family_token_v1',confidence=conf,provenance=dict(rule='token of raw model that is a BaT family with support>=20 and >=5x own-first-token BaT support; noise tokens and generic trim tokens (non-first token in >=6 makes) excluded',own_family=f0,own_bat_support=own,canon_bat_support=s,raw_sales=n,token_pos=-negi)))
json.dump(out,open('norm_v10.json','w'))
c=collections.Counter(o['platform'] for o in out); print(len(out),c,'sales',sum(o['provenance']['raw_sales'] for o in out))
import random; random.seed(2)
for o in random.sample(out,25): print(o['platform'],o['make_l'],'|',o['model_raw'],'->',o['model_canon'],o['confidence'])

"""Transform fix: infer Mecum auction venue for events missing metadata.auction_name from same-day named lots.
Rule: venue = dominant named venue on that sale day if it holds >=90% of named lots that day (motorcycle sales excluded from 'dominant' only by share)."""
import collections,re,random,sys
def norm(v): return re.sub(r'\s*\d{4}\s*','',v).strip()
def build(rows):
  named=collections.defaultdict(collections.Counter)
  for d,v in rows:
    if v: named[d][norm(v)]+=1
  return named
def infer(named,d):
  c=named.get(d)
  if not c: return None
  t,n=c.most_common(1)[0]
  return t if n/sum(c.values())>=0.9 else None
if __name__=='__main__':
  rows=[];ids=[]
  for line in open('../venue/all.psv'):
    f=line.rstrip('\n').split('|')
    if len(f)>=11 and f[1]=='mecum' and f[3]: rows.append((int(f[3])//86400,f[6]))
  random.seed(7); lab=[i for i,(d,v) in enumerate(rows) if v]; hide=set(random.sample(lab,len(lab)//5))
  named=build([(d,'' if i in hide else v) for i,(d,v) in enumerate(rows)])
  ok=tot=cov=0
  for i in hide:
    d,v=rows[i]; g=infer(named,d); tot+=1
    if g: cov+=1; ok+= g==norm(v)
  print(f'validation on {tot} hidden named lots: coverage {cov/tot:.3f}, accuracy when assigned {ok/max(cov,1):.4f}')

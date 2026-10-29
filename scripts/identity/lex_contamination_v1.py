import json,re,collections,random,sys
sys.path.insert(0,'/workspace/v39'); sys.path.insert(0,'/workspace/v41')
L=json.load(open('lex.json'))
# model-token category table from vin decode rows2 (independent of lex): (make, token)-> category counts
R=json.load(open('/workspace/v39/rows2.json'))
def ftok(s):
  for t in re.findall(r'[a-z0-9]+',(s or '').lower().replace('-','')):
    if not re.fullmatch(r'(19|20)\d\d',t) and t not in ('the','a','new','custom','modified','restored','original','benz','mercedes','davidson'): return t
  return None
def mk(s): return re.sub(r'[^a-z]','',(s or '').lower())[:6]
C=collections.defaultdict(collections.Counter)
bodycat=lambda b:'truck_utility' if re.search(r'(?i)pickup|truck|sport utility|van|bus|chassis|cutaway|cuv|crossover|mpv',b or '') else ('car' if re.search(r'(?i)coupe|sedan|convertible|hatch|wagon|roadster|cabrio|fastback|limousine',b or '') else None)
for r in R:
  c=bodycat(r[2]); t=ftok(r[9])
  if c and t: C[(mk(r[8]),t)][c]+=1
def cat(make,model):
  t=ftok(model); c=C.get((mk(make),t))
  if not c: return None,t
  k,n=c.most_common(1)[0]; tot=sum(c.values())
  return (k if tot>=10 and n/tot>=0.95 else None),t
out=[]
for r in L:
  id_,vid,ecat,mt,st,y,mk_,mo=r
  p=(st or '').split(' | ')
  if len(p)<3 or not p[2].strip(): continue
  title=p[2]
  m=re.search(r'\b(19|20)\d\d\s+(\S+(?:\s+\S+)?)\s+(.*)',title)
  if not m: continue
  if mk(m.group(2))[:4]!=mk(mk_)[:4] and mk(m.group(2).split()[0])[:4]!=mk(mk_)[:4]: continue
  tmodel=m.group(3) if mk(m.group(2).split()[0])[:4]!=mk(m.group(2))[:4] else m.group(3)
  if mk(m.group(2).split()[0])[:4]==mk(mk_)[:4] and len(m.group(2).split())>1: tmodel=m.group(2).split(1)[1] if False else m.group(2).split(' ',1)[1]+' '+m.group(3)
  vc,vt=cat(mk_,mo); tc,tt=cat(mk_,tmodel)
  nm=lambda x:re.sub(r'[^a-z0-9]','',(x or '').lower())
  if vt and tt and (vt in nm(tmodel) or tt in nm(mo)): continue
  if vc and tc and vc!=tc and ecat==tc: out.append([id_,vid,ecat,y,mk_,mo,title[:110],vc,tc])
print(len(out),collections.Counter((o[2],o[7],o[8]) for o in out))
json.dump(out,open('cont3.json','w'))
random.seed(5)
for o in random.sample(out,min(40,len(out))): print(o[2][:5],o[7][:5],o[8][:5],'|',o[3],o[4],o[5],'||',o[6])

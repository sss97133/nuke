import json,re,collections,sys
N=r'(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k?|\d+)'
U=r'(miles?|kilomet(?:er|re)s?|kms?)'
def num(t):
  t=t.lower().replace(',','');k=t.endswith('k');t=t.rstrip('k');return float(t)*(1000 if k else 1)
def unit(u): return 'km' if u and u.lower().startswith('k') else 'mi'
PAT=[
 (re.compile(r'(?:odometer|odo)\s+(?:reads|shows|indicates|displays|registers|reading of|showing)\s+(?:just\s+|only\s+|approximately\s+|about\s+|roughly\s+|under\s+)?'+N+r'\s*'+U+r'?',re.I),'odometer_reads'),
 (re.compile(N+r'\s+'+U+r'\s+(?:are\s+|were\s+)?(?:shown|indicated|showing|displayed|on the odometer|on the odo|registered)',re.I),'n_miles_shown'),
 (re.compile(r'(?:shows|indicates|displays|showing)\s+(?:just\s+|only\s+)?'+N+r'\s+'+U,re.I),'shows_n_miles'),
 (re.compile(N+r'\s+(?:actual|original|documented|believed[- ]original)\s+'+U+r'\b',re.I),'n_actual_miles'),
 (re.compile(r'\bhas\s+(?:just\s+|only\s+|approximately\s+|about\s+)?'+N+r'\s+'+U+r'\b',re.I),'has_n_miles'),
 (re.compile(r'^\s*'+N+r'\s+'+U+r'\b\s*(?:\([^)]*\))?\s*$',re.I),'bullet_n_miles'),
 (re.compile(r'(?:^|,\s*)'+N+r'\s+(Miles|Kilometers)\s*(?:,|$)'),'highlight_n_miles'),
]
TMU=re.compile(r'\b(tmu|(?:true|total|actual) mileage (?:is )?unknown|mileage (?:is )?unknown|odometer (?:was |has been )?replaced)\b',re.I)
HIST=re.compile(r'\b(at that time|at the time|when new|was replaced|in (?:19|20)\d\d|previous|prior to|since|driven|on the (?:engine|rebuild|restoration)|service|serviced|rebuilt|warranty|interval)\b',re.I)
def decide(r):
  pl=r['pl']; f=r.get('odo_field'); j=r.get('odo_json'); sn=r.get('snips') or []
  if pl=='mecum' and f:
    if TMU.search(f) or re.search(r'unknown|exempt',f,re.I): return dict(mi=None,tmu=True,claim='Odometer reads* '+f,rule='mecum_odometer_field_tmu')
    m=re.match(N+r'\s*'+U,f.strip(),re.I)
    if m:
      v=num(m.group(1)); u=unit(m.group(2)); mi=v*0.621371 if u=='km' else v
      since=bool(re.search(r'since',f,re.I))
      if mi>0: return dict(mi=round(mi),unit=u,orig=v,tmu=False,claim='Odometer reads* '+f,rule='mecum_odometer_field'+('_since' if since else ''))
  hits=[];tmu=None
  for s in sn:
    if TMU.search(s): tmu=s; continue
    if HIST.search(s): continue
    for rx,nm in PAT:
      g=rx.search(s)
      if g:
        v=num(g.group(1)); u=unit(g.group(2)); mi=v*0.621371 if u=='km' else v
        if 0<mi<1e6: hits.append((nm,round(mi),u,v,s))
        break
  if tmu: return dict(mi=None,tmu=True,claim=tmu[:240],rule=pl.split('-')[0]+'_text_tmu')
  if hits:
    vals=[h[1] for h in hits]
    if max(vals)-min(vals)>max(100,.02*max(vals)): return None
    nm,mi,u,v,s=hits[0]; return dict(mi=mi,unit=u,orig=v,tmu=False,claim=s[:240],rule=pl.split('-')[0]+'_text_'+nm)
  if pl=='mecum' and j and j[0] not in ('','0'):
    try: v=float(j[0])
    except: return None
    u='km' if j[1].upper().startswith('K') else 'mi'
    if v>0: return dict(mi=round(v*0.621371 if u=='km' else v),unit=u,orig=v,tmu=False,claim=f'odometer {j[0]} {j[1]} (page JSON)',rule='mecum_odometer_json')
  return None
if __name__=='__main__':
  R=[json.loads(l) for l in open('out.jsonl')]
  c=collections.Counter(); out=[]
  for r in R:
    if r['http']!='200': c[r['pl'],'http']+=1; continue
    d=decide(r); c[r['pl'],d['rule'] if d else 'none']+=1
    if d: d.update(a=r['a'],v=r['v'],u=r['u'],pl=r['pl'],at=r['at'],snips=r.get('snips'),odo_field=r.get('odo_field'),odo_json=r.get('odo_json')); out.append(d)
  print(len(R),sorted(c.items())); json.dump(out,open('parsed.json','w'))

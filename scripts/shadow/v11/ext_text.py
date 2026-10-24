import json,re,collections
s=json.load(open('/workspace/agent-tools/9e0666c5-d922-4977-b753-64593104749d.txt'))['result']
s=s[s.index('[{"json_agg"'):s.rindex('}]')+2]
R=json.loads(s)[0]['json_agg']
N=r'(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k?|\d+)'
U=r'(miles?|kilomet(?:er|re)s?|kms?)'
def num(t):
  t=t.lower().replace(',','');k=t.endswith('k');t=t.rstrip('k');v=float(t)*(1000 if k else 1);return v
def unit(u): return 'km' if u.lower().startswith('k') else 'mi'
PAT=[ # (regex, confidence, name)
 (re.compile(r'^\s*'+N+r'[- ]'+U+r'\b',re.I),.95,'title_prefix'),
 (re.compile(r'(?:odometer|odo)\s+(?:reads|shows|indicates|displays|registers|reading of|showing)\s+(?:just\s+|only\s+|approximately\s+|about\s+|roughly\s+|under\s+)?'+N+r'\s*'+U+r'?',re.I),.9,'odometer_reads'),
 (re.compile(N+r'\s+'+U+r'\s+(?:are\s+|were\s+)?(?:shown|indicated|showing|displayed|on the odometer|on the odo|registered)',re.I),.9,'n_miles_shown'),
 (re.compile(r'(?:shows|indicates|displays|showing)\s+(?:just\s+|only\s+)?'+N+r'\s+'+U,re.I),.85,'shows_n_miles'),
 (re.compile(r'highlights:\s*'+N+r'\s+(?:actual\s+|original\s+)?'+U+r'\b',re.I),.85,'highlights_first'),
 (re.compile(N+r'\s+(?:actual|original|documented|believed[- ]original)\s+'+U+r'\b',re.I),.85,'n_actual_miles'),
]
TMU=re.compile(r'\b(tmu|(?:true|total|actual) mileage (?:is )?unknown|mileage (?:is )?unknown|odometer (?:was |has been )?replaced)\b',re.I)
HIST=re.compile(r'\b(at that time|at the time|when new|was replaced|in (?:19|20)\d\d|previous|prior to)\b',re.I)
out={};stat=collections.Counter()
by=collections.defaultdict(list)
for r in R: by[r['a']].append(r)
for a,rs in by.items():
  hits=[];tmu=None
  for r in rs:
    for m in (r['m'] or []):
      if TMU.search(m) and re.search(r'mile|odomet|tmu',m,re.I): tmu=(r,m)
      if HIST.search(m): continue
      for rx,cf,nm in PAT:
        if nm=='title_prefix' and (not r['f'].endswith('title') or r['s'] in ('barrett-jackson','mecum')): continue
        g=rx.search(m)
        if g:
          v=num(g.group(1)); u=unit(g.group(2)) if g.lastindex>=2 and g.group(2) else 'mi'
          mi=v*0.621371 if u=='km' else v
          if 0<=mi<1e6: hits.append((cf,nm,round(mi),u,v,r,m.strip()))
          break
  if tmu:
    r,m=tmu; out[a]=dict(a=a,v=r['v'],u=r['u'],s=r['s'],mi=None,unit=None,orig=None,claim=m.strip()[:200],fld=r['f'],rule='tmu',conf=.8); stat['tmu_'+r['s']]+=1; continue
  if hits:
    vals=sorted(set(h[2] for h in hits)); tp=[h for h in hits if h[1]=='title_prefix']
    best=tp[0] if tp else max(hits,key=lambda h:h[0])
    if not tp and (max(vals)-min(vals))>max(100,.02*max(vals)): stat['conflict']+=1; continue
    cf,nm,mi,u,v,r,m=best
    out[a]=dict(a=a,v=r['v'],u=r['u'],s=r['s'],mi=mi,unit=u,orig=v,claim=m[:200],fld=r['f'],rule=nm,conf=cf)
    stat['num_'+r['s']]+=1
  elif tmu:
    r,m=tmu; out[a]=dict(a=a,v=r['v'],u=r['u'],s=r['s'],mi=None,unit=None,orig=None,claim=m.strip()[:200],fld=r['f'],rule='tmu',conf=.8); stat['tmu_'+r['s']]+=1
print(len(by),stat)
json.dump(list(out.values()),open('text_mi.json','w'))

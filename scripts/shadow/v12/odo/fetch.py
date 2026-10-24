# run odo_lotpage_read_v12: polite resumable single reader of Mecum + Barrett-Jackson lot pages for odometer-at-sale.
# ~1 req/s total; B-J only every 4th slot (~0.25/s) because /workspace/bjall already reads B-J at 1/s. Keeps snippets only (no HTML).
import json,subprocess,time,os,re,html as H
RUN='odo_lotpage_read_v12_20261024'
rows=json.load(open('missing.json'))
rows.sort(key=lambda r:r['d'] or '',reverse=True)
done=set()
if os.path.exists('out.jsonl'):
    for l in open('out.jsonl'):
        try: done.add(json.loads(l)['a'])
        except: pass
M=[r for r in rows if r['pl']=='mecum' and r['a'] not in done]; B=[r for r in rows if r['pl']!='mecum' and r['a'] not in done]
SENT=re.compile(r'[^.<>"]{0,160}\b(?:\d[\d,.]*k?\s*(?:actual\s+|original\s+|documented\s+)?(?:miles?|kilomet(?:er|re)s?|kms?)\b|tmu\b|mileage (?:is )?unknown|exempt)[^.<>"]{0,80}',re.I)
def parse(body,pl):
    t=H.unescape(body.replace('\\"','"'))
    o={'len':len(body)}
    m=re.search(r'Odometer reads(?:<sup>\*</sup>)?</p><p>([^<]{0,40})</p>',body)
    if m: o['odo_field']=H.unescape(m.group(1)).strip()
    m=re.search(r'"odometer":"([^"]*)","odometerUnits":"([^"]*)"',t)
    if m: o['odo_json']=[m.group(1),m.group(2)]
    m=re.search(r'<title>([^<]*)</title>',body); o['title']=m.group(1)[:200] if m else None
    s=[]; seen=set()
    for g in SENT.finditer(re.sub(r'<[^>]+>',' . ',t)):
        x=' '.join(g.group(0).split())
        if x not in seen: seen.add(x); s.append(x[:260])
        if len(s)>=12: break
    o['snips']=s
    return o
f=open('out.jsonl','a'); n=0; fails=0; mi=bi=0; slot=0
while mi<len(M) or bi<len(B):
    slot+=1
    if (slot%4==0 and bi<len(B)) or mi>=len(M): r=B[bi]; bi+=1
    else: r=M[mi]; mi+=1
    u=r['u']
    if 'barrett-jackson' in u: u=u.replace('://barrett-jackson.com','://www.barrett-jackson.com')
    t0=time.time()
    try:
        p=subprocess.run(['curl','-sL','--max-time','40','-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124','-w','\n%{http_code}',u],capture_output=True,timeout=60)
        body=p.stdout.decode('utf-8','ignore'); code=body[-3:]; body=body[:-4]
    except Exception: code='ERR'; body=''
    o=parse(body,r['pl']) if code=='200' else {}
    o.update(a=r['a'],v=r['v'],pl=r['pl'],u=r['u'],d=r['d'],http=code,run=RUN,at=time.strftime('%Y-%m-%dT%H:%M:%S'))
    f.write(json.dumps(o)+'\n'); f.flush(); n+=1
    fails=fails+1 if code!='200' else 0
    if fails>=20: print('20 consecutive failures, stopping',flush=True); break
    if n%250==0: print(time.strftime('%H:%M'),n,'mecum',mi,'bj',bi,flush=True)
    time.sleep(max(0,1.0-(time.time()-t0))+(30 if code in('429','503') else 0))
print('done',n,flush=True)

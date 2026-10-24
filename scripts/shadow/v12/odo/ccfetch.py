# run cc_odo_read_v12: polite single reader of Collecting Cars lot pages (1 req / 2 s); keeps schema.org mileageFromOdometer only.
import json,subprocess,time,re,os
rows=json.load(open('cc.json')); done=set()
if os.path.exists('cc_out.jsonl'): done={json.loads(l)['e'] for l in open('cc_out.jsonl')}
f=open('cc_out.jsonl','a')
for i,r in enumerate(rows):
    if r['e'] in done: continue
    t0=time.time()
    p=subprocess.run(['curl','-sL','--max-time','40','-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124','-w','\n%{http_code}',r['u']],capture_output=True,timeout=60)
    b=p.stdout.decode('utf-8','ignore'); code=b[-3:]
    m=re.search(r'"mileageFromOdometer":"([^"]*)"',b)
    f.write(json.dumps(dict(e=r['e'],u=r['u'],http=code,odo=m.group(1) if m else None,at=time.strftime('%Y-%m-%dT%H:%M:%S')))+'\n'); f.flush()
    if i%50==0: print(time.strftime('%H:%M'),i,flush=True)
    time.sleep(max(0,2-(time.time()-t0)))
print('done',flush=True)

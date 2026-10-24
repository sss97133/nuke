# independent re-read of ~50 parsed lot pages (1 req / 4 s), compares stored value with the page's own text.
import json,random,subprocess,time,re,html as H
P=json.load(open('parsed.json')); random.seed(12)
m=[d for d in P if d['pl']=='mecum' and d['mi'] is not None]; b=[d for d in P if d['pl']!='mecum' and d['mi'] is not None]
S=random.sample(m,35)+random.sample(b,min(15,len(b)))
out=[]
for d in S:
  u=d['u'].replace('://barrett-jackson.com','://www.barrett-jackson.com')
  p=subprocess.run(['curl','-sL','--max-time','40','-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124',u],capture_output=True,timeout=60)
  t=H.unescape(re.sub(r'<[^>]+>',' ',p.stdout.decode('utf-8','ignore')))
  nums=set(int(x.replace(',','')) for x in re.findall(r'(\d[\d,]*)\s*(?:actual\s+|original\s+)?(?:miles|kilomet)',t,re.I))
  orig=int(round(d['orig']))
  ok=orig in nums
  out.append(dict(a=d['a'],u=d['u'],rule=d['rule'],stored_mi=d['mi'],orig=orig,page_numbers=sorted(nums)[:10],ok=ok,checked_at=time.strftime('%Y-%m-%dT%H:%M:%S')))
  time.sleep(4)
json.dump(out,open('verify50_v12.json','w'),indent=0)
print('checked',len(out),'ok',sum(o['ok'] for o in out))

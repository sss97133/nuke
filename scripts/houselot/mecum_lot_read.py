# run mecum_lot_read_v1_20261024: read catalog lot from Mecum lot pages (LotHeader 'Lot X'), 1 request / 4 s. Page ids are never used as lots.
import json,re,time,subprocess,datetime
L=json.load(open('blocked238.json')); out=open('read238.jsonl','a')
done={json.loads(l)['id'] for l in open('read238.jsonl')} if True else set()
for r in L:
  if r['id'] in done: continue
  at=datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
  p=subprocess.run(['curl','-sL','-m','30','-A','Mozilla/5.0','-w','\n%{http_code}',r['u']],capture_output=True,text=True)
  body,_,code=p.stdout.rpartition('\n')
  m=re.search(r'__num">Lot ([A-Z]{1,3}[0-9]{1,4}(?:\.[0-9]{1,2})?)</span>',body)
  out.write(json.dumps(dict(id=r['id'],u=r['u'],http=code,lot=m.group(1) if m else None,at=at))+'\n'); out.flush()
  time.sleep(4)

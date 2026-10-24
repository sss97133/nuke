# run bj_results_v1_20261024: polite read of B-J's public past-results API (1 req / 2.5s), 1999-2020 events.
import json,subprocess,time,os,re
RUN='bj_results_v1_20261024'
ev=[x['attributes']['slug'] for x in json.load(open('events.json'))]
ev=[s for s in dict.fromkeys(ev) if (m:=re.search(r'(19|20)\d\d',s)) and 1999<=int(m.group(0)[:4] if len(m.group(0))==4 else 0)<=2020 or re.search(r'-(199[9]|20[01]\d|2020)\b',s)]
done=set(l.split('\t')[0] for l in open('done.tsv')) if os.path.exists('done.tsv') else set()
out=open('lots.jsonl','a'); dn=open('done.tsv','a')
KEEP=['item_id','lot_number','title','year','make','model','style','vin','price','price_decimal','is_sold','is_charity','is_canceled','reserve_type_name','run_datetime','event_slug','slug','exterior_color','engine_size','number_of_cylinders']
def get(u):
    p=subprocess.run(['curl','-s','--max-time','40','-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124','-w','\n%{http_code}',u],capture_output=True,timeout=60)
    b=p.stdout.decode('utf-8','ignore'); return b[-3:], b[:-4]
for s in ev:
    page=1
    while True:
        key=f'{s}|{page}'
        if key in done: page+=1; continue
        u=f'https://www.barrett-jackson.com/api/previous-docket-results?page={page}&type=vehicles&size=100&slug={s}'
        t0=time.time(); code,b=get(u)
        if code in('429','503'): print('backoff',code,flush=True); time.sleep(120); continue
        if code!='200': print('fail',code,key,flush=True); break
        d=json.loads(b); pc=d['meta']['pagination']['pageCount']
        for x in d['data']:
            a=x['attributes']; o={k:a.get(k) for k in KEEP}; o['src']=u; o['run']=RUN; o['at']=time.strftime('%Y-%m-%dT%H:%M:%S')
            out.write(json.dumps(o)+'\n')
        out.flush(); dn.write(f'{key}\t{pc}\n'); dn.flush()
        time.sleep(max(0,2.5-(time.time()-t0)))
        if page>=pc: break
        page+=1
    print(time.strftime('%H:%M'),s,flush=True)

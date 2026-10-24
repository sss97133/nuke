# builds idempotent SQL batches (<=1000 rows) for parsed lot-page odometers not yet inserted.
import json,uuid,os,sys
RUN='7e1d0c24-2026-4a10-9e00-0000000a5025'
P=json.load(open('parsed.json')); ins=set(open('inserted.txt').read().split()) if os.path.exists('inserted.txt') else set()
todo=[d for d in P if d['a'] not in ins]
q=lambda s: "'"+str(s).replace("'","''")+"'" if s is not None else 'null'
os.makedirs('sql',exist_ok=True); files=[]
for k in range(0,len(todo),1000):
  B=todo[k:k+1000]; sv=[]; lv=[]
  for d in B:
    sid=str(uuid.uuid5(uuid.NAMESPACE_URL,RUN+d['a']))
    md='\n'.join(([f"Odometer reads* {d['odo_field']}"] if d.get('odo_field') else [])+([f"odometer json {d['odo_json']}"] if d.get('odo_json') else [])+(d.get('snips') or []))
    meta=json.dumps(dict(run='odo_lotpage_read_v12_20261024',run_id=RUN,kind='odometer_snippets_only',auction_event_id=d['a']))
    plat='mecum' if d['pl']=='mecum' else 'barrett-jackson'
    sv.append(f"({q(sid)},{q(plat)},{q(d['u'])},{q(d['at']+'-07:00')},'curl_lotpage_odometer_snippets_v12',200,true,{q(md)},{q(meta)}::jsonb)")
    val=json.dumps(dict(rule=d['rule'],read_at=d['at']+'-07:00',orig_value=d.get('orig'),check='see shadow/v12 verify50_v12.json'))
    lv.append(f"({q(d['a'])},{d['mi'] if d['mi'] is not None else 'null'},{q(d.get('unit'))},{q(d['claim'])},{q(sid)},{q(d['u'])},{q('lotpage_'+d['rule']+'_v12')},{q(RUN)},{q(val)}::jsonb,{'true' if d['tmu'] else 'false'})")
  sql=("insert into listing_page_snapshots (id,platform,listing_url,fetched_at,fetch_method,http_status,success,markdown,metadata) values\n"+",\n".join(sv)+"\non conflict (id) do nothing;\n"
       "insert into auction_event_listing_mileage (auction_event_id,mileage_at_listing,mileage_unit,mileage_claim,source_snapshot_id,source_url,method,run_id,validation,mileage_tmu)\nselect x.* from (values\n"+",\n".join(lv)+"\n) x(a,m,u,c,s,url,me,r,va,t) join auction_events ae on ae.id=x.a::uuid\non conflict (auction_event_id) do nothing;\n")
  # fix types in values list
  sql=sql.replace("select x.* from","select x.a::uuid,x.m::int,x.u,x.c,x.s::uuid,x.url,x.me,x.r,x.va,x.t from")
  fn=f'sql/ins_{len(ins)+k:06d}.sql'; open(fn,'w').write(sql); files.append((fn,[d['a'] for d in B]))
json.dump(files,open('pending.json','w')); print(len(todo),[f for f,_ in files])

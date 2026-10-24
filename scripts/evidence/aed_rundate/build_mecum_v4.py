import json,datetime,sys
rows={r[0]:r for r in json.load(open('../bj_rundate/mecum_null_rows.json'))}
done=set()
try: done=set(json.load(open('applied_ids.json')))
except Exception: pass
ok=[]
for l in open('../bj_rundate/mecum_all.jsonl'):
    x=json.loads(l); r=rows[x['id']]
    if x['id'] in done or x.get('status')!=200 or not x.get('run_date'): continue
    if r[3] not in ('sold','bid_to','no_sale'): continue
    if (x.get('page_lot') or '').strip().upper()!=(r[2] or '').strip().upper(): continue
    if not ('2000-01-01'<=x['run_date']<=datetime.date.today().isoformat()): continue
    ok.append((x['id'],x['run_date'],x['url'],x['page_lot']))
RUN='aed_backfill_v4_mecum_rundate'
files=[]
for k in range(0,len(ok),500):
    b=ok[k:k+500]
    vals=",".join(f"('{i}'::uuid,'{d}'::date,'{u.replace(chr(39),chr(39)*2)}','{p.replace(chr(39),chr(39)*2)}')" for i,d,u,p in b)
    q=f"""with s(id,run_date,url,page_lot) as (values {vals}),
u as (update auction_events ae set auction_end_date=s.run_date::timestamptz
  from s where ae.id=s.id and ae.source='mecum' and ae.auction_end_date is null
   and ae.outcome in ('sold','bid_to','no_sale') and upper(trim(ae.lot_number))=upper(trim(s.page_lot))
  returning ae.id, s.run_date, s.url),
l as (insert into auction_end_date_backfill_log(auction_event_id,run_id,old_value,new_value,source_table,source_column,source_row_id)
  select id,'{RUN}',null,run_date::timestamptz,'mecum.com lot page (embedded RunDate JSON)','run_date',url from u returning 1)
select count(*) from l"""
    fn=f'b{k//500:03d}.sql'; open(fn,'w').write(q); files.append(fn)
json.dump([i for i,*_ in ok],open('pending_ids.json','w'))
print(len(ok),files)

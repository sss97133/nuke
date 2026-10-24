import json,re
res=json.load(open('confirmed.json'));dates=json.load(open('auction_dates.json'))
RUN='rm_ingest_v1_20261024'
def q(s): return 'null' if s is None else "'"+str(s).replace("'","''")+"'"
rows=[]
seen=set()
for r in res:
    if r['link'] in seen: continue
    seen.add(r['link'])
    d=dates.get(r['code'])
    nm=r['name'].split();yr=int(nm[0]);mk=nm[1] if len(nm)>1 else None;md=' '.join(nm[2:]) or None
    key=re.sub(r'^https?://','',r['link']).rstrip('/')
    rows.append("("+",".join([q(r['link']),q(key),q(r['lot']),str(r['price']),q(r['cur']),q(d[0] if d else None),q(r['code'].upper()),q(r['header']),str(yr),q(mk),q(md),q(r['name']),q(r['loc']),q(r['bid']),q(r['coll']),q(r['e']),q(d[2] if d else None)])+")")
import sys
B=int(sys.argv[1]) if len(sys.argv)>1 else 100
for bi in range(0,len(rows),B):
  vals=",\n".join(rows[bi:bi+B])
  body=f"""
  create temp table rmi(link text,lkey text,lot text,price numeric,cur text,sale_day date,code text,aname text,yr int,make text,model text,title text,loc text,bid text,coll text,cc_event uuid,date_text text) on commit drop;
  insert into rmi values
  {vals};
  -- skip lots already held as an rm-sothebys event (with or without the trailing slash)
  delete from rmi where exists(select 1 from vehicle_events e where e.source_url = rmi.link and e.source_platform='rm-sothebys') or exists(select 1 from vehicle_events e where e.source_url = rtrim(rmi.link,'/') and e.source_platform='rm-sothebys');
  alter table rmi add column vid uuid;
  update rmi set vid=coalesce(
   (select v.id from vehicles v where v.listing_url=rmi.link and v.deleted_at is null limit 1),
   (select v.id from vehicles v where v.listing_url=rtrim(rmi.link,'/') and v.deleted_at is null limit 1),
   (select v.id from vehicles v where v.discovery_url=rmi.link and v.deleted_at is null limit 1),
   (select v.id from vehicles v where v.discovery_url=rtrim(rmi.link,'/') and v.deleted_at is null limit 1));
  with nv as (
   insert into vehicles(year,make,model,listing_url,discovery_url,discovery_source,profile_origin,is_public,status,sale_status,origin_metadata)
   select yr,make,model,link,link,'rmsothebys','rmsothebys_import',true,'active','sold',
    jsonb_build_object('source','rmsothebys','auction_house','RM Sotheby''s','lot_number',lot,'auction_name',aname,'auction_code',code,'currency',cur,'sold_price',price,'run_id','{RUN}','citation_url',link,'imported_at',now())
   from rmi where vid is null returning id,listing_url)
  update rmi set vid=nv.id from nv where nv.listing_url=rmi.link and rmi.vid is null;
  insert into vehicle_events(vehicle_id,source_platform,event_type,event_status,source_url,source_listing_id,final_price,currency_code,sold_at,sold_at_precision,extraction_method,extraction_run_id,extracted_at,lot_number,lot_number_source_url,lot_number_run_id,lot_number_read_at,metadata)
  select vid,'rm-sothebys','auction','sold',link,lkey,price,cur,
   case when sale_day is not null then (sale_day::text||'T12:00:00Z')::timestamptz end,
   case when sale_day is not null then 'rm_results_page_date' end,
   'rmsothebys_api_searchlots','{RUN}',now(),lot,link,'{RUN}',now(),
   jsonb_build_object('lot_number',lot,'auction_code',code,'auction_name',aname,'currency',cur,'sale_location',loc,'bidding_type',bid,'collection',coll,'title',title,'sale_date_text',date_text,'sale_date_source','https://rmsothebys.com/results/'||extract(year from sale_day)::int,
    'run_id','{RUN}','citation',jsonb_build_object('url',link,'api','https://rmsothebys.com/api/search/SearchLots','value_type','Sold'),'confirms_cc_event',cc_event)
  from rmi;
  select (select count(*) from rmi) lots,(select count(*) from vehicle_events e join rmi on e.source_url=rmi.link and e.source_platform=$$rm-sothebys$$) events,(select count(*) from rmi join vehicles v on v.id=rmi.vid where v.origin_metadata->>'run_id'='{RUN}') new_vehicles;
  """
  H="begin; set local statement_timeout='50s'; set local lock_timeout='5s';\n"
  open(f'b/test_{bi//B:02d}.sql','w').write(H+body+"rollback;\n")
  open(f'b/apply_{bi//B:02d}.sql','w').write(H+body+"commit;\n")
  print(len(rows))

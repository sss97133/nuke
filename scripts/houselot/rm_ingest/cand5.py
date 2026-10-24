import json,re
exec(open('match.py').read().split("res=[]")[0])
conf={r['e']:r for r in json.load(open('confirmed.json'))}
ew={e['e']:e for e in ev}
rows=[];n=collections.Counter()
for eid,r in conf.items():
    e=ew[eid];p=plan[e['ce']];ys=str(e['y']);body=[w for w in tok(e['t']) if w!=ys]
    al=[l for c in p['codes'] for l in lots[c] if tok(l['publicName'])[:1]==[ys]]
    n2=sum(body[0] in tok(l['publicName']) for l in al)
    n3=sum(all(w in tok(l['publicName']) for w in body) for l in al)
    ok3=all(w in tok(r['name']) for w in body)
    n[(n2==1,n3==1 and ok3)]+=1
    rows.append((eid,e['v'],r['link'],n2,n3 if ok3 else 0,e['t'].replace("'","''"),e['lo'] or p['lo'],e['hi'] or p['hi']))
print(n)
v=",\n".join(f"('{a}'::uuid,'{b}'::uuid,'{c}',{d},{f},'{t}','{lo}'::date,'{hi}'::date)" for a,b,c,d,f,t,lo,hi in rows)
open('cand5.sql','w').write(f"""begin; set local statement_timeout='50s'; set local lock_timeout='5s';
create temp table x(event_id uuid,from_vehicle_id uuid,link text,n2 int,n3 int,title text,win_lo date,win_hi date) on commit drop;
insert into x values {v};
create table public.agg_houselot_v1_20261024_cand5a as
 select x.event_id,x.from_vehicle_id,he.vehicle_id to_vehicle_id,he.id cited_event_id,'rm-sothebys'::text house,x.title,x.win_lo,x.win_hi,x.n2 n_cand
 from x join public.vehicle_events he on he.source_url=x.link and he.source_platform='rm-sothebys' and he.extraction_run_id='rm_ingest_v1_20261024';
create table public.agg_houselot_v1_20261024_cand5b as
 select event_id,from_vehicle_id,to_vehicle_id,cited_event_id,house,title,win_lo,win_hi,x.n3 n_cand from public.agg_houselot_v1_20261024_cand5a a join x using(event_id,from_vehicle_id,title,win_lo,win_hi);
alter table public.agg_houselot_v1_20261024_cand5a enable row level security; alter table public.agg_houselot_v1_20261024_cand5b enable row level security;
select (select count(*) from public.agg_houselot_v1_20261024_cand5a) a,(select count(*) from public.agg_houselot_v1_20261024_cand5b where n_cand=1) b1,(select count(*) from public.agg_houselot_v1_20261024_cand5a where n_cand=1) a1;
commit;
""")

-- Candidates for run agg_reattach_v1_20261024: per flagged conceptcarz event with a title chassis, the number of live vehicles whose
-- VIN matches it (aggregator_chassis_vin_match rule: equal, or the shorter (>=6) is a suffix of the longer). Side table only.
set statement_timeout='170s';
create table if not exists public.agg_reattach_v1_20261024_cand (event_id uuid primary key, from_vehicle_id uuid, chassis text,
  title_year int, n_match int, to_vehicle_id uuid, to_vin text, to_year int, decided text, computed_at timestamptz default now());
alter table public.agg_reattach_v1_20261024_cand enable row level security;
with f as (
  select e.id, e.vehicle_id, public.aggregator_chassis_norm(substring(e.source_url from '(?i)chassis\s*#\s*:?\s*(.*)$')) ch,
         nullif(substring(e.source_url from '^conceptcarz://event/\d+/(\d{4}) '),'')::int ty
  from vehicle_events e where e.source_url like 'conceptcarz://%' and 'vehicle_id'=any(e.source_suspect)
), c as (select * from f where ch is not null),
vv as materialized (select v.id, public.aggregator_chassis_norm(v.vin) vin, v.year from vehicles v
  where v.vin is not null and v.deleted_at is null and v.status is distinct from 'merged' and v.merged_into_vehicle_id is null),
lens as (select distinct length(ch) l from c where length(ch)>=6),
vs as materialized (select vv.id, vv.year, vv.vin, right(vv.vin, lens.l) suf, lens.l from vv join lens on length(vv.vin) >= lens.l),
cs as (select c.id, gs l, right(c.ch, gs) suf from c, generate_series(6, length(c.ch)-1) gs),
m as (
  select c.id event_id, vv.id vid from c join vv on vv.vin = c.ch
  union select c.id, vs.id from c join vs on vs.l = length(c.ch) and vs.suf = c.ch
  union select cs.id, vv.id from cs join vv on length(vv.vin) = cs.l and vv.vin = cs.suf
), g as (select event_id, count(distinct vid) n, min(vid::text)::uuid vid from m group by 1)
insert into public.agg_reattach_v1_20261024_cand (event_id, from_vehicle_id, chassis, title_year, n_match, to_vehicle_id, to_vin, to_year)
select c.id, c.vehicle_id, c.ch, c.ty, coalesce(g.n,0), case when g.n=1 then g.vid end, v.vin, v.year
from c left join g on g.event_id=c.id left join vehicles v on v.id = case when g.n=1 then g.vid end
on conflict (event_id) do nothing;
select count(*) n, count(*) filter (where n_match=0) m0, count(*) filter (where n_match=1) m1, count(*) filter (where n_match>1) mN,
 count(*) filter (where n_match=1 and title_year is not null and to_year is not null and title_year<>to_year) m1_yeardiff,
 count(*) filter (where n_match=1 and to_vehicle_id=from_vehicle_id) same from public.agg_reattach_v1_20261024_cand;

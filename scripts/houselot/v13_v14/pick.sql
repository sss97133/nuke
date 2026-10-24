-- run agg_houselot_v14_20261024 step 2: tie-break with cited evidence only (exact sale price on the house lot record; title words found in only one lot's page URL).
set statement_timeout='55s';
drop table if exists public.agg_houselot_v14_20261024_pick;
create table public.agg_houselot_v14_20261024_pick as
with v as (select event_id, to_vehicle_id, bool_or(exact_price) ep, bool_or(exact_premium_price) epp, max(cardinality(hitw)) nw from public.agg_houselot_v14_20261024_pairs group by 1,2),
e as (select event_id,
  count(*) filter (where ep) n_ep, count(*) filter (where epp) n_epp,
  max(nw) mx, count(*) filter (where nw=(select max(nw) from v v2 where v2.event_id=v.event_id)) n_mx,
  (array_agg(to_vehicle_id) filter (where ep))[1] vid_ep, (array_agg(to_vehicle_id) filter (where epp))[1] vid_epp,
  (array_agg(to_vehicle_id order by nw desc))[1] vid_w
  from v group by 1),
d as (select e.*,
  case when n_ep=1 then vid_ep when n_ep=0 and n_epp=1 then vid_epp end vid_price,
  case when mx>0 and n_mx=1 then vid_w end vid_word from e)
select d.*, coalesce(vid_price, vid_word) pick_vid,
  case when vid_price is not null and vid_word is not null and vid_price<>vid_word then 'conflict: price and words point to different lots'
       when n_ep>1 or (n_ep=0 and n_epp>1) then 'tie: exact price on >1 lot'
       when vid_price is not null and n_ep=1 then 'exact price'
       when vid_price is not null then 'exact price incl. 10% premium'
       when vid_word is not null then 'title word only on this lot'
       else 'no distinguishing evidence' end basis
from d;
alter table public.agg_houselot_v14_20261024_pick enable row level security;
select basis, count(*) from public.agg_houselot_v14_20261024_pick group by 1 order by 2 desc;

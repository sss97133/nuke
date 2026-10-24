set statement_timeout='55s';
drop table if exists public.agg_houselot_v17_20261024_gate;
create table public.agg_houselot_v17_20261024_gate as
with g as (select x.event_id,x.from_vehicle_id,x.title,x.title_year,x.win_lo,x.win_hi,x.cc_price from public.agg_houselot_v15_20261024_gate x where x.reason like 'h00%' and coalesce(x.routed_to,x.house)='mccormicks'),
m as (select g.event_id, s.id sid, s.auction_nbr, s.lot_number, s.price_usd, s.price_net_usd, s.buyer_fee_pct, s.model
  from g join public.mccormick_results_stage_v1_20261024 s on s.status='sold' and s.year=g.title_year::text
   and s.sale_month between g.win_lo-40 and g.win_hi+40 and upper(g.title) like '%'||split_part(upper(s.make),' ',1)||'%'),
c as (select g.*, e.source_suspect, e.price_verification pv, e.event_status es, e.vehicle_id cur_vid, e.source_url,
  (select count(*) from m where m.event_id=g.event_id) n_cand,
  (select min(sid) from m where m.event_id=g.event_id) sid from g join public.vehicle_events e on e.id=g.event_id)
select c.*, s.auction_nbr, s.lot_number, s.model lot_model, s.price_usd lot_gross, s.price_net_usd lot_net, s.buyer_fee_pct, s.source_url lot_url,
 (select count(*) from m where m.sid=c.sid) k,
 case when c.cc_price is null or s.id is null then null else round(abs(c.cc_price-s.price_net_usd)/greatest(s.price_net_usd,1),3) end net_gap,
 case when c.cc_price is null or s.id is null then null else round(abs(c.cc_price-s.price_usd)/greatest(s.price_usd,1),3) end gross_gap,
 case
  when n_cand=0 then 'h01 no lot'
  when n_cand>1 then 'h02 >1 lot'
  when cur_vid<>from_vehicle_id then 'h04 event moved'
  when not ('vehicle_id'=any(coalesce(source_suspect,'{}'))) then 'h05 event not flagged'
  when pv='contradicted' or (pv='verified' and es='sold') then 'h06 verified/contradicted'
  when (select count(*) from m where m.sid=c.sid)>1 then 'h07 lot claimed by >1 event'
  when s.buyer_fee_pct is null then 'h14 no cited buyer fee (gross/net unknown)'
  when true then 'h08 house identity not confirmed (source has no VIN; no McCormick house event on any vehicle)'
 end reason
from c left join public.mccormick_results_stage_v1_20261024 s on s.id=c.sid;
alter table public.agg_houselot_v17_20261024_gate enable row level security;
select reason, count(*), count(*) filter (where net_gap<=0.2) net_within20, count(*) filter (where net_gap=0) net_exact, count(*) filter (where gross_gap=0) gross_exact from public.agg_houselot_v17_20261024_gate group by 1 order by 1;

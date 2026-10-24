-- run agg_houselot_v14_20261024 step 1: every candidate lot for the 158 v11 events held h02 (>1 lot at new house), with tie-break evidence.
set statement_timeout='55s';
drop table if exists public.agg_houselot_v14_20261024_pairs;
create table public.agg_houselot_v14_20261024_pairs as
with g as (
  select n.event_id id, n.from_vehicle_id, n.title, n.title_year ty, n.win_lo lo, n.win_hi hi, e.final_price,
    case e.source_platform when 'mecum' then 'mecum' when 'rm-sothebys' then 'rm' when 'bonhams' then 'bonhams' end house,
    ' '||lower(regexp_replace(regexp_replace(regexp_replace(n.title,'(?i)(convertible|coupe|hardtop|roadster|sedan|wagon|pickup|spider|spyder|cabriolet)ch[a-z]*$','\1'),'^\d{4}\s*',''),'[^A-Za-z0-9.]+',' ','g'))||' ' tnorm
  from public.agg_houseroute_v10_20261024_nowin n join public.vehicle_events e on e.id=n.event_id
  where e.metadata->'house_route'->>'run_id'='agg_houseroute_v10_20261024' and n.event_id in (select event_id from public.agg_houselot_v11_20261024_gate where reason like 'h02%')
), p as (
  select g.id, hv.hid, hv.hvid, hv.mk, btrim(substr(g.tnorm, length(hv.mk)+3)) ccm, split_part(hv.md,' ',1) hw, g.ty,
    ' '||lower(regexp_replace(hv.source_url,'[^A-Za-z0-9]+',' ','g'))||' ' hu, hv.source_url hurl, hv.hp
  from g join public.agg_houselot_v1_20261024_house hv on hv.house=g.house and hv.year=g.ty
   and hv.hsold >= g.lo and hv.hsold < g.hi + 1 and hv.hid<>g.id and g.tnorm like ' '||hv.mk||' %' and hv.md <> ''
), a as (
  select p.* from p where split_part(ccm,' ',1)=hw or exists (select 1 from public.agg_houselot_model_alias_v1 al where al.first_word_ok
     and al.make=p.mk and al.cc_word=split_part(p.ccm,' ',1) and al.house_word=p.hw and p.ty between al.year_lo and al.year_hi)
), m as (
  select a.*, (select coalesce(array_agg(w.t),'{}') from regexp_split_to_table(regexp_replace(a.ccm,'\.',' ','g'),' ') w(t)
     where length(w.t)>=2 and position(' '||w.t||' ' in a.hu)=0
       and not exists (select 1 from public.agg_houselot_model_alias_v1 al where al.make=a.mk and al.cc_word=w.t and a.ty between al.year_lo and al.year_hi and position(' '||al.house_word||' ' in a.hu)>0)) miss
  from a
), w as (
  select m.*, he.final_price hp_now, he.source_listing_id hlot,
   -- title words (>=3 chars, not year/make/first model word, not body/trans filler) that appear in this lot's URL slug
   (select coalesce(array_agg(distinct t),'{}') from regexp_split_to_table(m.ccm,' ') t
     where length(t)>=3 and t<>m.hw and t !~ '^(automatic|manual|speed|convertible|coupe|sedan|roadster|hardtop|fastback|wagon|pickup|door|the|and|with)$'
       and position(' '||t||' ' in m.hu)>0 and t<>split_part(m.ccm,' ',1)) hitw
  from m left join public.vehicle_events he on he.id=m.hid
)
select w.id event_id, g.title, g.final_price cc_price, w.hid cited_event_id, w.hvid to_vehicle_id, w.hurl cited_url, w.hp house_price, w.hlot, w.miss, w.hitw,
  (g.final_price = w.hp) exact_price,
  (g.final_price = round(w.hp*1.10) or round(g.final_price/1.10)=w.hp) exact_premium_price
from w join g on g.id=w.id;
alter table public.agg_houselot_v14_20261024_pairs enable row level security;
select count(distinct event_id) events, count(*) pairs from public.agg_houselot_v14_20261024_pairs;

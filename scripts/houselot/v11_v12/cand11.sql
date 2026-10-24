-- run agg_houselot_v11_20261024 candidates: the 425 events routed by agg_houseroute_v10_20261024, matched against their new house's lots
-- (same house + sale window + year + make + first model word or cited alias; missing title words body/spec only = v7 near-miss rule).
set statement_timeout='55s';
drop table if exists public.agg_houselot_v11_20261024_cand;
create table public.agg_houselot_v11_20261024_cand as
with g as (
  select n.event_id id, n.from_vehicle_id, n.title, n.title_year ty, n.win_lo lo, n.win_hi hi, e.final_price,
    case e.source_platform when 'mecum' then 'mecum' when 'rm-sothebys' then 'rm' when 'bonhams' then 'bonhams' end house,
    ' '||lower(regexp_replace(regexp_replace(regexp_replace(n.title,'(?i)(convertible|coupe|hardtop|roadster|sedan|wagon|pickup|spider|spyder|cabriolet)ch[a-z]*$','\1'),'^\d{4}\s*',''),'[^A-Za-z0-9.]+',' ','g'))||' ' tnorm
  from public.agg_houseroute_v10_20261024_nowin n join public.vehicle_events e on e.id=n.event_id
  where e.metadata->'house_route'->>'run_id'='agg_houseroute_v10_20261024'
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
), ca as (select id, count(distinct hvid) n from a group by 1)
select g.id event_id, g.house, g.from_vehicle_id, g.title, g.ty title_year, g.lo win_lo, g.hi win_hi, g.final_price cc_price, coalesce(ca.n,0) n_cand,
  m.hid cited_event_id, m.hvid to_vehicle_id, m.hurl cited_url, m.hp house_price, m.miss,
  coalesce(m.miss <@ array['automatic','automati','manual','speed','ci','hp','cid','cu','in','by','coachwork','convertible','conver','coupe','coup','cou','sedan','roadster','hardtop','hard','top','door','two','four','2d','4d','fastback','wagon','station','car','the','of']
    or (select bool_and(x ~ '^(\d{3}|\d+l|\d)$' or x = any(array['automatic','automati','manual','speed','ci','hp','cid','cu','in','by','coachwork','convertible','conver','coupe','coup','cou','sedan','roadster','hardtop','hard','top','door','two','four','2d','4d','fastback','wagon','station','car','the','of'])) from unnest(m.miss) x), false) bodyonly,
  now() computed_at
from g left join ca on ca.id=g.id left join m on m.id=g.id and ca.n=1;
select n_cand=1 uniq, bodyonly, count(*) from public.agg_houselot_v11_20261024_cand group by 1,2 order by 1,2;

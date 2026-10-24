-- run agg_houselot_v4_20261024 candidates (alias run): flagged conceptcarz events with no cand3 match -> house event, same house + same
-- sale window + year + make, first model word equal or a cited alias (first_word_ok), and (4b only) every title word of 2+ chars present in
-- the house lot URL, where present = the word itself, the word joined to its neighbour (srt 10 / srt10), or a cited alias in the alias table.
-- Title fix: a body word glued to a truncated "Chassis#" (convertiblechassis, coupech) is cut back to the body word.
-- 4a = first-word rule, 4b = first-word + all-words rule; the matcher needs both unique and agreeing (same as cand2/cand3).
set statement_timeout='50s';
create table if not exists public.agg_houselot_v1_20261024_cand4a (like public.agg_houselot_v1_20261024_cand3 including all);
create table if not exists public.agg_houselot_v1_20261024_cand4b (like public.agg_houselot_v1_20261024_cand3 including all);
alter table public.agg_houselot_v1_20261024_cand4a enable row level security;
alter table public.agg_houselot_v1_20261024_cand4b enable row level security;
with g0 as (
  select c3.event_id id, c3.from_vehicle_id vehicle_id, e.final_price, c3.house, c3.title, c3.title_year ty, c3.win_lo lo, c3.win_hi hi,
    regexp_replace(c3.title, '(?i)(convertible|coupe|hardtop|roadster|sedan|wagon|pickup|spider|spyder|cabriolet)ch[a-z]*$', '\1') t2
  from public.agg_houselot_v1_20261024_cand3 c3 join public.vehicle_events e on e.id=c3.event_id and e.vehicle_id=c3.from_vehicle_id
  where c3.n_cand=0 and c3.win_lo is not null and 'vehicle_id'=any(coalesce(e.source_suspect,'{}')) and left(c3.event_id::text,1)=:'b'
), g as (select g0.*, ' '||lower(regexp_replace(regexp_replace(t2,'^\d{4}\s*',''),'[^A-Za-z0-9]+',' ','g'))||' ' tnorm from g0
), p as (
  select g.id event_id, hv.hid, hv.hvid, hv.mk, btrim(substr(g.tnorm, length(hv.mk)+3)) ccm, split_part(hv.md,' ',1) hw, g.ty,
    ' '||lower(regexp_replace(hv.source_url,'[^A-Za-z0-9]+',' ','g'))||' ' hu
  from g join public.agg_houselot_v1_20261024_house hv on hv.house=g.house and hv.year=g.ty
   and hv.hsold >= g.lo and hv.hsold < g.hi + 1 and hv.hid<>g.id and g.tnorm like ' '||hv.mk||' %' and hv.md <> ''
), a as (
  select p.* from p where split_part(ccm,' ',1)=hw or exists (select 1 from public.agg_houselot_model_alias_v1 al where al.first_word_ok
     and al.make=p.mk and al.cc_word=split_part(p.ccm,' ',1) and al.house_word=p.hw and p.ty between al.year_lo and al.year_hi)
), b as (
  select a.* from a where not exists (
    select 1 from (select t, i, lag(t) over (order by i) pv, lead(t) over (order by i) nx
                   from regexp_split_to_table(a.ccm,' ') with ordinality x(t,i)) w
    where length(w.t)>=2 and position(' '||w.t||' ' in a.hu)=0
      and (w.nx is null or position(' '||w.t||w.nx||' ' in a.hu)=0)
      and (w.pv is null or position(' '||w.pv||w.t||' ' in a.hu)=0)
      and not exists (select 1 from public.agg_houselot_model_alias_v1 al where al.make=a.mk and al.cc_word=w.t
                      and a.ty between al.year_lo and al.year_hi and position(' '||al.house_word||' ' in a.hu)>0))
), ca as (select event_id, count(distinct hvid) n, min(hid::text)::uuid hid from a group by 1
), cb as (select event_id, count(distinct hvid) n, min(hid::text)::uuid hid from b group by 1
), ia as (
  insert into public.agg_houselot_v1_20261024_cand4a (event_id, house, from_vehicle_id, title, title_year, win_lo, win_hi, n_cand,
    cited_event_id, to_vehicle_id, cited_url, cited_lot, cited_sold_at, cc_price, house_price)
  select g.id, g.house, g.vehicle_id, g.title, g.ty, g.lo, g.hi, coalesce(c.n,0), case when c.n=1 then c.hid end, case when c.n=1 then he.vehicle_id end,
    he.source_url, he.source_listing_id, he.sold_at, g.final_price, he.final_price
  from g left join ca c on c.event_id=g.id left join public.vehicle_events he on he.id = case when c.n=1 then c.hid end
  on conflict (event_id) do nothing returning 1
)
insert into public.agg_houselot_v1_20261024_cand4b (event_id, house, from_vehicle_id, title, title_year, win_lo, win_hi, n_cand,
  cited_event_id, to_vehicle_id, cited_url, cited_lot, cited_sold_at, cc_price, house_price)
select g.id, g.house, g.vehicle_id, g.title, g.ty, g.lo, g.hi, coalesce(c.n,0), case when c.n=1 then c.hid end, case when c.n=1 then he.vehicle_id end,
  he.source_url, he.source_listing_id, he.sold_at, g.final_price, he.final_price
from g left join cb c on c.event_id=g.id left join public.vehicle_events he on he.id = case when c.n=1 then c.hid end
where (select count(*) from ia)>=0
on conflict (event_id) do nothing;
select :'b' b, (select count(*) from public.agg_houselot_v1_20261024_cand4b where left(event_id::text,1)=:'b') n,
  (select count(*) from public.agg_houselot_v1_20261024_cand4b where n_cand=1 and left(event_id::text,1)=:'b') m1b,
  (select count(*) from public.agg_houselot_v1_20261024_cand4a where n_cand=1 and left(event_id::text,1)=:'b') m1a;

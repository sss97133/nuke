-- run agg_houselot_v1_20261024 candidates: flagged conceptcarz event -> house event, same house + same sale window + year + make + model token, unique.
set statement_timeout='50s';
create table if not exists public.agg_houselot_v1_20261024_cand3 (event_id uuid primary key, house text, from_vehicle_id uuid,
  title text, title_year int, win_lo date, win_hi date, n_cand int, cited_event_id uuid, to_vehicle_id uuid, cited_url text,
  cited_lot text, cited_sold_at timestamptz, cc_price numeric, house_price numeric, computed_at timestamptz default now());
alter table public.agg_houselot_v1_20261024_cand3 enable row level security;
with f as (
  select e.id, e.vehicle_id, e.final_price,
    case when e.source_platform in ('barrettjackson','barrett-jackson') then 'bj' when e.source_platform='mecum' then 'mecum'
         when e.source_platform in ('rm-sothebys','rmsothebys') then 'rm' when e.source_platform='bonhams' then 'bonhams' end house,
    btrim(regexp_replace(substring(e.source_url from '^conceptcarz://event/\d+/(.*)$'), '(?i)chassis\s*#.*$', '')) title,
    e.sold_at, e.sold_at_precision
  from vehicle_events e where e.source_url like 'conceptcarz://%' and 'vehicle_id'=any(e.source_suspect) and left(e.id::text,1)=:'b'
), g as (
  select f.*, nullif(substring(title from '^(\d{4})\M'),'')::int ty,
    ' '||lower(regexp_replace(regexp_replace(title,'^\d{4}\s*',''),'[^A-Za-z0-9]+',' ','g'))||' ' tnorm,
    case when sold_at is null or sold_at_precision='unknown' then null
         when sold_at_precision='day' or (sold_at_precision is null and extract(day from sold_at)<>15) then (sold_at::date-2)
         else (date_trunc('month',sold_at)::date-2) end lo,
    case when sold_at is null or sold_at_precision='unknown' then null
         when sold_at_precision='day' or (sold_at_precision is null and extract(day from sold_at)<>15) then (sold_at::date+2)
         else ((date_trunc('month',sold_at)+interval '1 month')::date+1) end hi
  from f where house is not null
), h as (
  select g.id event_id, hv.hid, hv.hvid, hv.hsold from g join public.agg_houselot_v1_20261024_house hv on hv.house=g.house and hv.year=g.ty
   and hv.hsold >= g.lo and hv.hsold < g.hi + 1 and hv.hid<>g.id
   and g.tnorm like ' '||hv.mk||' %'
   and hv.md <> '' and split_part(btrim(substr(g.tnorm, length(hv.mk)+3)),' ',1) = split_part(hv.md,' ',1)
   and not exists (select 1 from regexp_split_to_table(btrim(substr(g.tnorm, length(hv.mk)+3)),' ') t
        where length(t)>=2 and position(' '||t||' ' in ' '||lower(regexp_replace(hv.source_url,'[^A-Za-z0-9]+',' ','g'))||' ')=0)
), c as (select event_id, count(distinct hvid) n, min(hid::text)::uuid hid from h group by 1)
insert into public.agg_houselot_v1_20261024_cand3 (event_id, house, from_vehicle_id, title, title_year, win_lo, win_hi, n_cand,
  cited_event_id, to_vehicle_id, cited_url, cited_lot, cited_sold_at, cc_price, house_price)
select g.id, g.house, g.vehicle_id, g.title, g.ty, g.lo, g.hi, coalesce(c.n,0),
  case when c.n=1 then c.hid end, case when c.n=1 then he.vehicle_id end, he.source_url, he.source_listing_id, he.sold_at, g.final_price, he.final_price
from g left join c on c.event_id=g.id left join vehicle_events he on he.id = case when c.n=1 then c.hid end
on conflict (event_id) do nothing;
select :'b' b, count(*) n, count(*) filter (where n_cand=1) m1, count(*) filter (where n_cand>1) mn, count(*) filter (where win_lo is null) nodate from public.agg_houselot_v1_20261024_cand3 where left(event_id::text,1)=:'b';

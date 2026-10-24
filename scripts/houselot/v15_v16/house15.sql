-- run agg_houselot_v15_20261024 step 0: lot table for every house we hold real lot pages for (v1 mecum/bonhams/rm + gooding, gaa, all rm-sothebys), with native currency.
set statement_timeout='55s';
create table if not exists public.agg_houselot_v15_20261024_house (hid uuid primary key, hvid uuid, house text, year int, mk text, md text,
  hsold timestamptz, hp numeric, source_url text, source_listing_id text, hcur text);
alter table public.agg_houselot_v15_20261024_house enable row level security;
create index if not exists agg_houselot_v15_house_k on public.agg_houselot_v15_20261024_house (house, year, hsold);
insert into public.agg_houselot_v15_20261024_house
select h.hid,h.hvid,h.house,h.year,h.mk,h.md,h.hsold,h.hp,h.source_url,h.source_listing_id, upper(coalesce(e.currency_code,'USD'))
from public.agg_houselot_v1_20261024_house h join public.vehicle_events e on e.id=h.hid where h.house in ('mecum','bonhams','rm')
on conflict (hid) do nothing;
insert into public.agg_houselot_v15_20261024_house
select he.id, he.vehicle_id, case he.source_platform when 'gooding' then 'gooding' when 'gaa-classic-cars' then 'gaa' else 'rm' end, v.year,
  lower(btrim(regexp_replace(v.make,'[^A-Za-z0-9]+',' ','g'))), lower(btrim(regexp_replace(coalesce(v.model,''),'[^A-Za-z0-9]+',' ','g'))),
  coalesce(he.sold_at, he.ended_at), he.final_price, he.source_url, he.source_listing_id, upper(coalesce(he.currency_code,'USD'))
from public.vehicle_events he join public.vehicles v on v.id=he.vehicle_id and v.deleted_at is null and v.status is distinct from 'merged' and v.merged_into_vehicle_id is null
where he.source_platform in ('gooding','gaa-classic-cars','rm-sothebys') and coalesce(he.sold_at,he.ended_at) is not null
  and he.source_url ~* '^https?://(www\.)?(goodingco\.com|gaaclassiccars\.com|rmsothebys\.com)/' and v.year is not null and v.make is not null
on conflict (hid) do nothing;
select house, hcur, count(*) from public.agg_houselot_v15_20261024_house group by 1,2 order by 1,2;

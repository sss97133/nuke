-- run mecum_lot_from_sli_v1_20261024: provenance + target list. lot = existing catalog lot in source_listing_id (shape like F257, S123.1); page-id-shaped values excluded.
create table if not exists public.mecum_lot_from_sli_v1_20261024 (event_id uuid primary key, lot text not null, source_column text not null,
  source_listing_id text not null, source_url text not null, batch int not null, filled_at timestamptz, run_id text not null default 'mecum_lot_from_sli_v1_20261024');
alter table public.mecum_lot_from_sli_v1_20261024 enable row level security;
insert into public.mecum_lot_from_sli_v1_20261024 (event_id, lot, source_column, source_listing_id, source_url, batch)
select id, btrim(source_listing_id), 'source_listing_id', source_listing_id, source_url, ((row_number() over (order by id))-1)/1000
from public.vehicle_events
where source_platform='mecum' and lot_number is null and source_url is not null
  and btrim(source_listing_id) ~ '^[A-Z]{1,3}[0-9]{1,4}(\.[0-9]{1,2})?$'
  and btrim(source_listing_id) is distinct from substring(source_url from '/lots/([^/?#]+)')
on conflict (event_id) do nothing;
select count(*) n, max(batch) maxb from public.mecum_lot_from_sli_v1_20261024;

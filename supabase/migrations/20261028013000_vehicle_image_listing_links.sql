-- Cited link from each vehicle image to the listing it was photographed for.
-- Why: vehicles sold more than once carry one merged gallery, so per-sale photo features leaked across listings.
-- Evidence used (cited per row): the BaT upload month in image_url (/wp-content/uploads/YYYY/MM/) against the
-- listing end date of the vehicle's BaT auction_events (duplicate events with the same URL collapse to one listing).
-- vehicle_images.source_url holds the image URL itself (not the listing), so it is cited but cannot pick the listing.
-- Additive only: new table + function. No existing table, view or estimate is changed.
-- image_id / auction_event_id are soft references (no FK): FK key-share checks on vehicle_images stalled behind live writers in the dry run.
-- Backfill runs separately in batches with a run id; revert: supabase/rollbacks/20261028013000_vehicle_image_listing_links_rollback.sql

create table if not exists public.vehicle_image_listing_links (
  image_id          uuid primary key,
  vehicle_id        uuid not null,
  auction_event_id  uuid not null,
  listing_url       text not null,
  method            text not null check (method in ('bat_upload_month_window')),
  confidence        text not null check (confidence in ('high','medium')),
  cited_image_url   text not null,
  upload_month      date not null,
  listing_end_date  date not null,
  days_before_end   integer not null,
  candidates        integer not null,
  run_id            text not null,
  created_at        timestamptz not null default now()
);
comment on table public.vehicle_image_listing_links is
  'Image -> listing (auction_events) link with cited evidence: upload month from cited_image_url vs listing_end_date. high = only one listing ends within 0..150 days after the upload month; medium = earliest of several. Unlinked images have no row.';
create index if not exists vehicle_image_listing_links_event_idx on public.vehicle_image_listing_links(auction_event_id);
create index if not exists vehicle_image_listing_links_vehicle_idx on public.vehicle_image_listing_links(vehicle_id);
create index if not exists vehicle_image_listing_links_run_idx on public.vehicle_image_listing_links(run_id);
alter table public.vehicle_image_listing_links enable row level security;

create or replace function public.link_vehicle_images_to_listings(p_vehicle_ids uuid[], p_run_id text)
returns integer language sql volatile set search_path = public as $$
  with lst as (
    select distinct on (a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))
           a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')) as lkey, a.id as event_id, a.source_url,
           max(a.auction_end_date) over (partition by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))::date as end_d
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids) and a.source_url ilike '%bringatrailer.com/listing/%'
     order by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')), (a.auction_end_date is null), a.created_at, a.id
  ), img as (
    select i.id, i.vehicle_id, i.image_url,
           to_date(substring(i.image_url from '/wp-content/uploads/(\d{4}/\d{2})/'), 'YYYY/MM') as m
      from vehicle_images i
     where i.vehicle_id = any(p_vehicle_ids) and i.image_url ~ '/wp-content/uploads/\d{4}/\d{2}/'
  ), cand as (
    select img.*, l.event_id, l.source_url, l.end_d,
           row_number() over (partition by img.id order by l.end_d, l.event_id) as rk,
           count(*) over (partition by img.id) as nc
      from img join lst l on l.vehicle_id = img.vehicle_id
     where l.end_d is not null and l.end_d >= img.m and l.end_d <= img.m + 150
  ), ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence,
           cited_image_url, upload_month, listing_end_date, days_before_end, candidates, run_id)
    select id, vehicle_id, event_id, source_url, 'bat_upload_month_window', case when nc = 1 then 'high' else 'medium' end,
           image_url, m, end_d, end_d - m, nc, p_run_id
      from cand where rk = 1
    on conflict (image_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
comment on function public.link_vehicle_images_to_listings(uuid[], text) is
  'Backfill/refresh vehicle_image_listing_links for the given vehicles; existing links are kept (on conflict do nothing).';

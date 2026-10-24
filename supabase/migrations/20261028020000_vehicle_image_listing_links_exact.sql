-- Exact lot-id image -> listing links for Mecum and Barrett-Jackson, plus non-vehicle flags for B-J banner images.
-- Additive: widens the method check, relaxes the date columns (exact methods have no upload-month window),
-- adds basis_key, one new link function and one new flag table. Existing BaT rows and function are unchanged.
-- Evidence (2026-10-24 read-only samples):
--   Mecum: image URL lot id /auctions/<SALE>/<lot>/ equals listing /lots/<lot>/ (614 matched, 121 point to a lot the
--     vehicle has no listing for -> left unlinked); legacy /auctions/<code>/<code>-<lot>/ matched 391/394.
--     Cloudinary /v<epoch>/ alone is NOT reliable (66% within 0..150d of the sale), so it is cited, never used to choose.
--   B-J: image /cars/<item_id>/ equals listing URL suffix -<item_id> (bj_results_stage_v1_20261024.item_id == lot_url suffix
--     for 44,732/44,732); 2,095/2,298 sampled item images matched a listing of the same vehicle.
alter table public.vehicle_image_listing_links drop constraint if exists vehicle_image_listing_links_method_check;
alter table public.vehicle_image_listing_links add constraint vehicle_image_listing_links_method_check
  check (method in ('bat_upload_month_window','mecum_lot_id','bj_item_id')) not valid;
alter table public.vehicle_image_listing_links alter column upload_month drop not null;
alter table public.vehicle_image_listing_links alter column listing_end_date drop not null;
alter table public.vehicle_image_listing_links alter column days_before_end drop not null;
alter table public.vehicle_image_listing_links add column if not exists basis_key text;
comment on column public.vehicle_image_listing_links.basis_key is
  'For exact methods: the lot/item id read from cited_image_url that equals the id in listing_url.';

create table if not exists public.vehicle_image_nonvehicle_flags (
  image_id        uuid primary key,
  vehicle_id      uuid not null,
  reason          text not null check (reason in ('bj_auction_site_banner')),
  cited_image_url text not null,
  run_id          text not null,
  created_at      timestamptz not null default now()
);
comment on table public.vehicle_image_nonvehicle_flags is
  'Images attached to a vehicle that do not depict it (e.g. B-J /AuctionSite(s)/ banners and maps). Soft refs; revert by run_id.';
create index if not exists vehicle_image_nonvehicle_flags_run_idx on public.vehicle_image_nonvehicle_flags(run_id);
alter table public.vehicle_image_nonvehicle_flags enable row level security;

create or replace function public.link_vehicle_images_to_listings_exact(p_vehicle_ids uuid[], p_run_id text)
returns integer language sql volatile set search_path = public as $$
  with lst as (
    select distinct on (a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))
           a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')) as lkey, a.id as event_id, a.source_url,
           a.auction_end_date::date as end_d,
           case when a.source_url ilike '%mecum.com%' then 'mecum' else 'bj' end as src,
           case when a.source_url ilike '%mecum.com%' then substring(a.source_url from '/lots/(\d+)')
                else substring(rtrim(split_part(a.source_url,'?',1),'/') from '-(\d+)$') end as k1,
           a.source_listing_id as k2, a.lot_number as k3
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids)
       and (a.source_url ilike '%mecum.com/lots/%' or a.source_url ilike '%barrett-jackson.com/%')
     order by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')), (a.auction_end_date is null), a.created_at, a.id
  ), img as (
    select i.id, i.vehicle_id, i.image_url,
           case when i.image_url ~* 'mecum\.com' then 'mecum' else 'bj' end as src,
           coalesce(substring(i.image_url from '/auctions/[A-Za-z0-9]+/(\d{6,8})/'),
                    substring(i.image_url from '/auctions/[a-z]+\d{4}/[a-z]+\d{4}-(\d+)/'),
                    substring(i.image_url from '/cars/(\d+)/')) as k,
           coalesce(to_timestamp(substring(i.image_url from '\D(1[4-7]\d{11})\D')::bigint/1000.0),
                    to_timestamp(substring(i.image_url from '/v(1[4-7]\d{8})/')::bigint))::date as ts
      from vehicle_images i
     where i.vehicle_id = any(p_vehicle_ids)
       and (i.image_url ~* 'mecum\.com/.*/auctions/' or i.image_url ~* 'barrett.*/cars/\d+/')
  ), cand as (
    select img.*, l.event_id, l.source_url, l.end_d,
           row_number() over (partition by img.id order by l.end_d nulls last, l.event_id) as rk,
           count(*) over (partition by img.id) as nc
      from img join lst l on l.vehicle_id = img.vehicle_id and l.src = img.src
     where img.k is not null and img.k in (l.k1, l.k2, l.k3)
  ), ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence,
           cited_image_url, upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select id, vehicle_id, event_id, source_url,
           case when src = 'mecum' then 'mecum_lot_id' else 'bj_item_id' end,
           case when nc = 1 then 'high' else 'medium' end,
           image_url, date_trunc('month', ts)::date, end_d, end_d - ts, nc, p_run_id, k
      from cand where rk = 1
    on conflict (image_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
comment on function public.link_vehicle_images_to_listings_exact(uuid[], text) is
  'Exact image->listing links: Mecum lot id and B-J item id in the image URL equal the id in the listing URL. Existing links kept.';

create or replace function public.flag_bj_banner_images(p_vehicle_ids uuid[], p_run_id text)
returns integer language sql volatile set search_path = public as $$
  with ins as (
    insert into vehicle_image_nonvehicle_flags (image_id, vehicle_id, reason, cited_image_url, run_id)
    select i.id, i.vehicle_id, 'bj_auction_site_banner', i.image_url, p_run_id
      from vehicle_images i
     where i.vehicle_id = any(p_vehicle_ids) and i.image_url ~* 'barrett.*/AuctionSites?/'
    on conflict (image_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

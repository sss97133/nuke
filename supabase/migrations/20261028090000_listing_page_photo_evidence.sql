-- Listing-page photo evidence for vehicles with 2+ listings on one platform, and image->listing links derived from it.
-- Additive only: one evidence table, one key function, one link function, widened method check (not valid).
-- No estimates or views touched; existing links are never overwritten (on conflict do nothing).
-- Evidence (2026-10-24, read-only public page fetches, cited per row via cited_image_url + listing_url + page_fetched_at):
--   Cars & Bids: the auction page's og:image names the listing's photo group, e.g.
--     carsandbids.com/auctions/3zWv52XA (ended 2025-02-03) -> .../photos/exterior/9QDVDvVe-.../rtAOR.jpg?t=173752204620
--     carsandbids.com/auctions/9AEBvlxe (ended 2025-09-18) -> .../photos/exterior/rwv8Rkvl-.../CpAKZ.jpg?t=175706995159
--     (the ?t= upload stamp, 1/100 s, falls 0-30 days before the end date).
--   BaT: the listing page's data-gallery-items lists the listing's own photos, and the "Sold for/Bid to ... on" line
--     carries the end time as data-timestamp, e.g. bringatrailer.com/listing/1987-toyota-land-cruiser-fj60-179 -> 108
--     gallery photos under /wp-content/uploads/2025/04/, ended 1746564908 (2025-05-06).
-- Methods:
--   cb_listing_page_group    high: image's photo group is the og:image group of exactly one of the vehicle's C&B listing pages.
--   bat_listing_page_gallery high: image file is in exactly one of the vehicle's BaT listing galleries;
--                            medium: in 2+ galleries (relisted photos), linked to the earliest-ending one, candidates = n.

create table if not exists public.listing_page_photo_evidence (
  auction_event_id uuid primary key, -- soft reference (no FK), as in vehicle_image_listing_links
  vehicle_id       uuid not null,
  listing_url      text not null,
  platform         text not null check (platform in ('cars_and_bids','bat')),
  http_status      integer,
  page_fetched_at  timestamptz not null,
  page_end_at      timestamptz,
  cover_url        text,
  photo_groups     text[] not null default '{}',
  gallery_keys     text[] not null default '{}',
  run_id           text not null,
  retired_at       timestamptz,
  retired_reason   text,
  retired_run_id   text
);
create index if not exists listing_page_photo_evidence_vehicle_idx on public.listing_page_photo_evidence (vehicle_id);
alter table public.listing_page_photo_evidence enable row level security;
comment on table public.listing_page_photo_evidence is
  'Photos named on a listing''s public page (C&B og:image group, BaT gallery files) and the page end time. Revert by retiring rows (retired_at).';

create or replace function public.bat_upload_key(p_url text) returns text language sql immutable as $$
  select lower(regexp_replace(substring(p_url from '/wp-content/uploads/(\d{4}/\d{2}/[^?#]+)'),
                              '(-scaled)?(-\d+x\d+)?(\.[A-Za-z0-9]+)$', '\3'))
$$;

alter table public.vehicle_image_listing_links drop constraint if exists vehicle_image_listing_links_method_check;
alter table public.vehicle_image_listing_links add constraint vehicle_image_listing_links_method_check
  check (method in ('bat_upload_month_window','mecum_lot_id','bj_item_id','cb_single_listing',
                    'cb_listing_page_group','bat_listing_page_gallery')) not valid;

create or replace function public.link_images_from_listing_pages(p_vehicle_ids uuid[], p_run_id text)
returns table(links integer) language sql volatile set search_path = public as $$
  with ev as (
    select e.* from listing_page_photo_evidence e
     where e.vehicle_id = any(p_vehicle_ids) and e.retired_at is null and e.http_status = 200
  ), cbg as (
    select ev.vehicle_id, g, ev.auction_event_id, ev.listing_url, ev.page_end_at,
           count(*) over (partition by ev.vehicle_id, g) n
      from ev cross join unnest(ev.photo_groups) g where ev.platform = 'cars_and_bids'
  ), batk as (
    select ev.vehicle_id, k, ev.auction_event_id, ev.listing_url, ev.page_end_at,
           count(*) over (partition by ev.vehicle_id, k) n,
           row_number() over (partition by ev.vehicle_id, k order by ev.page_end_at nulls last, ev.auction_event_id) r
      from ev cross join unnest(ev.gallery_keys) k where ev.platform = 'bat'
  ), img as (
    select i.id, i.vehicle_id, i.image_url,
           case when i.image_url ilike '%media.carsandbids.com%' and i.image_url !~ 'height='
                then substring(i.image_url from '/photos/(?:[a-z]+/)?([A-Za-z0-9_-]{8})-') end grp,
           case when i.image_url ~ '/wp-content/uploads/\d{4}/\d{2}/' then bat_upload_key(i.image_url) end k
      from vehicle_images i where i.vehicle_id = any(p_vehicle_ids)
  ), cand as (
    select img.id, img.vehicle_id, img.image_url, c.auction_event_id, c.listing_url, c.page_end_at,
           'cb_listing_page_group' m, 'high' conf, 1 nc, img.grp basis
      from img join cbg c on c.vehicle_id = img.vehicle_id and c.g = img.grp and c.n = 1
    union all
    select img.id, img.vehicle_id, img.image_url, b.auction_event_id, b.listing_url, b.page_end_at,
           'bat_listing_page_gallery', case when b.n = 1 then 'high' else 'medium' end, b.n::int, img.k
      from img join batk b on b.vehicle_id = img.vehicle_id and b.k = img.k and b.r = 1
  ), ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence,
           cited_image_url, upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select id, vehicle_id, auction_event_id, listing_url, m, conf, image_url,
           to_date(substring(image_url from '/wp-content/uploads/(\d{4}/\d{2})/'), 'YYYY/MM'),
           page_end_at::date, null, nc, p_run_id, basis
      from cand
    on conflict (image_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
comment on function public.link_images_from_listing_pages(uuid[], text) is
  'Links images to the listing whose public page names them (listing_page_photo_evidence). Existing links kept.';

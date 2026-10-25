-- 1) Retire instead of delete: reverts of image-link / non-vehicle-flag runs set retired_* instead of deleting rows.
-- 2) Cars & Bids image -> listing links (method cb_single_listing) and non-vehicle flags for C&B related-listing thumbnails.
-- Additive only: three nullable columns per table, widened checks (not valid), one new function. No estimates or views touched.
-- C&B evidence (2026-10-24 read-only samples):
--   C&B image URLs carry no upload date and no auction id: media.carsandbids.com/.../<user hash>/photos/[cat/]<8-char group>-<id>.
--   The 8-char group is NOT the auction id (auction 98PdoMJX -> photos 9abAQGgG-*), so the key is "the vehicle has exactly one
--   C&B listing" (39,266 of 40,983 C&B vehicles); vehicles with 2+ C&B listings are left unlinked.
--   Of 400 single-listing vehicles: 349 have exactly one dominant photo group (>=10 full-size images), 51 have none, 0 have two.
--   Thumbnails (cdn-cgi width=..,height=..) are never the dominant group (0 of 4,460) and the same thumbnail URL appears on
--   several vehicles, e.g. .../8e6341e2.../photos/exterior/r4Vg5ywx-JJoKQHx/edit/kLm4X.jpg on fec26fe2-... and 2b0360ac-...:
--   they are other listings' cards, so they are flagged non-vehicle for this vehicle and never linked.
--   high   = full-size image in the vehicle's dominant photo group; medium = full-size image with no group (legacy file names)
--   or a seller application photo (s-*). Full-size images in a minor group are left unlinked.

alter table public.vehicle_image_listing_links
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text,
  add column if not exists retired_run_id text;
alter table public.vehicle_image_nonvehicle_flags
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text,
  add column if not exists retired_run_id text;
comment on column public.vehicle_image_listing_links.retired_at is
  'Set by a revert instead of deleting the row. Readers must filter retired_at is null.';
comment on column public.vehicle_image_nonvehicle_flags.retired_at is
  'Set by a revert instead of deleting the row. Readers must filter retired_at is null.';

alter table public.vehicle_image_listing_links drop constraint if exists vehicle_image_listing_links_method_check;
alter table public.vehicle_image_listing_links add constraint vehicle_image_listing_links_method_check
  check (method in ('bat_upload_month_window','mecum_lot_id','bj_item_id','cb_single_listing')) not valid;
alter table public.vehicle_image_nonvehicle_flags drop constraint if exists vehicle_image_nonvehicle_flags_reason_check;
alter table public.vehicle_image_nonvehicle_flags add constraint vehicle_image_nonvehicle_flags_reason_check
  check (reason in ('bj_auction_site_banner','cb_related_listing_thumbnail')) not valid;

create or replace function public.link_cb_images_to_listings(p_vehicle_ids uuid[], p_run_id text)
returns table(links integer, flags integer) language sql volatile set search_path = public as $$
  with one as (
    select a.vehicle_id, min(a.id::text)::uuid as event_id, min(a.source_url) as source_url,
           min(a.source_listing_id) as lid, min(a.auction_end_date)::date as end_d
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids) and a.source_url ilike '%carsandbids.com/auctions/%'
     group by a.vehicle_id
    having count(distinct lower(rtrim(split_part(a.source_url,'?',1),'/'))) = 1
  ), img as (
    select i.id, i.vehicle_id, i.image_url, i.image_url ~ 'height=' as thumb,
           substring(i.image_url from '/photos/(?:[a-z]+/)?([A-Za-z0-9_-]{8})-') as grp
      from vehicle_images i
     where i.vehicle_id = any(p_vehicle_ids) and i.image_url ilike '%media.carsandbids.com%'
  ), dom as (
    select vehicle_id, grp from (
      select vehicle_id, grp, row_number() over (partition by vehicle_id order by count(*) desc, grp) r
        from img where not thumb and grp is not null and grp not like 's-%'
       group by vehicle_id, grp having count(*) >= 10) z
     where r = 1
  ), lnk as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence,
           cited_image_url, upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select img.id, img.vehicle_id, one.event_id, one.source_url, 'cb_single_listing',
           case when img.grp = dom.grp then 'high' else 'medium' end,
           img.image_url, null, one.end_d, null, 1, p_run_id, coalesce(img.grp, one.lid)
      from img join one using (vehicle_id) left join dom using (vehicle_id)
     where not img.thumb
       and (img.grp = dom.grp or img.grp is null or img.grp like 's-%')
    on conflict (image_id) do nothing
    returning 1
  ), flg as (
    insert into vehicle_image_nonvehicle_flags (image_id, vehicle_id, reason, cited_image_url, run_id)
    select id, vehicle_id, 'cb_related_listing_thumbnail', image_url, p_run_id from img where thumb
    on conflict (image_id) do nothing
    returning 1
  )
  select (select count(*)::int from lnk), (select count(*)::int from flg);
$$;
comment on function public.link_cb_images_to_listings(uuid[], text) is
  'Cars & Bids image->listing links for vehicles with exactly one C&B listing, plus related-listing thumbnail flags. Existing rows kept.';

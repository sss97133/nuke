-- Resolver for image -> listing links: stored links win; otherwise a single-listing link is derived on read.
-- Why: when a vehicle has exactly one listing on a platform, the link for that platform's photos is implied,
-- so storing a row per image (~65k rows per 500 BaT vehicles) adds nothing. Nothing is written by this function.
-- Derived rows (basis = 'single_listing_implied'):
--   BaT   : image_url ~ 'bringatrailer.com/wp-content/uploads/YYYY/MM/' (dated). Kept only when the listing end date is
--           0..150 days after the upload month (same window as link_vehicle_images_to_listings); failures are excluded.
--           confidence 'high' (one candidate in window), method 'bat_upload_month_window'.
--   BaT   : other bringatrailer.com image URLs without a date -> confidence 'medium', method 'bat_single_listing_url_pattern'.
--   Mecum : image_url ~ (cdn1|images).mecum.com/ or res.cloudinary.com/mecum/, with no lot-id link stored ->
--           confidence 'medium', method 'mecum_single_listing_url_pattern'. Mecum URL epochs are cited (basis_key)
--           but not used to accept/reject: only 66% of Cloudinary /v<epoch>/ dates fell in the 0..150-day window.
-- Images flagged in vehicle_image_nonvehicle_flags (not retired) are never derived. Listing = same normalized URL key
-- and representative event as link_vehicle_images_to_listings. Additive only: one read-only function.
-- Revert: supabase/rollbacks/20261028060000_vehicle_image_listing_resolved_rollback.sql

create or replace function public.vehicle_image_listing_resolved(p_vehicle_ids uuid[], p_include_stored boolean default true)
returns table (image_id uuid, vehicle_id uuid, auction_event_id uuid, listing_url text, method text, confidence text,
               basis text, cited_image_url text, upload_month date, listing_end_date date, days_before_end integer,
               basis_key text)
language sql stable set search_path = public as $$
  with st as (
    select l.image_id, l.vehicle_id, l.auction_event_id, l.listing_url, l.method, l.confidence, 'stored'::text as basis,
           l.cited_image_url, l.upload_month, l.listing_end_date, l.days_before_end, l.basis_key
      from vehicle_image_listing_links l
     where p_include_stored and l.vehicle_id = any(p_vehicle_ids) and l.retired_at is null
  ), lst as (
    select distinct on (a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))
           a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')) as lkey, a.id as event_id, a.source_url,
           case when a.source_url ilike '%bringatrailer.com/listing/%' then 'bat' else 'mecum' end as src,
           max(a.auction_end_date) over (partition by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))::date as end_d
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids)
       and (a.source_url ilike '%bringatrailer.com/listing/%' or a.source_url ilike '%mecum.com/lots/%')
     order by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')), (a.auction_end_date is null), a.created_at, a.id
  ), one as (
    select * from (select l.*, count(*) over (partition by l.vehicle_id, l.src) as n from lst l) z where z.n = 1
  ), img as (
    select i.id, i.vehicle_id, i.image_url,
           case when i.image_url ~* 'bringatrailer\.com/' then 'bat' else 'mecum' end as src,
           to_date(substring(i.image_url from '/wp-content/uploads/(\d{4}/\d{2})/'), 'YYYY/MM') as m,
           coalesce(substring(i.image_url from '\D(1[4-7]\d{11})\D'), substring(i.image_url from '/v(1[4-7]\d{8})/')) as ep
      from vehicle_images i
     where i.vehicle_id = any(p_vehicle_ids)
       and (i.image_url ~* 'bringatrailer\.com/' or i.image_url ~* '((cdn1|images)\.mecum\.com/|res\.cloudinary\.com/mecum/)')
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)
       and not exists (select 1 from st where st.image_id = i.id)
  ), der as (
    select img.id, img.vehicle_id, one.event_id, one.source_url,
           case when img.src = 'mecum' then 'mecum_single_listing_url_pattern'
                when img.m is null then 'bat_single_listing_url_pattern' else 'bat_upload_month_window' end,
           case when img.m is null then 'medium' else 'high' end,
           'single_listing_implied'::text, img.image_url, img.m, one.end_d, one.end_d - img.m,
           case when img.src = 'mecum' then img.ep end
      from img join one on one.vehicle_id = img.vehicle_id and one.src = img.src
     where img.m is null or (one.end_d is not null and one.end_d >= img.m and one.end_d <= img.m + 150)
  )
  select * from st union all select * from der;
$$;
comment on function public.vehicle_image_listing_resolved(uuid[], boolean) is
  'Image -> listing links for the given vehicles: stored (unretired) links first, else single_listing_implied BaT/Mecum links derived on read. p_include_stored=false returns derived rows only (for verification).';
revoke all on function public.vehicle_image_listing_resolved(uuid[], boolean) from public, anon, authenticated;

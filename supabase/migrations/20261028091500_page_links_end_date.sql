-- link_images_from_listing_pages: fill listing_end_date from auction_events when the page gave no end time
-- (C&B pages are read for the og:image group only). Same links otherwise; existing rows untouched.
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
           coalesce(page_end_at, (select a.auction_end_date from auction_events a where a.id = cand.auction_event_id))::date,
           null, nc, p_run_id, basis
      from cand
    on conflict (image_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
comment on function public.link_images_from_listing_pages(uuid[], text) is
  'Links images to the listing whose public page names them (listing_page_photo_evidence). Existing links kept.';

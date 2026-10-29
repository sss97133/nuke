-- Event-id variant of the cited fill, used by the continuous BaT page loop (/workspace/v24i/bf/applyloop.py).
create or replace function public.fill_bat_end_dates_events_v1(p_run text, p_eids uuid[])
returns jsonb language plpgsql set search_path to 'public' as $f$
declare n_fill int; n_flag int; n_cand int;
begin
  drop table if exists _c;
  create temp table _c on commit drop as
  with e as (
    select a.id, a.vehicle_id, a.source_url, lower(substring(a.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) slug
      from auction_events a
     where a.id = any(p_eids) and a.auction_end_date is null
       and a.source_url ilike '%bringatrailer.com/listing/%'
       and exists (select 1 from vehicles v where v.id = a.vehicle_id)
       and not exists (select 1 from auction_event_end_date_fill f where f.auction_event_id = a.id)
       and not exists (select 1 from auction_event_end_date_flag g where g.auction_event_id = a.id and g.retired_at is null)
  ), bl as (
    select e.id, min(b.auction_end_date) mn, max(b.auction_end_date) mx, min(b.id::text) ref, min(b.bat_listing_url) url, count(*) n
      from e join bat_listings b on lower(substring(b.bat_listing_url from 'bringatrailer\.com/listing/([^/?#]+)')) = e.slug
     where b.auction_end_date is not null group by e.id
  ), pg as (
    select p.auction_event_id id, p.page_end_at, p.listing_url, p.page_fetched_at
      from listing_page_photo_evidence p join e on e.id = p.auction_event_id
     where p.page_end_at is not null and p.retired_at is null
  )
  select e.id, e.vehicle_id, bl.mn, bl.mx, bl.ref, bl.url bl_url, pg.page_end_at, pg.listing_url pg_url, pg.page_fetched_at,
         case when bl.id is not null and bl.mn <> bl.mx then 'bat_listings_internal_disagree'
              when bl.id is not null and pg.id is not null and abs(extract(epoch from (pg.page_end_at - bl.mx))) > 2*86400 then 'sources_disagree'
         end flag
    from e left join bl on bl.id = e.id left join pg on pg.id = e.id
   where bl.id is not null or pg.id is not null;
  select count(*) into n_cand from _c;

  insert into auction_event_end_date_flag (auction_event_id, reason, candidates, run_id)
  select id, flag, jsonb_build_object('bat_listings_min', mn, 'bat_listings_max', mx, 'page_end_at', page_end_at, 'bat_listings_id', ref), p_run
    from _c where flag is not null on conflict do nothing;
  get diagnostics n_flag = row_count;

  with src as (
    select id, vehicle_id,
           case when page_end_at is not null then page_end_at else mx end v,
           case when page_end_at is not null then 'listing_page_photo_evidence' else 'bat_listings' end s,
           case when page_end_at is not null then id::text else ref end r,
           case when page_end_at is not null then pg_url else bl_url end u,
           case when page_end_at is not null then 'Listing page fetched '||to_char(page_fetched_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"')||': listing-available-info data-timestamp='||extract(epoch from page_end_at)::bigint
                else 'bat_listings.auction_end_date='||to_char(mx at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||' for '||bl_url end q
      from _c where flag is null
  ), upd as (
    update auction_events a set auction_end_date = src.v
      from src where a.id = src.id and a.auction_end_date is null
    returning a.id, a.vehicle_id, a.auction_end_date
  ), ins as (
    insert into auction_event_end_date_fill (auction_event_id, vehicle_id, filled_end_at, source, source_ref, cited_url, cited_quote, run_id)
    select src.id, src.vehicle_id, src.v, src.s, src.r, src.u, src.q, p_run
      from src join upd on upd.id = src.id and upd.auction_end_date = src.v
    returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_run from ins on conflict (vehicle_id) do nothing returning 1
  )
  select count(*) into n_fill from ins;
  return jsonb_build_object('candidates', n_cand, 'filled', n_fill, 'flagged', n_flag);
end $f$;


alter table public.vehicle_image_listing_links drop constraint vehicle_image_listing_links_method_check;
alter table public.vehicle_image_listing_links add constraint vehicle_image_listing_links_method_check
  check (method = any (array['bat_upload_month_window','mecum_lot_id','bj_item_id','cb_single_listing','cb_listing_page_group','bat_listing_page_gallery','mecum_upload_epoch_window','bat_multi_listing_month_window'])) not valid;
insert into public.photo_link_rule_citation values
 ('bat_multi_listing_month_window','https://wordpress.org/documentation/article/settings-media-screen/',
  'Organize my uploads into month- and year-based folders - Check this box if you wish to organize your uploads into folders based on the year and the month of the upload.',
  'BaT photo /wp-content/uploads/YYYY/MM/ = upload month; on vehicles with several BaT listings, linked only when exactly one listing ends between the first of the upload month and 150 days after it, and no BaT listing on the vehicle lacks an end date. Same window as bat_upload_month_window.')
on conflict (method) do nothing;

create or replace function public.link_bat_multi_month_window_v1(p_run text, p_lo uuid, p_hi uuid)
returns jsonb language plpgsql set search_path to 'public' as $f$
declare n_img int; n_ins int; n_amb int; n_zero int;
begin
  drop table if exists _b;
  create temp table _b on commit drop as
  with lots as (
    select distinct on (a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))
           a.id, a.vehicle_id, a.source_url, a.auction_end_date::date end_d
      from auction_events a
     where a.vehicle_id >= p_lo and a.vehicle_id < p_hi and a.source_url ilike '%bringatrailer.com/listing/%'
     order by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')), (a.auction_end_date is null), a.created_at, a.id
  ), multi as (
    select vehicle_id from lots group by 1 having count(*) > 1 and count(*) filter (where end_d is null) = 0
  ), img as (
    select i.id, i.vehicle_id, i.image_url,
           to_date(substring(i.image_url from '/wp-content/uploads/(\d{4}/\d{2})/'), 'YYYY/MM') m
      from vehicle_images i join multi using (vehicle_id)
     where i.image_url ~* 'bringatrailer\.com/wp-content/uploads/\d{4}/\d{2}/'
       and not exists (select 1 from vehicle_image_listing_links l where l.image_id = i.id)
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)
  )
  select img.id image_id, img.vehicle_id, img.image_url, img.m,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id) n_lots,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id and l.end_d between img.m and img.m + 150) hits,
         (select l.id from lots l where l.vehicle_id = img.vehicle_id and l.end_d between img.m and img.m + 150 limit 1) ev
    from img;
  select count(*), count(*) filter (where hits > 1), count(*) filter (where hits = 0) into n_img, n_amb, n_zero from _b;
  with ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence, cited_image_url,
           upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select b.image_id, b.vehicle_id, a.id, a.source_url, 'bat_multi_listing_month_window', 'high', b.image_url,
           b.m, a.auction_end_date::date, a.auction_end_date::date - b.m, b.n_lots, p_run, to_char(b.m,'YYYY/MM')
      from _b b join auction_events a on a.id = b.ev
     where b.hits = 1
    on conflict (image_id) do nothing
    returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_run from ins on conflict (vehicle_id) do nothing returning 1
  )
  select count(*) into n_ins from ins;
  return jsonb_build_object('candidate_images', n_img, 'linked', n_ins, 'ambiguous', n_amb, 'no_listing_in_window', n_zero);
end $f$;

create or replace function public.revert_bat_multi_month_window_v1(p_run text, p_revert_run text)
returns int language sql set search_path to 'public' as $f$
  with r as (
    update vehicle_image_listing_links set retired_at = now(), retired_reason = 'reverted', retired_run_id = p_revert_run
     where run_id = p_run and method = 'bat_multi_listing_month_window' and retired_at is null returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_revert_run from r on conflict (vehicle_id) do nothing returning 1
  )
  select count(*)::int from r;
$f$;

-- Cited, fill-only-empty BaT end dates + Mecum exactly-one-lot photo links.
create table if not exists public.auction_event_end_date_fill (
  auction_event_id uuid primary key references public.auction_events(id),
  vehicle_id uuid not null,
  filled_end_at timestamptz not null,
  source text not null check (source in ('bat_listings','listing_page_photo_evidence')),
  source_ref text not null,
  cited_url text not null,
  cited_quote text not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz, retired_reason text, retired_run_id text);
create index if not exists auction_event_end_date_fill_run_idx on public.auction_event_end_date_fill(run_id);

create table if not exists public.auction_event_end_date_flag (
  auction_event_id uuid not null references public.auction_events(id),
  reason text not null,
  candidates jsonb not null,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz, retired_run_id text,
  primary key (auction_event_id, reason));

alter table public.vehicle_image_listing_links drop constraint vehicle_image_listing_links_method_check;
alter table public.vehicle_image_listing_links add constraint vehicle_image_listing_links_method_check
  check (method = any (array['bat_upload_month_window','mecum_lot_id','bj_item_id','cb_single_listing','cb_listing_page_group','bat_listing_page_gallery','mecum_upload_epoch_window'])) not valid;
create table if not exists public.photo_link_rule_citation (
  method text primary key, citation_url text not null, citation_quote text not null, note text not null);
insert into public.photo_link_rule_citation values
 ('mecum_upload_epoch_window','https://cloudinary.com/documentation/advanced_url_delivery_options',
  'Cloudinary returns the version value as part of the upload response, and represents the timestamp of the upload.',
  'Mecum photo /v<epoch>/ version = upload time; linked only when exactly one Mecum lot on the vehicle ends 0-150 days after upload and no sibling Mecum lot lacks an end date. Same 150-day window as bat_upload_month_window.')
on conflict (method) do nothing;

-- Fill blank BaT auction_end_date from cited sources, fill-only-empty; disagreements are flagged, not filled.
create or replace function public.fill_bat_end_dates_v1(p_run text, p_lo uuid, p_hi uuid)
returns jsonb language plpgsql set search_path to 'public' as $f$
declare n_fill int; n_flag int; n_cand int;
begin
  drop table if exists _c;
  create temp table _c on commit drop as
  with e as (
    select a.id, a.vehicle_id, a.source_url, lower(substring(a.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) slug
      from auction_events a
     where a.vehicle_id >= p_lo and a.vehicle_id < p_hi and a.auction_end_date is null
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

create or replace function public.revert_bat_end_dates_v1(p_run text, p_revert_run text)
returns int language plpgsql set search_path to 'public' as $f$
declare n int;
begin
  with r as (
    update auction_event_end_date_fill f set retired_at = now(), retired_reason = 'reverted', retired_run_id = p_revert_run
     where f.run_id = p_run and f.retired_at is null returning f.auction_event_id, f.filled_end_at, f.vehicle_id
  ), u as (
    update auction_events a set auction_end_date = null from r
     where a.id = r.auction_event_id and a.auction_end_date = r.filled_end_at returning a.vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_revert_run from u on conflict (vehicle_id) do nothing returning 1
  )
  select count(*) into n from u;
  update auction_event_end_date_flag set retired_at = now(), retired_run_id = p_revert_run where run_id = p_run and retired_at is null;
  return n;
end $f$;

-- Mecum: stored links where exactly one Mecum lot on the vehicle ends 0..150 days after the Cloudinary upload version.
create or replace function public.link_mecum_epoch_window_v1(p_run text, p_lo uuid, p_hi uuid)
returns jsonb language plpgsql set search_path to 'public' as $f$
declare n_img int; n_ins int; n_amb int; n_zero int;
begin
  drop table if exists _m;
  create temp table _m on commit drop as
  with lots as (
    select a.id, a.vehicle_id, a.source_url, a.auction_end_date::date end_d
      from auction_events a
     where a.vehicle_id >= p_lo and a.vehicle_id < p_hi and a.source_url ilike '%mecum.com/lots/%'
  ), multi as (
    select vehicle_id from lots group by 1 having count(*) > 1 and count(*) filter (where end_d is null) = 0
  ), img as (
    select i.id, i.vehicle_id, i.image_url, substring(i.image_url from '/v(1[4-7]\d{8})/') ep
      from vehicle_images i join multi using (vehicle_id)
     where i.image_url ~* '(res\.cloudinary\.com/mecum/|images\.mecum\.com/)'
       and i.image_url ~ '/v1[4-7]\d{8}/'
       and not exists (select 1 from vehicle_image_listing_links l where l.image_id = i.id)
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)
  )
  select img.id image_id, img.vehicle_id, img.image_url, img.ep, to_timestamp(img.ep::bigint)::date up_d,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id) n_lots,
         (select count(*) from lots l where l.vehicle_id = img.vehicle_id and l.end_d between to_timestamp(img.ep::bigint)::date and to_timestamp(img.ep::bigint)::date + 150) hits,
         (select l.id from lots l where l.vehicle_id = img.vehicle_id and l.end_d between to_timestamp(img.ep::bigint)::date and to_timestamp(img.ep::bigint)::date + 150 limit 1) ev
    from img;
  select count(*), count(*) filter (where hits > 1), count(*) filter (where hits = 0) into n_img, n_amb, n_zero from _m;

  with ins as (
    insert into vehicle_image_listing_links (image_id, vehicle_id, auction_event_id, listing_url, method, confidence, cited_image_url,
           upload_month, listing_end_date, days_before_end, candidates, run_id, basis_key)
    select m.image_id, m.vehicle_id, a.id, a.source_url, 'mecum_upload_epoch_window', 'high', m.image_url,
           m.up_d, a.auction_end_date::date, a.auction_end_date::date - m.up_d, m.n_lots, p_run, m.ep
      from _m m join auction_events a on a.id = m.ev
     where m.hits = 1
    on conflict (image_id) do nothing
    returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_run from ins on conflict (vehicle_id) do nothing returning 1
  )
  select count(*) into n_ins from ins;
  return jsonb_build_object('candidate_images', n_img, 'linked', n_ins, 'ambiguous', n_amb, 'no_lot_in_window', n_zero);
end $f$;

create or replace function public.revert_mecum_epoch_window_v1(p_run text, p_revert_run text)
returns int language sql set search_path to 'public' as $f$
  with r as (
    update vehicle_image_listing_links set retired_at = now(), retired_reason = 'reverted', retired_run_id = p_revert_run
     where run_id = p_run and method = 'mecum_upload_epoch_window' and retired_at is null returning vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_revert_run from r on conflict (vehicle_id) do nothing returning 1
  )
  select count(*)::int from r;
$f$;

-- Canonical listing URL + duplicate_of on auction_events; reversible duplicate marking;
-- canonical-only listing counters; B-J site-image flags; B-J wrong-vehicle photo observations.
-- Additive only. No deletes. Reverts: revert_listing_duplicates_v1, revert_nonvehicle_flags_run_v1, revert_photo_mismatch_obs_v1.

create or replace function public.canonical_listing_url(u text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case when u is null or btrim(u) = '' then null else
    regexp_replace(regexp_replace(lower(split_part(split_part(btrim(u), '#', 1), '?', 1)),
                   '^https?://(www\.)?', 'https://'), '/+$', '') end
$$;
comment on function public.canonical_listing_url(text) is
  'Listing identity key: lowercase, https, host without www., no query/fragment, no trailing slash.';

alter table public.auction_events
  add column if not exists canonical_listing_url text,
  add column if not exists duplicate_of uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'auction_events_duplicate_of_fkey') then
    alter table public.auction_events add constraint auction_events_duplicate_of_fkey
      foreign key (duplicate_of) references public.auction_events(id) on delete set null not valid;
  end if;
end $$;
comment on column public.auction_events.duplicate_of is
  'Set when this row is the same listing (same vehicle, same canonical_listing_url) as another row; counters use rows where duplicate_of is null. See auction_event_duplicate_mark.';
create index if not exists auction_events_vehicle_canon_idx on public.auction_events (vehicle_id, canonical_listing_url);
create index if not exists auction_events_duplicate_of_idx on public.auction_events (duplicate_of) where duplicate_of is not null;

create table if not exists public.auction_event_duplicate_mark (
  id bigserial primary key,
  event_id uuid not null,
  duplicate_of uuid not null,
  vehicle_id uuid,
  source text,
  canonical_listing_url text not null,
  run_id text not null,
  marked_at timestamptz not null default now(),
  retired_at timestamptz, retired_reason text, retired_run_id text
);
create index if not exists auction_event_duplicate_mark_run_idx on public.auction_event_duplicate_mark (run_id);
create index if not exists auction_event_duplicate_mark_event_idx on public.auction_event_duplicate_mark (event_id);

create or replace view public.auction_events_canonical with (security_invoker = true) as
  select * from public.auction_events where duplicate_of is null;

-- Going forward: every write gets its canonical URL; a new row matching an existing canonical row
-- on the same vehicle is marked as its duplicate (logged under run insert_trigger_v1).
create or replace function public.auction_events_canonical_url_trg() returns trigger
language plpgsql set search_path = public as $$
declare v_dup uuid;
begin
  NEW.canonical_listing_url := canonical_listing_url(NEW.source_url);
  if TG_OP = 'INSERT' and NEW.duplicate_of is null and NEW.vehicle_id is not null and NEW.canonical_listing_url is not null then
    select a.id into v_dup from auction_events a
     where a.vehicle_id = NEW.vehicle_id and a.duplicate_of is null and a.id <> NEW.id
       and canonical_listing_url(a.source_url) = NEW.canonical_listing_url
     order by a.created_at, a.id limit 1;
    if v_dup is not null then
      NEW.duplicate_of := v_dup;
      insert into auction_event_duplicate_mark (event_id, duplicate_of, vehicle_id, source, canonical_listing_url, run_id)
      values (NEW.id, v_dup, NEW.vehicle_id, NEW.source, NEW.canonical_listing_url, 'insert_trigger_v1');
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_auction_events_canonical_url on public.auction_events;
create trigger trg_auction_events_canonical_url before insert or update of source_url on public.auction_events
  for each row execute function public.auction_events_canonical_url_trg();

-- Backfill canonical_listing_url for a vehicle_id slice (p_lo null = rows with null vehicle_id). Derived column only.
create or replace function public.backfill_canonical_listing_url_v1(p_lo uuid, p_hi uuid) returns integer
language sql set search_path = public as $$
  with u as (
    update auction_events a set canonical_listing_url = canonical_listing_url(a.source_url)
     where ((p_lo is null and a.vehicle_id is null) or (a.vehicle_id >= p_lo and a.vehicle_id < p_hi))
       and a.canonical_listing_url is distinct from canonical_listing_url(a.source_url)
       and (a.vehicle_id is null or exists (select 1 from vehicles v where v.id = a.vehicle_id))  -- orphan rows fail the vehicle FK on update
    returning 1)
  select count(*)::int from u
$$;

create or replace function public.mark_listing_duplicates_v1(p_run text, p_lo uuid, p_hi uuid) returns jsonb
language plpgsql set search_path = public as $$
declare v_marked int; v_cand int; v_src jsonb;
begin
  create temp table _d on commit drop as
  with e as (
    select a.id, a.vehicle_id, a.source, canonical_listing_url(a.source_url) cu, a.auction_end_date, a.source_url, a.created_at,
           exists (select 1 from vehicle_image_listing_links l where l.auction_event_id = a.id and l.retired_at is null) has_links
      from auction_events a
     where a.vehicle_id >= p_lo and a.vehicle_id < p_hi and a.source_url is not null and a.duplicate_of is null
       and exists (select 1 from vehicles v where v.id = a.vehicle_id)  -- orphan rows fail the vehicle FK on update
  ), r as (
    select e.*, first_value(id) over w canon, row_number() over w rn, count(*) over (partition by vehicle_id, cu) n
      from e window w as (partition by vehicle_id, cu
        order by has_links desc, (auction_end_date is not null) desc, (source_url !~* '^https?://www\.') desc, created_at, id)
  )
  select id, canon, vehicle_id, source, cu from r where n > 1 and rn > 1;
  select count(*) into v_cand from _d;

  create temp table _u on commit drop as
  with u as (update auction_events a set duplicate_of = d.canon from _d d
              where a.id = d.id and a.duplicate_of is null returning a.id)
  select id from u;
  insert into auction_event_duplicate_mark (event_id, duplicate_of, vehicle_id, source, canonical_listing_url, run_id)
  select d.id, d.canon, d.vehicle_id, d.source, d.cu, p_run from _d d join _u using (id);
  select count(*) into v_marked from _u;
  insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
  select distinct d.vehicle_id, p_run from _d d join _u using (id) on conflict (vehicle_id) do nothing;
  select jsonb_object_agg(source, c) into v_src from (select d.source, count(*) c from _d d join _u using (id) group by 1) z;
  return jsonb_build_object('candidates', v_cand, 'marked', v_marked, 'by_source', coalesce(v_src, '{}'::jsonb));
end $$;

create or replace function public.revert_listing_duplicates_v1(p_run text, p_revert_run text) returns integer
language sql set search_path = public as $$
  with m as (
    update auction_event_duplicate_mark set retired_at = now(), retired_reason = 'reverted', retired_run_id = p_revert_run
     where run_id = p_run and retired_at is null returning event_id, duplicate_of
  ), u as (
    update auction_events a set duplicate_of = null from m
     where a.id = m.event_id and a.duplicate_of = m.duplicate_of returning a.vehicle_id
  ), q as (
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, p_revert_run from u where vehicle_id is not null on conflict (vehicle_id) do nothing returning 1
  )
  select count(*)::int from u
$$;

-- Counters: canonical rows only, keyed by canonical_listing_url.
create or replace function public.vehicle_image_listing_resolved(p_vehicle_ids uuid[], p_include_stored boolean default true)
 returns table(image_id uuid, vehicle_id uuid, auction_event_id uuid, listing_url text, method text, confidence text, basis text,
               cited_image_url text, upload_month date, listing_end_date date, days_before_end integer, basis_key text)
 language sql stable set search_path to 'public' as $function$
  with st as (
    select l.image_id, l.vehicle_id, l.auction_event_id, l.listing_url, l.method, l.confidence, 'stored'::text as basis,
           l.cited_image_url, l.upload_month, l.listing_end_date, l.days_before_end, l.basis_key
      from vehicle_image_listing_links l
     where p_include_stored and l.vehicle_id = any(p_vehicle_ids) and l.retired_at is null
  ), lst as (
    select distinct on (a.vehicle_id, canonical_listing_url(a.source_url))
           a.vehicle_id, canonical_listing_url(a.source_url) as lkey, a.id as event_id, a.source_url,
           case when a.source_url ilike '%bringatrailer.com/listing/%' then 'bat' else 'mecum' end as src,
           max(a.auction_end_date) over (partition by a.vehicle_id, canonical_listing_url(a.source_url))::date as end_d
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids) and a.duplicate_of is null
       and (a.source_url ilike '%bringatrailer.com/listing/%' or a.source_url ilike '%mecum.com/lots/%')
     order by a.vehicle_id, canonical_listing_url(a.source_url), (a.auction_end_date is null), a.created_at, a.id
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
$function$;

create or replace function public.refresh_listing_photo_summary(p_vehicle_ids uuid[], p_run_id text)
 returns integer language sql set search_path to 'public' as $function$
  with l as (
    select distinct on (a.vehicle_id, canonical_listing_url(a.source_url))
           a.vehicle_id, canonical_listing_url(a.source_url) as lkey, a.id as event_id, a.source_url,
           case when a.source_url ilike '%bringatrailer.com%' then 'BaT' when a.source_url ilike '%mecum.com%' then 'Mecum'
                when a.source_url ilike '%barrett-jackson.com%' then 'B-J' when a.source_url ilike '%carsandbids.com%' then 'C&B'
                when a.source_url ilike '%rmsothebys.com%' then 'RM' else 'other' end as src
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids) and a.source_url is not null and a.duplicate_of is null
     order by a.vehicle_id, canonical_listing_url(a.source_url), (a.auction_end_date is null), a.created_at, a.id
  ), r as materialized (
    select r0.vehicle_id, coalesce(canonical_listing_url(ae.source_url), canonical_listing_url(r0.listing_url)) as lkey,
           r0.confidence, r0.basis, r0.method
      from vehicle_image_listing_resolved(p_vehicle_ids) r0
      left join auction_events ae on ae.id = r0.auction_event_id
  ), m as (
    select vehicle_id, lkey, jsonb_object_agg(method, c) as mix
      from (select vehicle_id, lkey, method, count(*) c from r group by 1,2,3) z group by 1,2
  ), agg as (
    select vehicle_id, lkey, count(*) n, count(*) filter (where confidence='high') nh,
           count(*) filter (where confidence='medium') nm, count(*) filter (where basis='stored') ns,
           count(*) filter (where basis='single_listing_implied') ni
      from r group by 1,2
  ), up as (
    insert into vehicle_listing_photo_summary as s (vehicle_id, listing_key, auction_event_id, listing_url, source,
           n_photos, n_high, n_medium, n_stored, n_implied, basis_mix, computed_at, run_id)
    select l.vehicle_id, l.lkey, l.event_id, l.source_url, l.src, coalesce(agg.n,0), coalesce(agg.nh,0), coalesce(agg.nm,0),
           coalesce(agg.ns,0), coalesce(agg.ni,0), coalesce(m.mix,'{}'::jsonb), now(), p_run_id
      from l left join agg using (vehicle_id, lkey) left join m using (vehicle_id, lkey)
    on conflict (vehicle_id, listing_key) do update set
           auction_event_id = excluded.auction_event_id, listing_url = excluded.listing_url, source = excluded.source,
           n_photos = excluded.n_photos, n_high = excluded.n_high, n_medium = excluded.n_medium, n_stored = excluded.n_stored,
           n_implied = excluded.n_implied, basis_mix = excluded.basis_mix, computed_at = excluded.computed_at, run_id = excluded.run_id
     where s.retired_at is null
    returning 1
  ), gone as (
    update vehicle_listing_photo_summary s set retired_at = now(), retired_reason = 'listing_gone', retired_run_id = p_run_id
     where s.vehicle_id = any(p_vehicle_ids) and s.retired_at is null
       and not exists (select 1 from l where l.vehicle_id = s.vehicle_id and l.lkey = s.listing_key)
    returning 1
  )
  select count(*)::int from up;
$function$;

-- Organization listing counts: canonical rows only (both functions count auction_events via organization_vehicles).
do $$ declare d text; begin
  for d in select replace(pg_get_functiondef(p.oid), 'WHERE ov.organization_id = p_org_id;',
                          'WHERE ov.organization_id = p_org_id AND ae.duplicate_of IS NULL;')
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('update_organization_profile_stats', 'backfill_organization_profile_stats') loop
    execute d;
  end loop;
end $$;

-- Barrett-Jackson site images (sale-site banners, location maps, bare _next/image placeholder) -> non-vehicle flags.
create or replace function public.flag_bj_site_images_v1(p_run text, p_lo uuid, p_hi uuid) returns jsonb
language sql set search_path = public as $$
  with v as (select distinct vehicle_id from auction_events where source = 'barrett-jackson' and vehicle_id >= p_lo and vehicle_id < p_hi),
  ins as (
    insert into vehicle_image_nonvehicle_flags (image_id, vehicle_id, reason, cited_image_url, run_id)
    select i.id, i.vehicle_id,
           case when i.image_url ~* '/_next/image/?$' then 'bj_auction_site_banner' else 'bj_auction_site_banner' end,
           i.image_url, p_run
      from vehicle_images i join v using (vehicle_id)
     where i.image_url ~* '^https?://(barrettjacksoncdn\.azureedge\.net/(staging/images|images)/|www\.barrett-jackson\.com/_next/image/?$)'
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)
    on conflict do nothing
    returning reason, cited_image_url)
  select jsonb_build_object('flagged', count(*), 'banner', count(*) filter (where reason = 'bj_auction_site_banner'),
                            'next_image_placeholder', count(*) filter (where cited_image_url ~* '/_next/image/?$')) from ins
$$;

create or replace function public.revert_nonvehicle_flags_run_v1(p_run text, p_revert_run text) returns integer
language sql set search_path = public as $$
  with u as (update vehicle_image_nonvehicle_flags set retired_at = now(), retired_reason = 'reverted', retired_run_id = p_revert_run
              where run_id = p_run and retired_at is null returning 1)
  select count(*)::int from u
$$;

-- Wrong-vehicle review list: B-J photo whose item number matches the docket id of a B-J listing on a different vehicle.
-- Observation only; nothing is moved or linked.
create table if not exists public.photo_vehicle_mismatch_observation (
  id bigserial primary key,
  image_id uuid not null,
  vehicle_id uuid not null,
  item_number text not null,
  matched_event_id uuid not null,
  matched_vehicle_id uuid not null,
  matched_listing_url text not null,
  cited_image_url text not null,
  basis text not null default 'bj_photo_item_number_equals_listing_docket_id',
  note text,
  run_id text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz, retired_reason text, retired_run_id text,
  unique (image_id, matched_event_id, run_id)
);
comment on table public.photo_vehicle_mismatch_observation is
  'Cited observation: the photo URL path /carlist/items/.../cars/<item>/ carries the same number as the docket id ending the listing URL on another vehicle. Review list only; vehicle reassignment is a manual decision.';

create or replace function public.observe_bj_item_mismatch_v1(p_run text, p_lo uuid, p_hi uuid) returns jsonb
language sql set search_path = public as $$
  with v as (select distinct vehicle_id from auction_events where source = 'barrett-jackson' and vehicle_id >= p_lo and vehicle_id < p_hi),
  p as materialized (
    select i.id, i.vehicle_id, i.image_url, substring(i.image_url from '/cars/(\d+)/') item
      from vehicle_images i join v using (vehicle_id)
     where i.image_url ilike '%/carlist/items/%'
       and not exists (select 1 from vehicle_image_listing_links l where l.image_id = i.id)
       and not exists (select 1 from vehicle_image_nonvehicle_flags f where f.image_id = i.id and f.retired_at is null)),
  d as materialized (
    select a.id, a.vehicle_id, a.source_url, substring(a.source_url from '-(\d+)/?$') dk
      from auction_events a where a.source = 'barrett-jackson' and a.duplicate_of is null),
  c as (
    select p.*, d.id eid, d.vehicle_id mv, d.source_url mu from p join d on d.dk = p.item and d.vehicle_id <> p.vehicle_id
     where not exists (select 1 from d d2 where d2.dk = p.item and d2.vehicle_id = p.vehicle_id)),
  ins as (
    insert into photo_vehicle_mismatch_observation (image_id, vehicle_id, item_number, matched_event_id, matched_vehicle_id,
           matched_listing_url, cited_image_url, note, run_id)
    select id, vehicle_id, item, eid, mv, mu, image_url,
           'Photo item number ' || item || ' matches listing ' || mu || ' on vehicle ' || mv, p_run
      from c on conflict do nothing returning image_id)
  select jsonb_build_object('candidate_photos', (select count(*) from p),
                            'observed_rows', (select count(*) from ins), 'observed_photos', (select count(distinct image_id) from ins),
                            'no_listing_anywhere', (select count(*) from p where not exists (select 1 from d where d.dk = p.item)))
$$;

create or replace function public.revert_photo_mismatch_obs_v1(p_run text, p_revert_run text) returns integer
language sql set search_path = public as $$
  with u as (update photo_vehicle_mismatch_observation set retired_at = now(), retired_reason = 'reverted', retired_run_id = p_revert_run
              where run_id = p_run and retired_at is null returning 1)
  select count(*)::int from u
$$;

-- Full seller description from stored listing HTML, cited (snapshot id, source URL, fetch date, run id).
-- Separate table: vehicles.description is never touched. Fill-only-empty: one active row per vehicle, never replaced.
-- Revert: retire by run id (supabase/rollbacks/..._listing_description_rollback.sql). No deletes.
create table if not exists public.vehicle_listing_description (
  vehicle_id uuid not null references public.vehicles(id),
  run_id text not null,
  description text not null check (length(description) > 0),
  char_len integer generated always as (length(description)) stored,
  source_url text not null,
  source_platform text not null,
  snapshot_id uuid not null,
  fetched_at timestamptz not null,
  extractor text not null,
  set_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (vehicle_id, run_id)
);
create unique index if not exists vehicle_listing_description_active_uq
  on public.vehicle_listing_description(vehicle_id) where retired_at is null;
alter table public.vehicle_listing_description enable row level security;
comment on table public.vehicle_listing_description is
'Full seller listing description extracted from a stored listing_page_snapshots page (snapshot_id, source_url, fetched_at cite it). One active row per vehicle; fill-only-empty; retire by run_id to revert.';

-- BaT: the <div class="post-excerpt"> block up to its first </div>, tags stripped, common entities decoded, "Filed under:" tail removed.
create or replace function public.bat_description_from_html(h text) returns text
language sql immutable parallel safe as $f$
  select nullif(btrim(regexp_replace(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(regexp_replace(cut, '<(br|/p|/li)[^>]*>', E'\n', 'gi'), '<[^>]+>', ' ', 'g'),
      '&#8217;', ''''), '&#8216;', ''''), '&#8220;', '"'), '&#8221;', '"'), '&#8211;', '-'), '&#8212;', '-'),
      '&#8243;', '"'), '&#8242;', ''''), '&nbsp;', ' '), '&#038;', '&'), '&amp;', '&'),
    '\s*Filed under:.*$', ''), '\s*\n\s*', E'\n', 'g'), E' \n\t\r'), '')
  from (select case when p > 0 then left(r, greatest(position('</div>' in r) - 1, 0)) end cut
        from (select p, substr(h, p + position('>' in substr(h, p))) r
              from (select position('class="post-excerpt"' in h) p) a0) a) b
$f$;

-- Stage one vehicle id range. For each vehicle with no active row: its canonical BaT auction_events listing, only when
-- that lot slug names exactly one live (not merged, not deleted) vehicle; newest successful inline-HTML snapshot of that
-- listing (any URL spelling); description from bat_description_from_html. Only vehicles whose stored description is
-- under 1,000 characters or generated.
create or replace function public.stage_bat_listing_description(p_run_id text, p_lo uuid, p_hi uuid)
returns integer language plpgsql as $f$
declare n int;
begin
  insert into public.vehicle_listing_description(vehicle_id, run_id, description, source_url, source_platform, snapshot_id, fetched_at, extractor)
  select distinct on (v.id) v.id, p_run_id, s.txt, s.listing_url, 'bat', s.id, s.fetched_at, 'bat_description_from_html_v1'
  from public.vehicles v
  join public.auction_events_canonical ae on ae.vehicle_id = v.id and ae.source_url ilike '%bringatrailer.com/listing/%'
  cross join lateral (
    select x.id, x.listing_url, x.fetched_at,
           coalesce(public.bat_description_from_html(substr(x.html, 1, 250000)), public.bat_description_from_html(x.html)) txt
    from (select p.id, p.listing_url, p.fetched_at, p.html from public.listing_page_snapshots p
          where p.listing_url in (ae.source_url, rtrim(ae.source_url,'/'), rtrim(ae.source_url,'/')||'/', ae.canonical_listing_url, ae.canonical_listing_url||'/')
            and p.success and p.html is not null
          order by p.fetched_at desc limit 1) x
  ) s
  where v.id >= p_lo and v.id < p_hi
    and v.deleted_at is null and v.merged_into_vehicle_id is null
    and not (v.year = 1974 and v.model ilike '%bronco%')  -- the four 1974 Bronco records stay untouched
    and not exists (select 1 from public.vehicle_listing_description o where o.vehicle_id = v.id and o.retired_at is null)
    and not exists (select 1 from public.auction_events_canonical a2 join public.vehicles v2 on v2.id = a2.vehicle_id and v2.deleted_at is null and v2.merged_into_vehicle_id is null
                    where lower(substring(a2.source_url from 'bringatrailer\.com/listing/([^/?#]+)')) = lower(substring(ae.source_url from 'bringatrailer\.com/listing/([^/?#]+)'))
                      and a2.vehicle_id <> v.id)
    and s.txt is not null
    and (coalesce(length(v.description), 0) < 1000 or v.description_generated_at is not null)  -- the short/generated-description gap
  order by v.id, s.fetched_at desc
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;

-- Running condition from the full description: new cited tags only (vehicles with no active running-condition row).
create or replace function public.stage_running_condition_from_listing_description(p_run_id text, p_lo uuid, p_hi uuid)
returns integer language plpgsql as $f$
declare n int;
begin
  insert into public.vehicle_running_condition(vehicle_id, run_id, running_condition, cited_phrase, source_field, source_url)
  select d.vehicle_id, p_run_id, m.x[1]::public.running_condition_t, m.x[2], 'vehicle_listing_description.description', d.source_url
  from public.vehicle_listing_description d
  cross join lateral (select public.running_condition_match(left(d.description, 20000), false) x) m
  where d.retired_at is null and d.vehicle_id >= p_lo and d.vehicle_id < p_hi
    and m.x[1] is not null and m.x[2] is not null
    and not exists (select 1 from public.vehicle_running_condition o where o.vehicle_id = d.vehicle_id and o.retired_at is null)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;

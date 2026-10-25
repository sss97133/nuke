-- Mecum: the seller HIGHLIGHTS bullet list (Mecum lot pages carry no prose description). Stored as one line per bullet.
-- Additive, fill-only-empty, run id listing_description_mecum_v1_20261025. Revert: supabase/rollbacks/20261028121400_listing_description_mecum_rollback.sql
create or replace function public.mecum_description_from_html(h text) returns text
language sql immutable parallel safe as $f$
  select nullif(btrim(regexp_replace(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(regexp_replace(cut, '</li>', E'\n', 'gi'), '<[^>]+>', ' ', 'g'),
      '&#x27;', ''''), '&#39;', ''''), '&quot;', '"'), '&nbsp;', ' '), '&#038;', '&'), '&amp;', '&'), '&#8217;', ''''),
    '[ \t]+', ' ', 'g'), '\s*\n\s*', E'\n', 'g'), E' \n\t\r'), '')
  from (select case when p > 0 then substring(substr(h, p, 20000) from '<ul[^>]*?>(.*?)</ul>') end cut
        from (select position('data-text="HIGHLIGHTS"' in h) p) a) b
$f$;

create or replace function public.stage_mecum_listing_description(p_run_id text, p_lo uuid, p_hi uuid)
returns integer language plpgsql as $f$
declare n int;
begin
  insert into public.vehicle_listing_description(vehicle_id, run_id, description, source_url, source_platform, snapshot_id, fetched_at, extractor)
  select distinct on (v.id) v.id, p_run_id, s.txt, s.listing_url, 'mecum', s.id, s.fetched_at, 'mecum_description_from_html_v1'
  from public.vehicles v
  join public.auction_events_canonical ae on ae.vehicle_id = v.id and ae.source_url ilike '%mecum.com/lots/%'
  cross join lateral (
    select x.id, x.listing_url, x.fetched_at, public.mecum_description_from_html(x.html) txt
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
                    where a2.source = ae.source and a2.source_url in (ae.source_url, rtrim(ae.source_url,'/'), rtrim(ae.source_url,'/')||'/') and a2.vehicle_id <> v.id)
    and s.txt is not null
    and (coalesce(length(v.description), 0) < 1000 or v.description_generated_at is not null)
  order by v.id, s.fetched_at desc
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $f$;

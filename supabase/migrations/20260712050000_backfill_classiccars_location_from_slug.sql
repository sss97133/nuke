-- ALLOW_RAW_TESTIMONY_WRITE — corruption correction with provenance, via chokepoint.
--
-- SEQUEL TO 20260712030000_correct_fabricated_location_stamp. Investigation of the
-- 2026-03-26 classiccars-com batch (33,876 vehicles, all from a sitemap crawl whose
-- raw_data survives intact in import_queue) found:
--
-- 1. The 'cadillac, MICHIGAN' ×11,217 stamp was NOT a one-value parser bug. Every one
--    of those rows' listing_url slugs says for-sale-in-cadillac-michigan-49601: they
--    are one consignment mega-dealer's listings (Cadillac, MI 49601). The dealer's own
--    listing pages state "Location is at our clients home and Not In Cadillac,
--    Michigan" (verified live 2026-07-11) and do NOT disclose the true location, so
--    the vehicles' physical city/state is unrecoverable from any source we hold or
--    could fetch. The correction (columns null) stands; this migration annotates those
--    rows with origin_metadata.listing_location carrying the dealer-HQ semantics.
--
-- 2. The REAL parser bug lives in scripts/drain-queue-no-ai.mjs parseClassicCars: it
--    split the sitemap location slug on '-' and took the LAST token as the state.
--    Two-word states shattered — 'buffalo-new-york' became city='buffalo new',
--    state='YORK' (1,085 rows), plus CAROLINA 1,422, JERSEY 381, DAKOTA 216, etc.
--    Canadian postal fragments ('V1V'), bare zips, and international cities also
--    landed in state. And the whole batch violates platform convention (lowercase
--    city, ALL-CAPS full state name vs Title Case + 2-letter code everywhere else),
--    which fragments marketplace_metro_pulse groupings.
--
-- THE FIX: re-parse every remaining batch row from the surviving sitemap slug
-- (import_queue.raw_data.location; fallback: the listing_url slug) with a
-- longest-suffix state matcher over US states/territories + Canadian provinces.
-- Matched rows get Title Case city + 2-letter state + 'City, ST' location, with
-- source-DNA in origin_metadata.location_provenance (source, method, slug,
-- observed_at = sitemap lastmod). Unmatched slugs (international, malformed, typos in
-- the source slug itself like 'texax') get columns cleared with the slug preserved —
-- never a guess. Prior values are preserved inside the provenance object
-- (supersede-never-erase).
--
-- Batched (p_limit per call, callers loop until {"reparsed":0,"dealer_annotated":0}):
-- vehicles carries 38 triggers. Idempotent/resumable via the metadata-key markers.

create or replace function public.backfill_classiccars_location_from_slug(
  p_limit int default 500
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_reparsed int := 0;
  n_dealer int := 0;
begin
  -- Phase 1: rows still carrying the buggy parse (not the corrected dealer cohort) —
  -- re-parse city/state from the sitemap slug.
  with map(slug, code) as (values
    ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),
    ('california','CA'),('colorado','CO'),('connecticut','CT'),('delaware','DE'),
    ('florida','FL'),('georgia','GA'),('hawaii','HI'),('idaho','ID'),
    ('illinois','IL'),('indiana','IN'),('iowa','IA'),('kansas','KS'),
    ('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
    ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),
    ('missouri','MO'),('montana','MT'),('nebraska','NE'),('nevada','NV'),
    ('new-hampshire','NH'),('new-jersey','NJ'),('new-mexico','NM'),('new-york','NY'),
    ('north-carolina','NC'),('north-dakota','ND'),('ohio','OH'),('oklahoma','OK'),
    ('oregon','OR'),('pennsylvania','PA'),('rhode-island','RI'),('south-carolina','SC'),
    ('south-dakota','SD'),('tennessee','TN'),('texas','TX'),('utah','UT'),
    ('vermont','VT'),('virginia','VA'),('washington','WA'),('west-virginia','WV'),
    ('wisconsin','WI'),('wyoming','WY'),
    ('district-of-columbia','DC'),('dc','DC'),('puerto-rico','PR'),
    ('alberta','AB'),('british-columbia','BC'),('manitoba','MB'),
    ('new-brunswick','NB'),('newfoundland','NL'),('newfoundland-and-labrador','NL'),
    ('nova-scotia','NS'),('ontario','ON'),('prince-edward-island','PE'),
    ('quebec','QC'),('saskatchewan','SK'),('yukon','YT'),
    ('northwest-territories','NT'),('nunavut','NU')
  ),
  cand as (
    select v.id,
           coalesce(
             lower(q.raw_data->>'location'),
             -- fallback when the queue row is gone: slug from the listing URL, zip tail stripped
             regexp_replace(substring(lower(v.listing_url) from 'for-sale-in-(.*)$'), '-[0-9]+$', '')
           ) as loc_slug,
           q.raw_data->>'lastmod' as lastmod,
           v.created_at
    from vehicles v
    left join import_queue q on q.listing_url = v.listing_url
    where v.source = 'classiccars-com'
      and v.created_at >= '2026-03-26 16:00+00' and v.created_at < '2026-03-26 20:00+00'
      and not (v.origin_metadata ? 'location_correction')
      and not (v.origin_metadata ? 'location_provenance')
    limit p_limit
  ),
  parsed as (
    select c.id, c.loc_slug, c.lastmod, c.created_at, m.code,
           nullif(initcap(replace(
             left(c.loc_slug, greatest(length(c.loc_slug) - length(m.slug) - 1, 0)),
             '-', ' ')), '') as city_txt
    from cand c
    left join lateral (
      select mm.slug, mm.code from map mm
      where c.loc_slug = mm.slug or c.loc_slug like ('%-' || mm.slug)
      order by length(mm.slug) desc limit 1
    ) m on true
  )
  update vehicles v set
    city = case when p.code is not null then p.city_txt end,
    state = p.code,
    location = case when p.code is not null
                 then coalesce(p.city_txt || ', ', '') || p.code end,
    origin_metadata = coalesce(v.origin_metadata, '{}'::jsonb)
      || jsonb_build_object('location_provenance', jsonb_build_object(
           'source', 'classiccars.com sitemap (import_queue.raw_data.location)',
           'method', 'state_aware_slug_reparse',
           'slug', p.loc_slug,
           'observed_at', coalesce(p.lastmod, p.created_at::text),
           'written_at', now(),
           'parse_outcome', case when p.code is not null then 'matched'
                                 else 'unmatched_cleared' end,
           'prior_city', v.city,
           'prior_state', v.state,
           'prior_location', v.location))
  from parsed p
  where v.id = p.id;
  get diagnostics n_reparsed = row_count;

  -- Phase 2: the corrected dealer cohort — columns stay null (physical location is
  -- undisclosed by the source); record what the listing DID say, with semantics.
  with batch as (
    select v.id, q.raw_data->>'lastmod' as lastmod, v.created_at
    from vehicles v
    left join import_queue q on q.listing_url = v.listing_url
    where v.source = 'classiccars-com'
      and v.created_at >= '2026-03-26 16:00+00' and v.created_at < '2026-03-26 20:00+00'
      and v.origin_metadata ? 'location_correction'
      and not (v.origin_metadata ? 'listing_location')
      and v.listing_url ilike '%cadillac-michigan%'
    limit p_limit
  )
  update vehicles v set
    origin_metadata = v.origin_metadata
      || jsonb_build_object('listing_location', jsonb_build_object(
           'city', 'Cadillac',
           'state', 'MI',
           'zip', '49601',
           'semantics', 'consignment dealer HQ, not the vehicle — listing description states the vehicle is at the consignor''s home and does not disclose where',
           'source', 'classiccars.com sitemap (import_queue.raw_data.location)',
           'method', 'state_aware_slug_reparse',
           'observed_at', coalesce(b.lastmod, b.created_at::text),
           'written_at', now()))
  from batch b
  where v.id = b.id;
  get diagnostics n_dealer = row_count;

  return jsonb_build_object('reparsed', n_reparsed, 'dealer_annotated', n_dealer);
end $$;

revoke all on function public.backfill_classiccars_location_from_slug(int)
  from public, anon, authenticated;
grant execute on function public.backfill_classiccars_location_from_slug(int)
  to service_role;

comment on function public.backfill_classiccars_location_from_slug(int) is
  'Re-parses city/state for the 2026-03-26 classiccars-com sitemap import from the surviving import_queue.raw_data.location slugs, using longest-suffix state matching (fixes the last-token split that shattered two-word states, e.g. state=YORK). Matched rows get Title Case city + 2-letter state + location_provenance source-DNA; unmatched slugs are cleared with the slug preserved. The 11,217 corrected Cadillac-MI consignment-dealer rows keep null columns and gain origin_metadata.listing_location (dealer-HQ semantics). Batched — loop until {"reparsed":0,"dealer_annotated":0}.';

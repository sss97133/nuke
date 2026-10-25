-- Rollback for 20261028120900_canonical_listing_url_duplicates.sql
-- Step 1 (data, reversible, no deletes): retire each run first, e.g.
--   select revert_listing_duplicates_v1('listing_duplicates_v1_20261025', 'listing_duplicates_v1_20261025_revert');
--   select revert_nonvehicle_flags_run_v1('bj_site_images_v1_20261025', 'bj_site_images_v1_20261025_revert');
--   select revert_photo_mismatch_obs_v1('bj_item_mismatch_obs_v1_20261025', 'bj_item_mismatch_obs_v1_20261025_revert');
-- Step 2: stop the insert trigger and restore the previous function bodies (captured 2026-10-25).
-- Columns, tables and the audit rows are kept (additive); drop them by hand only if Skylar asks.
drop trigger if exists trg_auction_events_canonical_url on public.auction_events;
CREATE OR REPLACE FUNCTION public.backfill_organization_profile_stats(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
  v_contributor_ids UUID[];
BEGIN
  -- Get contributor user IDs
  SELECT ARRAY_AGG(user_id) INTO v_contributor_ids
  FROM organization_contributors
  WHERE organization_id = p_org_id AND status = 'active';

  -- Count listings (BaT listings + auction events)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings
  WHERE organization_id = p_org_id
  UNION ALL
  SELECT COUNT(*)
  FROM auction_events ae
  JOIN organization_vehicles ov ON ov.vehicle_id = ae.vehicle_id
  WHERE ov.organization_id = p_org_id;

  -- Count bids (from organization members)
  SELECT COUNT(*) INTO v_bids
  FROM auction_bids ab
  WHERE ab.bidder_id = ANY(v_contributor_ids);

  -- Count comments (from organization members via external identities)
  SELECT COUNT(*) INTO v_comments
  FROM bat_comments bc
  WHERE bc.external_identity_id IN (
    SELECT id FROM external_identities
    WHERE claimed_by_user_id = ANY(v_contributor_ids)
  )
  UNION ALL
  SELECT COUNT(*)
  FROM auction_comments ac
  WHERE ac.external_identity_id IN (
    SELECT id FROM external_identities
    WHERE claimed_by_user_id = ANY(v_contributor_ids)
  );

  -- Count auction wins
  SELECT COUNT(*) INTO v_wins
  FROM bat_listings
  WHERE organization_id = p_org_id
    AND listing_status = 'sold';

  -- Count success stories
  SELECT COUNT(*) INTO v_stories
  FROM success_stories
  WHERE organization_id = p_org_id;

  -- Find earliest activity (member since)
  SELECT LEAST(
    (SELECT MIN(created_at) FROM businesses WHERE id = p_org_id),
    (SELECT MIN(created_at) FROM organization_vehicles WHERE organization_id = p_org_id),
    (SELECT MIN(auction_start_date) FROM bat_listings WHERE organization_id = p_org_id),
    (SELECT MIN(created_at) FROM organization_contributors WHERE organization_id = p_org_id)
  ) INTO v_member_since;

  -- Update organization
  UPDATE businesses
  SET 
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = COALESCE(v_member_since, created_at),
    updated_at = NOW()
  WHERE id = p_org_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_listing_photo_summary(p_vehicle_ids uuid[], p_run_id text)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  with l as (
    select distinct on (a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))
           a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')) as lkey, a.id as event_id, a.source_url,
           case when a.source_url ilike '%bringatrailer.com%' then 'BaT' when a.source_url ilike '%mecum.com%' then 'Mecum'
                when a.source_url ilike '%barrett-jackson.com%' then 'B-J' when a.source_url ilike '%carsandbids.com%' then 'C&B'
                when a.source_url ilike '%rmsothebys.com%' then 'RM' else 'other' end as src
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids) and a.source_url is not null
     order by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')), (a.auction_end_date is null), a.created_at, a.id
  ), r as materialized (
    select vehicle_id, lower(rtrim(split_part(listing_url,'?',1),'/')) as lkey, confidence, basis, method
      from vehicle_image_listing_resolved(p_vehicle_ids)
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
  select count(*)::int from up;  -- data-modifying CTE "gone" runs regardless
$function$
;

CREATE OR REPLACE FUNCTION public.update_organization_profile_stats(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
BEGIN
  -- Count listings (from bat_listings or auction_events)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings
  WHERE organization_id = p_org_id
  UNION ALL
  SELECT COUNT(*)
  FROM auction_events ae
  JOIN organization_vehicles ov ON ov.vehicle_id = ae.vehicle_id
  WHERE ov.organization_id = p_org_id;
  
  -- Count bids (from organization members' bids)
  SELECT COUNT(*) INTO v_bids
  FROM auction_bids ab
  JOIN organization_contributors oc ON oc.user_id = ab.bidder_id
  WHERE oc.organization_id = p_org_id;
  
  -- Count comments (from organization members' comments)
  SELECT COUNT(*) INTO v_comments
  FROM bat_comments bc
  JOIN organization_contributors oc ON oc.user_id = (
    SELECT claimed_by_user_id FROM external_identities WHERE id = bc.external_identity_id
  )
  WHERE oc.organization_id = p_org_id;
  
  -- Count auction wins
  SELECT COUNT(*) INTO v_wins
  FROM bat_listings bl
  WHERE bl.organization_id = p_org_id
    AND bl.listing_status = 'sold';
  
  -- Count success stories
  SELECT COUNT(*) INTO v_stories
  FROM success_stories
  WHERE organization_id = p_org_id;
  
  -- Find earliest activity (member since)
  SELECT LEAST(
    (SELECT MIN(created_at) FROM businesses WHERE id = p_org_id),
    (SELECT MIN(created_at) FROM organization_vehicles WHERE organization_id = p_org_id),
    (SELECT MIN(auction_start_date) FROM bat_listings WHERE organization_id = p_org_id),
    (SELECT MIN(created_at) FROM organization_contributors WHERE organization_id = p_org_id)
  ) INTO v_member_since;
  
  -- Update organization
  UPDATE businesses
  SET 
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = COALESCE(v_member_since, created_at),
    updated_at = NOW()
  WHERE id = p_org_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_image_listing_resolved(p_vehicle_ids uuid[], p_include_stored boolean DEFAULT true)
 RETURNS TABLE(image_id uuid, vehicle_id uuid, auction_event_id uuid, listing_url text, method text, confidence text, basis text, cited_image_url text, upload_month date, listing_end_date date, days_before_end integer, basis_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;
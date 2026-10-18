-- Fix normalize_listing_url for alphanumeric Mecum lot codes (e.g. /lots/FL23-539536/...)
-- Skip per-row vehicle_images recount triggers during bulk merges (merge_into_primary and merge_into_primary_batch recount once at the end)
-- and add merge_into_primary_batch(primary_ids uuid[], dup_ids uuid[]) for bulk deduplication.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.normalize_listing_url(url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  listing_id text;
  event_code text;
BEGIN
  IF url IS NULL OR url = '' THEN
    RETURN NULL;
  END IF;

  -- JamesEdition: extract numeric listing ID (7+ digits)
  IF url ILIKE '%jamesedition.com%' THEN
    listing_id := (regexp_match(url, '(\d{7,})'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'jamesedition:' || listing_id;
    END IF;
  END IF;

  -- RM Sotheby's: include auction event code
  IF url ILIKE '%rmsothebys.com%/auctions/%/lots/%' THEN
    event_code := (regexp_match(url, '/auctions/([^/]+)/lots/'))[1];
    listing_id := (regexp_match(url, '/lots/(r\d+-[^/]+)'))[1];
    IF event_code IS NOT NULL AND listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || lower(event_code) || ':' || lower(listing_id);
    END IF;
  END IF;

  -- RM private sales: /ps00/inventory/{lot_slug}
  IF url ILIKE '%rmsothebys.com%/ps%/inventory/%' THEN
    event_code := (regexp_match(url, '/(ps\d+)/inventory/'))[1];
    listing_id := (regexp_match(url, '/inventory/(r\d+-[^/]+)'))[1];
    IF event_code IS NOT NULL AND listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || lower(event_code) || ':' || lower(listing_id);
    END IF;
  END IF;

  -- RM fallback: lot slug only
  IF url ILIKE '%rmsothebys.com%' THEN
    listing_id := (regexp_match(url, '/(r\d+-[^/]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'rmsothebys:' || lower(listing_id);
    END IF;
  END IF;

  -- BaT: extract listing slug
  IF url ILIKE '%bringatrailer.com/listing/%' THEN
    listing_id := (regexp_match(url, '/listing/([\w-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'bat:' || lower(listing_id);
    END IF;
  END IF;

  -- Cars & Bids
  IF url ILIKE '%carsandbids.com/auctions/%' THEN
    listing_id := (regexp_match(url, '/auctions/([\w-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'carsandbids:' || lower(listing_id);
    END IF;
  END IF;

  -- Barrett-Jackson: use path after domain
  IF url ILIKE '%barrett-jackson.com%' THEN
    listing_id := (regexp_match(url, 'barrett-jackson\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'barrett-jackson:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Mecum: extract numeric OR alphanumeric lot code from /lots/{lot_id}/{slug}
  -- Matches both /lots/1143132/... and /lots/FL23-539536/... case-insensitively
  IF url ILIKE '%mecum.com/lots/%' THEN
    listing_id := (regexp_match(url, '/lots/([A-Za-z0-9-]+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'mecum:' || lower(listing_id);
    END IF;
  END IF;

  -- Mecum fallback: non-lot pages
  IF url ILIKE '%mecum.com%' THEN
    listing_id := (regexp_match(url, 'mecum\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'mecum:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Collecting Cars
  IF url ILIKE '%collectingcars.com%' THEN
    listing_id := (regexp_match(url, 'collectingcars\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'collectingcars:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Gooding
  IF url ILIKE '%goodingco.com%' THEN
    listing_id := (regexp_match(url, 'goodingco\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'gooding:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- eBay Motors
  IF url ILIKE '%ebay.com/itm/%' THEN
    listing_id := (regexp_match(url, '/itm/(\d+)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'ebay:' || listing_id;
    END IF;
  END IF;

  -- Hagerty Marketplace
  IF url ILIKE '%hagerty.com/marketplace/%' THEN
    listing_id := (regexp_match(url, '/marketplace/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'hagerty:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Hemmings
  IF url ILIKE '%hemmings.com/classifieds/%' THEN
    listing_id := (regexp_match(url, '/classifieds/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'hemmings:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Bonhams
  IF url ILIKE '%bonhams.com%' THEN
    listing_id := (regexp_match(url, 'bonhams\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'bonhams:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Broad Arrow
  IF url ILIKE '%broadarrowauctions.com%' THEN
    listing_id := (regexp_match(url, 'broadarrowauctions\.com/(.+?)/?(\?|$)'))[1];
    IF listing_id IS NOT NULL THEN
      RETURN 'broadarrow:' || lower(regexp_replace(listing_id, '/$', ''));
    END IF;
  END IF;

  -- Fallback: strip trailing slash, query params, appended titles
  RETURN lower(regexp_replace(
    regexp_replace(
      regexp_replace(url, '\s*"[^"]*"?\s*$', ''),
      '\?.*$', ''),
    '/$', ''));
END;
$$;

-- Avoid O(N) per-image UPDATE vehicles recount when merge_into_primary / merge_into_primary_batch moves a gallery
CREATE OR REPLACE FUNCTION public.update_vehicle_image_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN
    RETURN NULL;
  END IF;
  v_id := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  UPDATE vehicles SET image_count = (
    SELECT count(*) FROM vehicle_images
    WHERE vehicle_id = v_id
      AND is_duplicate IS NOT TRUE
      AND is_superseded IS NOT TRUE
  ) WHERE id = v_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.maintain_vehicle_has_photos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_vehicle_id uuid;
  photo_exists boolean;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_vehicle_id := OLD.vehicle_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
      UPDATE vehicles SET has_photos = EXISTS(
        SELECT 1 FROM vehicle_images WHERE vehicle_id = OLD.vehicle_id LIMIT 1
      ) WHERE id = OLD.vehicle_id;
      target_vehicle_id := NEW.vehicle_id;
    ELSE
      target_vehicle_id := NEW.vehicle_id;
    END IF;
  ELSE
    target_vehicle_id := NEW.vehicle_id;
  END IF;

  photo_exists := EXISTS(
    SELECT 1 FROM vehicle_images WHERE vehicle_id = target_vehicle_id LIMIT 1
  );

  UPDATE vehicles SET has_photos = photo_exists WHERE id = target_vehicle_id AND has_photos IS DISTINCT FROM photo_exists;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vehicle_primary_image()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_vehicle uuid;
BEGIN
  IF current_setting('app.skip_image_count_trigger', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  v_vehicle := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  IF v_vehicle IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.is_primary IS NOT DISTINCT FROM OLD.is_primary
     AND NEW.vision_gate_status IS NOT DISTINCT FROM OLD.vision_gate_status
     AND NEW.is_duplicate IS NOT DISTINCT FROM OLD.is_duplicate
     AND NEW.is_superseded IS NOT DISTINCT FROM OLD.is_superseded
     AND NEW.image_vehicle_match_status IS NOT DISTINCT FROM OLD.image_vehicle_match_status
     AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url
     AND NEW.taken_at IS NOT DISTINCT FROM OLD.taken_at THEN
    RETURN NEW;
  END IF;

  PERFORM recompute_vehicle_primary_image(v_vehicle);
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id AND OLD.vehicle_id IS NOT NULL THEN
    PERFORM recompute_vehicle_primary_image(OLD.vehicle_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Set-based bulk merge function that preserves every Gate 2, supersession, and journal invariant
-- of merge_into_primary(uuid, uuid) while operating on an array of (primary_id, dup_id) pairs using indexed ANY(array) plans.
CREATE OR REPLACE FUNCTION public.merge_into_primary_batch(primary_ids uuid[], dup_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  n_pairs INT := 0;
  n_images INT := 0;
  n_obs INT := 0;
  n_obs_superseded INT := 0;
  n_auction_events INT := 0;
  n_comments INT := 0;
  n_obs_disc INT := 0;
  n_vehicle_events INT := 0;
  n_timeline INT := 0;
  v_dups uuid[];
  v_primaries uuid[];
BEGIN
  PERFORM set_config('app.skip_completion_enqueue', '1', true);
  PERFORM set_config('app.skip_image_count_trigger', '1', true);
  PERFORM set_config('nuke.bulk_sale_correction', 'on', true);

  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_pairs (
    primary_id uuid NOT NULL,
    dup_id uuid NOT NULL PRIMARY KEY,
    pre_status text,
    proposal_id uuid
  ) ON COMMIT DROP;
  TRUNCATE _batch_merge_pairs;

  -- Filter valid pairs + enforce Gate 2 + SKIP LOCKED so concurrent maintenance jobs never block us
  WITH locked_p AS (
    SELECT id, status, user_id
    FROM vehicles
    WHERE id = ANY(primary_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  ),
  locked_d AS (
    SELECT id, status, user_id
    FROM vehicles
    WHERE id = ANY(dup_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  )
  INSERT INTO _batch_merge_pairs (primary_id, dup_id, pre_status)
  SELECT DISTINCT ON (t.d) t.p, t.d, vd.status
  FROM unnest(primary_ids, dup_ids) AS t(p, d)
  JOIN locked_p vp ON vp.id = t.p
  JOIN locked_d vd ON vd.id = t.d
  WHERE t.p <> t.d
    AND (
      (vp.user_id IS NULL AND vd.user_id IS NULL)
      OR EXISTS (
        SELECT 1 FROM vehicle_merge_proposals vmp
        WHERE ((vmp.primary_vehicle_id = t.p AND vmp.duplicate_vehicle_id = t.d)
            OR (vmp.primary_vehicle_id = t.d AND vmp.duplicate_vehicle_id = t.p))
          AND vmp.status = 'approved' AND vmp.reviewed_by IS NOT NULL
      )
    );

  GET DIAGNOSTICS n_pairs = ROW_COUNT;
  IF n_pairs = 0 THEN
    RETURN jsonb_build_object('merged_count', 0, 'merged_dup_ids', '[]'::jsonb);
  END IF;

  SELECT array_agg(dup_id), array_agg(DISTINCT primary_id)
    INTO v_dups, v_primaries
    FROM _batch_merge_pairs;

  -- Upsert vehicle_merge_proposals for all pairs
  INSERT INTO vehicle_merge_proposals (
    primary_vehicle_id, duplicate_vehicle_id,
    match_type, confidence_score, status, detected_by, detected_at, merged_at, pre_merge_dup_status
  )
  SELECT primary_id, dup_id, 'exact_listing_url', 100, 'merged', 'dedup-worker', NOW(), NOW(), pre_status
  FROM _batch_merge_pairs
  ON CONFLICT (primary_vehicle_id, duplicate_vehicle_id) DO UPDATE
    SET status = 'merged', merged_at = NOW(), pre_merge_dup_status = EXCLUDED.pre_merge_dup_status;

  -- 1. vehicle_images: move non-conflicting images; clear is_primary if primary already has a primary image
  UPDATE vehicle_images d
     SET vehicle_id = bmp.primary_id,
         merged_from_vehicle_id = bmp.dup_id,
         is_primary = CASE
           WHEN d.is_primary = true AND EXISTS (
             SELECT 1 FROM vehicle_images p
             WHERE p.vehicle_id = bmp.primary_id AND p.is_primary = true
               AND COALESCE(p.is_document, false) = false AND COALESCE(p.is_duplicate, false) = false
           ) THEN false
           ELSE d.is_primary
         END
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups)
     AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false
       AND EXISTS (
         SELECT 1 FROM vehicle_images p
         WHERE p.vehicle_id = bmp.primary_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false
       )
     );
  GET DIAGNOSTICS n_images = ROW_COUNT;

  -- 2. vehicle_observations: supersede duplicate observations sharing (source_id, source_identifier, kind) with primary, then move all
  WITH hits AS (
    SELECT d.id,
           (SELECT p.id FROM vehicle_observations p
             WHERE p.vehicle_id = bmp.primary_id AND p.source_id = d.source_id
               AND p.source_identifier = d.source_identifier AND p.kind = d.kind
             ORDER BY p.observed_at DESC NULLS LAST, p.id LIMIT 1) AS by_id
    FROM vehicle_observations d
    JOIN _batch_merge_pairs bmp ON bmp.dup_id = d.vehicle_id
    WHERE d.vehicle_id = ANY(v_dups) AND d.is_superseded IS NOT TRUE
  )
  UPDATE vehicle_observations o
     SET is_superseded = true, superseded_by = h.by_id, superseded_at = now()
    FROM hits h
   WHERE o.id = h.id AND h.by_id IS NOT NULL;
  GET DIAGNOSTICS n_obs_superseded = ROW_COUNT;

  UPDATE vehicle_observations d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND d.source_vin IS NULL
     AND d.source_vin_taxonomy_revision_id IS NULL
     AND d.extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
     AND d.source_vehicle_event_id IS NULL
     AND d.source_observation_id IS NULL
     AND d.source_comment_id IS NULL
     AND d.source_snapshot_id IS NULL;
  GET DIAGNOSTICS n_obs = ROW_COUNT;

  -- 3. auction_events
  UPDATE auction_events d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.source_url IS NOT NULL
       AND EXISTS (SELECT 1 FROM auction_events p WHERE p.vehicle_id = bmp.primary_id AND p.source_url = d.source_url)
     );
  GET DIAGNOSTICS n_auction_events = ROW_COUNT;

  -- 4. auction_comments
  UPDATE auction_comments d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.content_hash IS NOT NULL
       AND EXISTS (SELECT 1 FROM auction_comments p WHERE p.vehicle_id = bmp.primary_id AND p.content_hash = d.content_hash)
     );
  GET DIAGNOSTICS n_comments = ROW_COUNT;

  -- 5. observation_discoveries
  UPDATE observation_discoveries d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id;
  GET DIAGNOSTICS n_obs_disc = ROW_COUNT;

  -- 6. vehicle_events
  UPDATE vehicle_events d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       (d.source_listing_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = bmp.primary_id AND p.source_platform = d.source_platform AND p.source_listing_id = d.source_listing_id
       ))
       OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL AND EXISTS (
         SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = bmp.primary_id AND p.source_platform = d.source_platform AND p.source_url = d.source_url AND p.source_listing_id IS NULL
       ))
     );
  GET DIAGNOSTICS n_vehicle_events = ROW_COUNT;

  -- 7. timeline_events
  UPDATE timeline_events d
     SET vehicle_id = bmp.primary_id, merged_from_vehicle_id = bmp.dup_id
    FROM _batch_merge_pairs bmp
   WHERE d.vehicle_id = ANY(v_dups) AND d.vehicle_id = bmp.dup_id
     AND NOT (
       d.event_type IN ('photo_session', 'batch_image_upload')
       AND EXISTS (
         SELECT 1 FROM timeline_events p
         WHERE p.vehicle_id = bmp.primary_id
           AND p.event_type IN ('photo_session', 'batch_image_upload')
           AND p.event_date IS NOT DISTINCT FROM d.event_date
           AND COALESCE(p.user_id::text, 'system') = COALESCE(d.user_id::text, 'system')
       )
     );
  GET DIAGNOSTICS n_timeline = ROW_COUNT;

  -- 8. Soft-delete the duplicates first so unique partial indexes on active rows are freed
  UPDATE vehicles v
     SET merged_into_vehicle_id = bmp.primary_id,
         status = 'merged',
         deleted_at = NOW(),
         image_count = 0,
         has_photos = false
    FROM _batch_merge_pairs bmp
   WHERE v.id = ANY(v_dups) AND v.id = bmp.dup_id;

  -- 9. Copy missing URL/image/date fields + recount image_count once on primary
  UPDATE vehicles vp
     SET listing_url = COALESCE(vp.listing_url, CASE
           WHEN vd.listing_url IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM vehicles v2 WHERE v2.listing_url = vd.listing_url AND v2.deleted_at IS NULL AND v2.id <> vp.id
           ) THEN vd.listing_url
           ELSE NULL
         END),
         discovery_url = COALESCE(vp.discovery_url, CASE
           WHEN vd.discovery_url IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM vehicles v2 WHERE v2.discovery_url = vd.discovery_url AND v2.id <> vp.id
           ) THEN vd.discovery_url
           ELSE NULL
         END),
         primary_image_url = COALESCE(vp.primary_image_url, vd.primary_image_url),
         sale_date = COALESCE(vp.sale_date, vd.sale_date),
         color = COALESCE(vp.color, vd.color),
         interior_color = COALESCE(vp.interior_color, vd.interior_color),
         transmission = COALESCE(vp.transmission, vd.transmission),
         description = COALESCE(vp.description, vd.description),
         image_count = (
           SELECT count(*) FROM vehicle_images i
           WHERE i.vehicle_id = vp.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE
         ),
         has_photos = EXISTS (
           SELECT 1 FROM vehicle_images i WHERE i.vehicle_id = vp.id LIMIT 1
         )
    FROM _batch_merge_pairs bmp
    JOIN vehicles vd ON vd.id = bmp.dup_id
   WHERE vp.id = ANY(v_primaries) AND vp.id = bmp.primary_id;

  RETURN jsonb_build_object(
    'merged_count', n_pairs,
    'images_moved', n_images,
    'observations_moved', n_obs,
    'observations_superseded', n_obs_superseded,
    'events_moved', n_auction_events,
    'comments_moved', n_comments,
    'obs_disc_moved', n_obs_disc,
    'vehicle_events_moved', n_vehicle_events,
    'timeline_events_moved', n_timeline,
    'merged_dup_ids', COALESCE(to_jsonb(v_dups), '[]'::jsonb)
  );
END;
$$;

COMMIT;

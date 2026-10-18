-- Merge writer: re-parent the testimony it used to strand, and never delete an auction lot row.
-- Break (lane U, 2026-10-06): merge_vehicle_into_primary_by_url re-parents images, timelines, comments, price
-- history, contributors, dealer inventory, import queue, organization links, external listings and auction events,
-- but not vehicle_observations, auction_comments, bat_bids or vehicle_events. When a duplicate's auction_events row
-- carried a source_url the primary already held, it DELETEd that row, and auction_comments.auction_event_id is
-- ON DELETE CASCADE, so the delete took the lot's comments with it. A duplicate that shares a lot with its primary
-- could not be merged without losing testimony.
-- Behaviour change (body otherwise as live; no trigger, grant or row change here):
--   * A missing primary vehicle now raises. Before, only the duplicate was checked and the children of a merge into
--     a vehicle that does not exist were re-parented to nothing. A missing duplicate still returns vehicle_not_found.
--   * vehicle_images: a row whose (vehicle_id, file_hash) the primary already holds live (idx_unique_vehicle_file_hash)
--     stays on the duplicate and is counted; the move used to abort on it. If the primary already has a primary image
--     under the predicate of vehicle_images_one_primary_per_vehicle_idx, the duplicate's moving rows flagged primary
--     are demoted first and counted as demoted_primary. Otherwise the live trigger ensure_single_primary_image would
--     clear the primary's own flag and hand its primary photo to the duplicate's image. The flag is display state,
--     not testimony (relink_testimony demotes the moved row for the same reason). A primary with no primary image
--     keeps the moved flag.
--   * auction_events: never deleted. A row whose lot the primary already holds stays on the duplicate and is
--     counted. The lot is compared by normalised URL, lower-case with trailing slashes stripped, the way the landers
--     key a lot: one lot read with and without its trailing slash is one lot, which the exact-URL unique index cannot
--     see, and moving the second row would give the primary two rows for one lot. A NULL source_url never collides
--     and moves, as in the unique index. Two duplicate rows that normalise alike move one and keep one, because the
--     second finds the first on the primary. Every other row moves, stamped merged_from_vehicle_id.
--   * auction_comments, bat_bids: children follow their lot. A row whose auction_event_id names a lot that stayed on
--     the duplicate stays with it. A child of a moved lot, and a child with no lot, move to the primary. A row the
--     primary already holds stays too, and is counted: same (vehicle_id, content_hash) for comments; same bidder,
--     amount and moment for bids (their unique key leads with bat_listing_id, which differs between two reads of one
--     lot, so a plain UPDATE would not collide, it would list every bid twice). bat_username, bid_amount and
--     bid_timestamp are NOT NULL on prod (read 2026-10-06), so plain equality is exact there.
--   * vehicle_events carry no lot pointer, so they follow the vehicle. The two partial unique keys decide what stays.
--   * If a unique key the pre-checks do not model trips on images, comments, bids or events, that table is retried
--     row by row and only the colliding rows stay.
--   * vehicle_observations (live rows only): relinked in place, never copied. vehicle_id moves to the primary,
--     merged_from_vehicle_id names the duplicate, and one reattribution_audit row per row records old = new row id,
--     the statements the live relink_testimony() uses for an observation (its 2026-09-27 body: vehicle_id and
--     merged_from_vehicle_id on the same row, one audit row with old = new, no copy, no supersession). Nothing is
--     inserted. A row a live guard trigger refuses (check_violation, for example a retained property projection, or a
--     row sourced from a comment, a vehicle event or a parent observation) stays and is counted.
--     Why not supersede-and-copy: unique_observation is UNIQUE (source_id, source_identifier, kind, content_hash),
--     table-wide and not partial, so a copy of any fully keyed row collides with its own original whatever the
--     primary holds (docs/wiring/receipts/2026-06-11_k5-doppelganger-reattribution.md). For the same reason a fully
--     keyed twin of a duplicate's row cannot sit on the primary, so there is no "already there" branch. A row whose
--     key has a NULL can coexist with a content twin on the primary, and is relinked like any other.
--   * Returns the existing keys plus reparented: {table: {moved, left_on_duplicate}} for vehicle_images (plus
--     demoted_primary), vehicle_observations, auction_comments, bat_bids, vehicle_events and auction_events.
--     left_on_duplicate counts the rows still carrying the duplicate's vehicle_id after the move. For
--     vehicle_observations that is live rows only: superseded history rows stay on the duplicate by design and are
--     not counted.
-- Not changed here: the DELETEs of colliding organization_vehicles and external_listings rows, and the
-- timeline_events UPDATE whose trigger rescans an organization's images (separate blocker).
-- Drift guard: PRE is the md5 of pg_get_functiondef for the live definition. It was read from prod at
-- 2026-10-06T08:59:58Z and again at 09:11:10Z (PostgreSQL 17.6, through the Supabase connector) and equals the md5 of
-- the definition retained that day, installed in a throwaway PostgreSQL 14 and 17 cluster. To re-check:
--   select md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure));
-- A mismatch makes this migration refuse to run (fail closed), it never replaces an unreviewed body. POST is
-- asserted again after the replacement, so the already-applied branch and a fresh apply both end on the same body,
-- and a body that does not hash to POST aborts the transaction.
-- Forward-only. Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure));
  IF f = '9fa01208977c21d54786ad4534560c3e' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'merge writer already re-parents the child tables';
  ELSIF f <> 'cd6ffabcd4253ea4950519eab52784aa' THEN -- gitleaks:allow (live fingerprint read from prod 2026-10-06, not a secret)
    RAISE EXCEPTION 'merge writer body drifted since 2026-10-06 (md5 %); review before replacement', f;
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.merge_vehicle_into_primary_by_url(p_primary_vehicle_id uuid, p_duplicate_vehicle_id uuid, p_reason text DEFAULT 'canonical_url_match'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_primary public.vehicles%ROWTYPE;
  v_dup public.vehicles%ROWTYPE;
  r record;
  existing_id uuid;
  v_why text := format('merge_vehicle_into_primary_by_url: %s', COALESCE(p_reason, 'canonical_url_match'));
  v_primary_has_primary_image boolean;
  v_img_moved int := 0;
  v_img_left int := 0;
  v_img_demoted int := 0;
  v_ae_moved int := 0;
  v_ae_left int := 0;
  v_ac_moved int := 0;
  v_ac_left int := 0;
  v_bb_moved int := 0;
  v_bb_left int := 0;
  v_ve_moved int := 0;
  v_ve_left int := 0;
  v_vo_moved int := 0;
  v_vo_left int := 0;
BEGIN
  IF p_primary_vehicle_id IS NULL OR p_duplicate_vehicle_id IS NULL OR p_primary_vehicle_id = p_duplicate_vehicle_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_ids');
  END IF;

  SELECT * INTO v_primary FROM public.vehicles WHERE id = p_primary_vehicle_id;
  SELECT * INTO v_dup FROM public.vehicles WHERE id = p_duplicate_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'vehicle_not_found');
  END IF;
  IF v_primary.id IS NULL THEN
    RAISE EXCEPTION 'merge_vehicle_into_primary_by_url: primary vehicle % does not exist', p_primary_vehicle_id;
  END IF;

  -- Merge top-level fields (vehicles.make and vehicles.model are NOT NULL in prod)
  UPDATE public.vehicles
  SET
    vin = CASE
      WHEN v_primary.vin IS NOT NULL AND btrim(v_primary.vin) <> '' AND v_primary.vin NOT LIKE 'VIVA-%' THEN v_primary.vin
      WHEN v_dup.vin IS NOT NULL AND btrim(v_dup.vin) <> '' AND v_dup.vin NOT LIKE 'VIVA-%' THEN v_dup.vin
      ELSE COALESCE(v_primary.vin, v_dup.vin)
    END,
    year = COALESCE(v_primary.year, v_dup.year),
    make = COALESCE(NULLIF(btrim(v_primary.make), ''), NULLIF(btrim(v_dup.make), ''), ''),
    model = COALESCE(NULLIF(btrim(v_primary.model), ''), NULLIF(btrim(v_dup.model), ''), ''),
    trim = COALESCE(NULLIF(btrim(v_primary.trim), ''), NULLIF(btrim(v_dup.trim), ''), v_primary.trim, v_dup.trim),
    mileage = COALESCE(v_primary.mileage, v_dup.mileage),
    current_value = GREATEST(COALESCE(v_primary.current_value, 0), COALESCE(v_dup.current_value, 0)),
    sale_price = COALESCE(v_primary.sale_price, v_dup.sale_price),
    purchase_price = COALESCE(v_primary.purchase_price, v_dup.purchase_price),
    primary_image_url = COALESCE(v_primary.primary_image_url, v_dup.primary_image_url),
    discovery_url = COALESCE(v_primary.discovery_url, v_dup.discovery_url),
    origin_metadata = COALESCE(v_primary.origin_metadata, '{}'::jsonb) || COALESCE(v_dup.origin_metadata, '{}'::jsonb),
    updated_at = NOW()
  WHERE id = p_primary_vehicle_id;

  -- vehicle_images. A row whose live (vehicle_id, file_hash) the primary already holds would trip
  -- idx_unique_vehicle_file_hash, so it stays on the duplicate (counted). When the primary already has a primary
  -- image under the predicate of vehicle_images_one_primary_per_vehicle_idx, the duplicate's moving rows flagged
  -- primary are demoted first (counted): the ensure_single_primary_image trigger would otherwise clear the
  -- primary's own flag and give its primary photo to the duplicate's image. The flag is display state, not
  -- testimony. The move itself changes only vehicle_id, as before.
  v_primary_has_primary_image := EXISTS (
    SELECT 1 FROM public.vehicle_images
    WHERE vehicle_id = p_primary_vehicle_id AND is_primary = true
      AND (is_document IS NULL OR is_document = false) AND (is_duplicate IS NULL OR is_duplicate = false));
  IF v_primary_has_primary_image THEN
    UPDATE public.vehicle_images d
    SET is_primary = false
    WHERE d.vehicle_id = p_duplicate_vehicle_id AND d.is_primary = true
      AND NOT (d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
        SELECT 1 FROM public.vehicle_images p
        WHERE p.vehicle_id = p_primary_vehicle_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false));
    GET DIAGNOSTICS v_img_demoted = ROW_COUNT;
  END IF;
  BEGIN
    UPDATE public.vehicle_images d
    SET vehicle_id = p_primary_vehicle_id
    WHERE d.vehicle_id = p_duplicate_vehicle_id
      AND NOT (d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
        SELECT 1 FROM public.vehicle_images p
        WHERE p.vehicle_id = p_primary_vehicle_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false));
    GET DIAGNOSTICS v_img_moved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    v_img_moved := 0;
    FOR r IN
      SELECT d.id FROM public.vehicle_images d
      WHERE d.vehicle_id = p_duplicate_vehicle_id
        AND NOT (d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
          SELECT 1 FROM public.vehicle_images p
          WHERE p.vehicle_id = p_primary_vehicle_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false))
      ORDER BY d.id
    LOOP
      BEGIN
        UPDATE public.vehicle_images SET vehicle_id = p_primary_vehicle_id WHERE id = r.id;
        v_img_moved := v_img_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END;
  SELECT count(*) INTO v_img_left FROM public.vehicle_images WHERE vehicle_id = p_duplicate_vehicle_id;

  -- Re-parent core child tables (known to exist)
  UPDATE public.vehicle_timeline SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.timeline_events SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_comments SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_price_history SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_contributors SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.dealer_inventory SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.import_queue SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;

  -- organization_vehicles: prevent duplicate relationship collisions
  FOR r IN
    SELECT * FROM public.organization_vehicles WHERE vehicle_id = p_duplicate_vehicle_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_vehicles
      WHERE organization_id = r.organization_id
        AND vehicle_id = p_primary_vehicle_id
        AND relationship_type = r.relationship_type
    ) THEN
      UPDATE public.organization_vehicles
      SET vehicle_id = p_primary_vehicle_id
      WHERE id = r.id;
    ELSE
      DELETE FROM public.organization_vehicles WHERE id = r.id;
    END IF;
  END LOOP;

  -- external_listings: prevent duplicate platform/listing_id collisions
  FOR r IN
    SELECT id, platform, listing_id FROM public.external_listings WHERE vehicle_id = p_duplicate_vehicle_id
  LOOP
    SELECT id INTO existing_id
    FROM public.external_listings
    WHERE vehicle_id = p_primary_vehicle_id
      AND platform = r.platform
      AND (listing_id IS NOT DISTINCT FROM r.listing_id)
    LIMIT 1;

    IF existing_id IS NULL THEN
      UPDATE public.external_listings SET vehicle_id = p_primary_vehicle_id WHERE id = r.id;
    ELSE
      DELETE FROM public.external_listings WHERE id = r.id;
    END IF;
  END LOOP;

  -- auction_events: a lot row is testimony and is never deleted. A row whose lot the primary already holds stays on
  -- the duplicate (counted). The lot is its normalised URL, lower-case with trailing slashes stripped (the landers'
  -- key), so the same lot read with and without its trailing slash is one lot. A NULL source_url matches nothing and
  -- moves, as the unique index treats NULLs as distinct. Every other row moves to the primary.
  FOR r IN
    SELECT id, source_url FROM public.auction_events WHERE vehicle_id = p_duplicate_vehicle_id ORDER BY id
  LOOP
    SELECT id INTO existing_id
    FROM public.auction_events
    WHERE vehicle_id = p_primary_vehicle_id
      AND lower(rtrim(source_url, '/')) = lower(rtrim(r.source_url, '/'))
    LIMIT 1;

    IF existing_id IS NULL THEN
      BEGIN
        UPDATE public.auction_events
        SET vehicle_id = p_primary_vehicle_id, merged_from_vehicle_id = p_duplicate_vehicle_id
        WHERE id = r.id;
        v_ae_moved := v_ae_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        v_ae_left := v_ae_left + 1;
      END;
    ELSE
      v_ae_left := v_ae_left + 1;
    END IF;
  END LOOP;

  -- Testimony this writer used to strand (lane U, 2026-10-06). Order matters: lots are moved above, then the
  -- comments and bids that hang off them, then events, then the observations that may cite those comments.
  -- Each table moves in one statement. A row the primary already holds stays on the duplicate and is counted.
  -- If a unique key the pre-check does not model trips, the table is retried row by row.

  -- auction_comments: unique (vehicle_id, content_hash). The same hash on the primary is the same comment. A comment
  -- on a lot that stayed on the duplicate stays with it; a comment on a moved lot, or on no lot, moves.
  BEGIN
    UPDATE public.auction_comments d
    SET vehicle_id = p_primary_vehicle_id, merged_from_vehicle_id = p_duplicate_vehicle_id
    WHERE d.vehicle_id = p_duplicate_vehicle_id
      AND NOT EXISTS (
        SELECT 1 FROM public.auction_events e
        WHERE e.id = d.auction_event_id AND e.vehicle_id = p_duplicate_vehicle_id)
      AND NOT (d.content_hash IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.auction_comments c
        WHERE c.vehicle_id = p_primary_vehicle_id AND c.content_hash = d.content_hash));
    GET DIAGNOSTICS v_ac_moved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    v_ac_moved := 0;
    FOR r IN
      SELECT d.id FROM public.auction_comments d
      WHERE d.vehicle_id = p_duplicate_vehicle_id
        AND NOT EXISTS (
          SELECT 1 FROM public.auction_events e
          WHERE e.id = d.auction_event_id AND e.vehicle_id = p_duplicate_vehicle_id)
        AND NOT (d.content_hash IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.auction_comments c
          WHERE c.vehicle_id = p_primary_vehicle_id AND c.content_hash = d.content_hash))
      ORDER BY d.id
    LOOP
      BEGIN
        UPDATE public.auction_comments
        SET vehicle_id = p_primary_vehicle_id, merged_from_vehicle_id = p_duplicate_vehicle_id
        WHERE id = r.id;
        v_ac_moved := v_ac_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END;
  SELECT count(*) INTO v_ac_left FROM public.auction_comments WHERE vehicle_id = p_duplicate_vehicle_id;

  -- bat_bids: unique (bat_listing_id, bat_username, bid_amount, bid_timestamp) does not include the vehicle, and two
  -- reads of one lot carry different bat_listing_id values, so a plain move would list every bid twice. A bid the
  -- primary already holds (same bidder, amount and moment; all three columns are NOT NULL on prod, so = is exact)
  -- stays on the duplicate. A bid on a lot that stayed on the duplicate stays with it.
  BEGIN
    UPDATE public.bat_bids d
    SET vehicle_id = p_primary_vehicle_id
    WHERE d.vehicle_id = p_duplicate_vehicle_id
      AND NOT EXISTS (
        SELECT 1 FROM public.auction_events e
        WHERE e.id = d.auction_event_id AND e.vehicle_id = p_duplicate_vehicle_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.bat_bids b
        WHERE b.vehicle_id = p_primary_vehicle_id
          AND b.bat_username = d.bat_username
          AND b.bid_amount = d.bid_amount
          AND b.bid_timestamp = d.bid_timestamp);
    GET DIAGNOSTICS v_bb_moved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    v_bb_moved := 0;
    FOR r IN
      SELECT d.id FROM public.bat_bids d
      WHERE d.vehicle_id = p_duplicate_vehicle_id
        AND NOT EXISTS (
          SELECT 1 FROM public.auction_events e
          WHERE e.id = d.auction_event_id AND e.vehicle_id = p_duplicate_vehicle_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.bat_bids b
          WHERE b.vehicle_id = p_primary_vehicle_id
            AND b.bat_username = d.bat_username
            AND b.bid_amount = d.bid_amount
            AND b.bid_timestamp = d.bid_timestamp)
      ORDER BY d.id
    LOOP
      BEGIN
        UPDATE public.bat_bids SET vehicle_id = p_primary_vehicle_id WHERE id = r.id;
        v_bb_moved := v_bb_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END;
  SELECT count(*) INTO v_bb_left FROM public.bat_bids WHERE vehicle_id = p_duplicate_vehicle_id;

  -- vehicle_events (no lot pointer, they follow the vehicle): unique (vehicle_id, source_platform, source_listing_id)
  -- where the listing id is set, and (vehicle_id, source_platform, source_url) where it is not.
  BEGIN
    UPDATE public.vehicle_events d
    SET vehicle_id = p_primary_vehicle_id
    WHERE d.vehicle_id = p_duplicate_vehicle_id
      AND NOT EXISTS (
        SELECT 1 FROM public.vehicle_events e
        WHERE e.vehicle_id = p_primary_vehicle_id
          AND e.source_platform = d.source_platform
          AND ((d.source_listing_id IS NOT NULL AND e.source_listing_id = d.source_listing_id)
            OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL
                AND e.source_listing_id IS NULL AND e.source_url = d.source_url)));
    GET DIAGNOSTICS v_ve_moved = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    v_ve_moved := 0;
    FOR r IN
      SELECT d.id FROM public.vehicle_events d
      WHERE d.vehicle_id = p_duplicate_vehicle_id
        AND NOT EXISTS (
          SELECT 1 FROM public.vehicle_events e
          WHERE e.vehicle_id = p_primary_vehicle_id
            AND e.source_platform = d.source_platform
            AND ((d.source_listing_id IS NOT NULL AND e.source_listing_id = d.source_listing_id)
              OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL
                  AND e.source_listing_id IS NULL AND e.source_url = d.source_url)))
      ORDER BY d.id
    LOOP
      BEGIN
        UPDATE public.vehicle_events SET vehicle_id = p_primary_vehicle_id WHERE id = r.id;
        v_ve_moved := v_ve_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END;
  SELECT count(*) INTO v_ve_left FROM public.vehicle_events WHERE vehicle_id = p_duplicate_vehicle_id;

  -- vehicle_observations, live rows only (superseded history stays where it is). Relinked in place, never copied
  -- (unique_observation is table-wide): vehicle_id changes, merged_from_vehicle_id names the duplicate, one
  -- reattribution_audit row per row. A row a guard trigger refuses (check_violation) or a unique key trips on
  -- stays on the duplicate and is counted.
  BEGIN
    WITH moved AS (
      UPDATE public.vehicle_observations
      SET vehicle_id = p_primary_vehicle_id, merged_from_vehicle_id = p_duplicate_vehicle_id
      WHERE vehicle_id = p_duplicate_vehicle_id
        AND COALESCE(is_superseded, false) = false
      RETURNING id
    )
    INSERT INTO public.reattribution_audit (
      observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason)
    SELECT 'observation', m.id, p_duplicate_vehicle_id, m.id, p_primary_vehicle_id, v_why
    FROM moved m;
    GET DIAGNOSTICS v_vo_moved = ROW_COUNT;
  EXCEPTION WHEN unique_violation OR check_violation THEN
    v_vo_moved := 0;
    FOR r IN
      SELECT o.id FROM public.vehicle_observations o
      WHERE o.vehicle_id = p_duplicate_vehicle_id
        AND COALESCE(o.is_superseded, false) = false
      ORDER BY o.id
    LOOP
      BEGIN
        UPDATE public.vehicle_observations
        SET vehicle_id = p_primary_vehicle_id, merged_from_vehicle_id = p_duplicate_vehicle_id
        WHERE id = r.id;
        INSERT INTO public.reattribution_audit (
          observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason)
        VALUES ('observation', r.id, p_duplicate_vehicle_id, r.id, p_primary_vehicle_id, v_why);
        v_vo_moved := v_vo_moved + 1;
      EXCEPTION WHEN unique_violation OR check_violation THEN
        NULL;
      END;
    END LOOP;
  END;
  SELECT count(*) INTO v_vo_left
  FROM public.vehicle_observations
  WHERE vehicle_id = p_duplicate_vehicle_id AND COALESCE(is_superseded, false) = false;

  -- Mark the duplicate as merged + hide it from public feeds
  UPDATE public.vehicles
  SET
    merged_into_vehicle_id = p_primary_vehicle_id,
    is_public = false,
    updated_at = NOW()
  WHERE id = p_duplicate_vehicle_id;

  INSERT INTO public.timeline_events (
    vehicle_id,
    event_type,
    event_date,
    title,
    description,
    source,
    source_type,
    metadata
  ) VALUES (
    p_primary_vehicle_id,
    'profile_merged',
    NOW(),
    'Vehicle Profile Merged',
    format('Merged duplicate vehicle %s into %s (%s)', p_duplicate_vehicle_id, p_primary_vehicle_id, p_reason),
    'system',
    'system',
    jsonb_build_object(
      'duplicate_vehicle_id', p_duplicate_vehicle_id,
      'primary_vehicle_id', p_primary_vehicle_id,
      'reason', p_reason,
      'merged_at', NOW()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'primary_vehicle_id', p_primary_vehicle_id,
    'duplicate_vehicle_id', p_duplicate_vehicle_id,
    'reparented', jsonb_build_object(
      'vehicle_images', jsonb_build_object('moved', v_img_moved, 'left_on_duplicate', v_img_left, 'demoted_primary', v_img_demoted),
      'vehicle_observations', jsonb_build_object('moved', v_vo_moved, 'left_on_duplicate', v_vo_left),
      'auction_comments', jsonb_build_object('moved', v_ac_moved, 'left_on_duplicate', v_ac_left),
      'bat_bids', jsonb_build_object('moved', v_bb_moved, 'left_on_duplicate', v_bb_left),
      'vehicle_events', jsonb_build_object('moved', v_ve_moved, 'left_on_duplicate', v_ve_left),
      'auction_events', jsonb_build_object('moved', v_ae_moved, 'left_on_duplicate', v_ae_left)
    )
  );
END;
$function$;
DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure)) <> '9fa01208977c21d54786ad4534560c3e' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE EXCEPTION 'merge writer replacement did not produce the expected body; rolling back';
  END IF;
END;
$post$;
COMMIT;

-- Merges keep identity, merged-away rows stop owning VINs, and batch merges become reversible.
-- Found by the 2026-10-17/18 Mecum dedup (19,180 merge_into_primary_batch merges, detected_by 'dedup-worker'):
--  1. merge_into_primary_batch did not carry vin: 832 survivors have no VIN while their merged-away duplicate holds one, and
--     correct_vehicle_vin then answered held_by the merged duplicate. A merged-away row is not a live owner (the VIN unique
--     indexes and enforce_vin_uniqueness already skip status 'merged'); correct_vehicle_vin now agrees. The batch merge now
--     carries vin and the identity columns (year, make, model, trim, series, generation, body_style, engine_size, engine_type,
--     drivetrain, fuel_type) the survivor lacks, and refuses a pair whose two VINs differ (12 merged pairs had two VINs; 11 were
--     two cars that shared one lot URL).
--  2. The batch merge wrote no merge_journal, so unmerge_vehicle refused it (no_journal). It now journals the supersessions it
--     records and the survivor columns it fills. unmerge_vehicle reverses a journal-less batch merge from 2026-10-17 on by
--     deriving its supersessions (that version archived nothing; every row it moved carries merged_from_vehicle_id and every
--     supersession it recorded has superseded_at = merged_at, one transaction), clears the survivor columns a journal says the
--     merge filled (still holding that value), refuses a pair whose survivor holds the duplicate's VIN otherwise, and parks the
--     duplicate's listing_url (kept in the journal) when a live vehicle already holds it.
--  3. Canonical sale outcomes continue to use their existing evidence-based resolver. Historical sale corrections
--     require their retained source witness and the sanctioned provenance writer; a stored derived label is not new testimony.
--  4. propose_listing_vin_merge stamped every proposal proposed_by 'extract-ebay-motors'; it now takes app.writer when set.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

-- 1. correct_vehicle_vin: held_by only by a live vehicle.
CREATE OR REPLACE FUNCTION public.correct_vehicle_vin(p_vehicle_id uuid, p_expected text, p_value text, p_source jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'correct_vehicle_vin';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_live       text;
  v_haystack   text;
  v_other      uuid;
  v_asserted   text;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  IF p_vehicle_id IS NULL THEN RAISE EXCEPTION '%: p_vehicle_id is required', c_writer; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION '%: vehicle % needs a reason (at least 10 characters)', c_writer, p_vehicle_id;
  END IF;
  IF p_source IS NULL OR jsonb_typeof(p_source) <> 'object'
     OR coalesce(btrim(p_source ->> 'type'), '') = '' OR coalesce(btrim(p_source ->> 'ref'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle % has no cited source (source.type and source.ref)', c_writer, p_vehicle_id;
  END IF;
  -- A NULL expected value is a fill of an EMPTY vin and must say so (source.fill_empty = true); otherwise the live value is expected.
  IF (p_expected IS NULL OR btrim(p_expected) = '') AND coalesce(p_source ->> 'fill_empty', '') <> 'true' THEN
    RAISE EXCEPTION '%: vehicle % needs the expected live vin (or source.fill_empty = true to fill an empty one)', c_writer, p_vehicle_id;
  END IF;
  IF (p_expected IS NULL OR btrim(p_expected) = '') AND p_value IS NULL THEN
    RAISE EXCEPTION '%: vehicle % fill of an empty vin needs a value', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NOT NULL AND (btrim(p_value) = '' OR p_value <> upper(btrim(p_value)) OR p_value !~ '^[A-Z0-9*][A-Z0-9*./-]{1,29}$') THEN
    RAISE EXCEPTION '%: vehicle % replacement must be upper-case chassis or VIN characters (2 to 30)', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NOT DISTINCT FROM p_expected THEN
    RAISE EXCEPTION '%: vehicle % replacement equals the expected value', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NULL AND coalesce(btrim(p_source ->> 'finding'), '') = '' THEN
    RAISE EXCEPTION '%: vehicle %: a retraction to unknown must state its finding (source.finding)', c_writer, p_vehicle_id;
  END IF;
  IF p_value IS NOT NULL THEN
    -- The new value must be readable in the cited text: alphanumerics only, case-insensitive.
    v_haystack := regexp_replace(upper(coalesce(p_source ->> 'chassis_text', '') || ' ' || coalesce(p_source ->> 'url', '')), '[^A-Z0-9]', '', 'g');
    IF v_haystack = '' OR position(regexp_replace(p_value, '[^A-Z0-9]', '', 'g') IN v_haystack) = 0 THEN
      RAISE EXCEPTION '%: vehicle %: replacement % is not present in the cited chassis_text or url', c_writer, p_vehicle_id, p_value;
    END IF;
  END IF;

  v_asserted := coalesce(nullif(btrim(p_source ->> 'asserted_by'), ''), nullif(current_setting('app.writer', true), ''), 'agent');

  SELECT vin INTO v_live FROM vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found', 'vehicle_id', p_vehicle_id); END IF;
  IF v_live IS DISTINCT FROM nullif(btrim(coalesce(p_expected, '')), '') THEN
    RETURN jsonb_build_object('status', 'stale', 'vehicle_id', p_vehicle_id, 'live', v_live, 'expected', p_expected);
  END IF;

  IF p_value IS NOT NULL THEN
    -- The owners enforce_vin_uniqueness and the VIN unique indexes count: a merged-away row owns nothing.
    SELECT id INTO v_other FROM vehicles
     WHERE upper(btrim(vin)) = p_value AND id <> p_vehicle_id AND status IS DISTINCT FROM 'merged' LIMIT 1;
    IF v_other IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'held_by', 'vehicle_id', p_vehicle_id, 'held_by', v_other, 'value', p_value);
    END IF;
  END IF;

  INSERT INTO superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
  VALUES ('vehicles', p_vehicle_id, jsonb_build_object('field', 'vin', 'value', v_live, 'replacement', p_value), v_asserted, p_source, p_reason);

  PERFORM set_config('app.writer', c_writer, true);
  UPDATE vehicles SET vin = p_value WHERE id = p_vehicle_id;

  RETURN jsonb_build_object('status', 'corrected', 'vehicle_id', p_vehicle_id, 'was', v_live, 'now', p_value);
END;
$function$;

-- 2. merge_into_primary_batch: refuses two-VIN pairs, carries identity, journals what it did.
CREATE OR REPLACE FUNCTION public.merge_into_primary_batch(primary_ids uuid[], dup_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  n_vin_conflicts INT := 0;
  n_identity_filled INT := 0;
  n_vins_carried INT := 0;
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
    proposal_id uuid,
    vin_conflict boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  TRUNCATE _batch_merge_pairs;
  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_superseded (dup_id uuid NOT NULL, id uuid NOT NULL, by_id uuid NOT NULL) ON COMMIT DROP;
  TRUNCATE _batch_merge_superseded;
  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_before (id uuid PRIMARY KEY, f jsonb NOT NULL) ON COMMIT DROP;
  TRUNCATE _batch_merge_before;

  -- Filter valid pairs + enforce Gate 2 + SKIP LOCKED so concurrent maintenance jobs never block us
  WITH locked_p AS (
    SELECT id, status, user_id, vin
    FROM vehicles
    WHERE id = ANY(primary_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  ),
  locked_d AS (
    SELECT id, status, user_id, vin
    FROM vehicles
    WHERE id = ANY(dup_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  )
  INSERT INTO _batch_merge_pairs (primary_id, dup_id, pre_status, vin_conflict)
  SELECT DISTINCT ON (t.d) t.p, t.d, vd.status,
         nullif(upper(btrim(vp.vin)), '') IS NOT NULL AND nullif(upper(btrim(vd.vin)), '') IS NOT NULL
           AND upper(btrim(vp.vin)) <> upper(btrim(vd.vin))
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

  -- Two different VINs are two vehicles, whatever URL they share: never merged here.
  DELETE FROM _batch_merge_pairs WHERE vin_conflict;
  GET DIAGNOSTICS n_vin_conflicts = ROW_COUNT;
  SELECT count(*) INTO n_pairs FROM _batch_merge_pairs;
  IF n_pairs = 0 THEN
    RETURN jsonb_build_object('merged_count', 0, 'merged_dup_ids', '[]'::jsonb, 'vin_conflicts_skipped', n_vin_conflicts);
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
    SELECT d.id, bmp.dup_id,
           (SELECT p.id FROM vehicle_observations p
             WHERE p.vehicle_id = bmp.primary_id AND p.source_id = d.source_id
               AND p.source_identifier = d.source_identifier AND p.kind = d.kind
             ORDER BY p.observed_at DESC NULLS LAST, p.id LIMIT 1) AS by_id
    FROM vehicle_observations d
    JOIN _batch_merge_pairs bmp ON bmp.dup_id = d.vehicle_id
    WHERE d.vehicle_id = ANY(v_dups) AND d.is_superseded IS NOT TRUE
  ), sup AS (
    UPDATE vehicle_observations o
       SET is_superseded = true, superseded_by = h.by_id, superseded_at = now()
      FROM hits h
     WHERE o.id = h.id AND h.by_id IS NOT NULL
    RETURNING h.dup_id, o.id, h.by_id
  )
  INSERT INTO _batch_merge_superseded (dup_id, id, by_id) SELECT dup_id, id, by_id FROM sup;
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

  -- The survivor columns steps 9-11 may fill, before they run (the journal records what was filled).
  INSERT INTO _batch_merge_before (id, f)
  SELECT v.id, jsonb_build_object(
           'listing_url', v.listing_url, 'discovery_url', v.discovery_url, 'primary_image_url', v.primary_image_url,
           'sale_date', v.sale_date, 'color', v.color, 'interior_color', v.interior_color, 'transmission', v.transmission,
           'description', v.description, 'vin', v.vin, 'year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
           'series', v.series, 'generation', v.generation, 'body_style', v.body_style, 'engine_size', v.engine_size,
           'engine_type', v.engine_type, 'drivetrain', v.drivetrain, 'fuel_type', v.fuel_type)
    FROM vehicles v WHERE v.id = ANY(v_primaries);

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

  -- 10. Identity the survivor lacks, from its first duplicate, only on rows that gain a value (so the UPDATE OF
  --     year/make/model triggers fire only there).
  UPDATE vehicles vp
     SET year = COALESCE(vp.year, s.year), make = COALESCE(vp.make, s.make), model = COALESCE(vp.model, s.model),
         trim = COALESCE(vp.trim, s.trim), series = COALESCE(vp.series, s.series), generation = COALESCE(vp.generation, s.generation),
         body_style = COALESCE(vp.body_style, s.body_style), engine_size = COALESCE(vp.engine_size, s.engine_size),
         engine_type = COALESCE(vp.engine_type, s.engine_type), drivetrain = COALESCE(vp.drivetrain, s.drivetrain),
         fuel_type = COALESCE(vp.fuel_type, s.fuel_type)
    FROM (SELECT DISTINCT ON (bmp.primary_id) bmp.primary_id, vd.year, vd.make, vd.model, vd.trim, vd.series, vd.generation,
                 vd.body_style, vd.engine_size, vd.engine_type, vd.drivetrain, vd.fuel_type
            FROM _batch_merge_pairs bmp JOIN vehicles vd ON vd.id = bmp.dup_id
           ORDER BY bmp.primary_id, bmp.dup_id) s
   WHERE vp.id = s.primary_id
     AND ((vp.year IS NULL AND s.year IS NOT NULL) OR (vp.make IS NULL AND s.make IS NOT NULL)
       OR (vp.model IS NULL AND s.model IS NOT NULL) OR (vp.trim IS NULL AND s.trim IS NOT NULL)
       OR (vp.series IS NULL AND s.series IS NOT NULL) OR (vp.generation IS NULL AND s.generation IS NOT NULL)
       OR (vp.body_style IS NULL AND s.body_style IS NOT NULL) OR (vp.engine_size IS NULL AND s.engine_size IS NOT NULL)
       OR (vp.engine_type IS NULL AND s.engine_type IS NOT NULL) OR (vp.drivetrain IS NULL AND s.drivetrain IS NOT NULL)
       OR (vp.fuel_type IS NULL AND s.fuel_type IS NOT NULL));
  GET DIAGNOSTICS n_identity_filled = ROW_COUNT;

  -- 11. The duplicate's VIN, when the survivor has none. Step 8 freed it (merged rows own no VIN). Only a VIN that one survivor
  --     in this batch would take, that no other live vehicle holds, from a duplicate whose year and make do not contradict it.
  WITH c AS (
    SELECT bmp.primary_id, upper(btrim(vd.vin)) AS vin
      FROM _batch_merge_pairs bmp
      JOIN vehicles vd ON vd.id = bmp.dup_id
      JOIN vehicles vp ON vp.id = bmp.primary_id
     WHERE nullif(btrim(vp.vin), '') IS NULL AND nullif(btrim(vd.vin), '') IS NOT NULL
       AND (vp.year IS NULL OR vd.year IS NULL OR vp.year = vd.year)
       AND (vp.make IS NULL OR vd.make IS NULL OR lower(vp.make) = lower(vd.make))
  ), one AS (
    SELECT primary_id, min(vin) AS vin FROM c GROUP BY primary_id HAVING count(DISTINCT vin) = 1
  ), free AS (
    SELECT o.primary_id, o.vin FROM one o
     WHERE (SELECT count(*) FROM one o2 WHERE o2.vin = o.vin) = 1
       AND NOT EXISTS (SELECT 1 FROM vehicles x
                        WHERE upper(btrim(x.vin)) = o.vin AND x.id <> o.primary_id AND x.status IS DISTINCT FROM 'merged')
  )
  UPDATE vehicles vp SET vin = f.vin FROM free f WHERE vp.id = f.primary_id;
  GET DIAGNOSTICS n_vins_carried = ROW_COUNT;

  -- 12. Journal per pair: the supersessions it recorded and the survivor columns it filled (unmerge_vehicle reverses both).
  WITH after AS (
    SELECT v.id, jsonb_build_object(
             'listing_url', v.listing_url, 'discovery_url', v.discovery_url, 'primary_image_url', v.primary_image_url,
             'sale_date', v.sale_date, 'color', v.color, 'interior_color', v.interior_color, 'transmission', v.transmission,
             'description', v.description, 'vin', v.vin, 'year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim,
             'series', v.series, 'generation', v.generation, 'body_style', v.body_style, 'engine_size', v.engine_size,
             'engine_type', v.engine_type, 'drivetrain', v.drivetrain, 'fuel_type', v.fuel_type) AS f
      FROM vehicles v WHERE v.id = ANY(v_primaries)
  ), filled AS (
    SELECT a.id AS primary_id, k.key, k.value
      FROM after a JOIN _batch_merge_before b ON b.id = a.id, jsonb_each(a.f) k
     WHERE k.value <> 'null'::jsonb AND (b.f -> k.key) IN ('null'::jsonb, '""'::jsonb)
  ), owner AS (
    SELECT DISTINCT ON (f.primary_id, f.key) bmp.dup_id, f.key, f.value
      FROM filled f
      JOIN _batch_merge_pairs bmp ON bmp.primary_id = f.primary_id
      JOIN vehicles vd ON vd.id = bmp.dup_id
     ORDER BY f.primary_id, f.key, (to_jsonb(vd) -> f.key = f.value) DESC NULLS LAST, bmp.dup_id
  )
  UPDATE vehicle_merge_proposals vmp
     SET merge_journal = jsonb_build_object(
           'method', 'merge_into_primary_batch',
           'observations_superseded', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'by', s.by_id))
                                                  FROM _batch_merge_superseded s WHERE s.dup_id = bmp.dup_id), '[]'::jsonb),
           'survivor_filled', COALESCE((SELECT jsonb_object_agg(o.key, o.value) FROM owner o WHERE o.dup_id = bmp.dup_id), '{}'::jsonb))
    FROM _batch_merge_pairs bmp
   WHERE vmp.primary_vehicle_id = bmp.primary_id AND vmp.duplicate_vehicle_id = bmp.dup_id;

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
    'vin_conflicts_skipped', n_vin_conflicts,
    'identity_filled', n_identity_filled,
    'vins_carried', n_vins_carried,
    'merged_dup_ids', COALESCE(to_jsonb(v_dups), '[]'::jsonb)
  );
END;
$function$;

-- 3. unmerge_vehicle: reverses batch merges, clears what a merge filled on the survivor, parks a colliding listing_url.
CREATE OR REPLACE FUNCTION public.unmerge_vehicle(p_proposal_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_filled_columns CONSTANT text[] := ARRAY['listing_url', 'discovery_url', 'primary_image_url', 'sale_date', 'color', 'interior_color',
    'transmission', 'description', 'vin', 'year', 'make', 'model', 'trim', 'series', 'generation', 'body_style', 'engine_size',
    'engine_type', 'drivetrain', 'fuel_type'];
  v_proposal RECORD;
  v_journal JSONB;
  v_primary_id UUID;
  v_dup_id UUID;
  v_images_returned INT := 0; v_comments_returned INT := 0; v_observations_returned INT := 0; v_events_returned INT := 0;
  v_obs_disc_returned INT := 0; v_vehicle_events_returned INT := 0; v_timeline_returned INT := 0;
  v_unsuperseded INT := 0; v_archived_restored INT := 0; v_mp_rows INT := 0; v_n INT;
  v_key TEXT; v_val JSONB; v_reverted JSONB := '{}'::jsonb; v_dup_listing TEXT; v_parked TEXT;
  v_row RECORD;
BEGIN
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL OR NOT (public.is_admin_or_moderator() OR EXISTS (SELECT 1 FROM public.vehicle_merge_proposals mp WHERE mp.id = p_proposal_id AND public.user_can_edit_vehicle(mp.primary_vehicle_id, auth.uid()))) THEN
      RAISE EXCEPTION 'unmerge_vehicle: only an editor of the primary vehicle (or an admin) can unmerge' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_proposal FROM vehicle_merge_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'proposal_not_found'); END IF;
  IF v_proposal.status <> 'merged' THEN RETURN jsonb_build_object('error', 'not_merged', 'current_status', v_proposal.status); END IF;

  v_primary_id := v_proposal.primary_vehicle_id;
  v_dup_id := v_proposal.duplicate_vehicle_id;
  v_journal := v_proposal.merge_journal;

  -- A merge_into_primary_batch merge from 2026-10-17 on that predates its journal archived nothing and stamped every row it moved;
  -- its supersessions are the moved observations it superseded in its own transaction (superseded_at = merged_at).
  IF v_journal IS NULL AND v_proposal.detected_by = 'dedup-worker' AND v_proposal.match_type = 'exact_listing_url'
     AND v_proposal.merged_at >= '2026-10-17 00:00:00+00'
     AND NOT EXISTS (SELECT 1 FROM merge_deleted_rows WHERE proposal_id = p_proposal_id) THEN
    SELECT jsonb_build_object('method', 'merge_into_primary_batch', 'derived_at_unmerge', true,
             'observations_superseded', COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'by', o.superseded_by)), '[]'::jsonb))
      INTO v_journal
      FROM vehicle_observations o
     WHERE o.vehicle_id = v_primary_id AND o.merged_from_vehicle_id = v_dup_id
       AND o.is_superseded AND o.superseded_at = v_proposal.merged_at;
  END IF;
  IF v_journal IS NULL THEN
    RETURN jsonb_build_object('error', 'no_journal', 'message', 'This merge predates the journal system and cannot be automatically reversed.');
  END IF;

  -- The restored duplicate takes its VIN back: refuse while the primary holds that VIN by its own record (not by this merge).
  IF EXISTS (SELECT 1 FROM vehicles p, vehicles d
              WHERE p.id = v_primary_id AND d.id = v_dup_id
                AND nullif(upper(btrim(p.vin)), '') = upper(btrim(d.vin))
                AND to_jsonb(p.vin) IS DISTINCT FROM v_journal -> 'survivor_filled' -> 'vin') THEN
    RETURN jsonb_build_object('error', 'vin_shared', 'message', 'The primary holds the duplicate''s VIN; correct one of the VINs before unmerging.');
  END IF;

  -- 1. Rows that carry this merge's stamp go back. Post-merge additions have no stamp and stay on the primary.
  UPDATE vehicle_images SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_images_returned = ROW_COUNT;

  UPDATE vehicle_observations SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_observations_returned = ROW_COUNT;

  -- 1b. Clear exactly the supersessions this merge recorded (still pointing at the row the merge chose).
  UPDATE vehicle_observations o
     SET is_superseded = false, superseded_by = NULL, superseded_at = NULL
    FROM jsonb_to_recordset(COALESCE(v_journal->'observations_superseded', '[]'::jsonb)) AS j(id uuid, by uuid)
   WHERE o.id = j.id AND o.superseded_by = j.by;
  GET DIAGNOSTICS v_unsuperseded = ROW_COUNT;

  UPDATE auction_events SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_events_returned = ROW_COUNT;

  UPDATE auction_comments SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_comments_returned = ROW_COUNT;

  UPDATE observation_discoveries SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_obs_disc_returned = ROW_COUNT;

  UPDATE vehicle_events SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_vehicle_events_returned = ROW_COUNT;

  UPDATE timeline_events SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_timeline_returned = ROW_COUNT;

  -- 2. Archived rows: derived tables from this merge, and observations/comments archived by merges that predate this migration.
  FOR v_row IN SELECT * FROM merge_deleted_rows WHERE proposal_id = p_proposal_id AND restored_at IS NULL ORDER BY source_table LOOP
    BEGIN
      CASE v_row.source_table
        WHEN 'vehicle_observations' THEN
          INSERT INTO vehicle_observations SELECT * FROM jsonb_populate_record(NULL::vehicle_observations, v_row.row_data) ON CONFLICT DO NOTHING;
        WHEN 'auction_comments' THEN
          INSERT INTO auction_comments SELECT * FROM jsonb_populate_record(NULL::auction_comments, v_row.row_data) ON CONFLICT DO NOTHING;
        WHEN 'bat_listings' THEN
          INSERT INTO bat_listings SELECT * FROM jsonb_populate_record(NULL::bat_listings, v_row.row_data) ON CONFLICT DO NOTHING;
        WHEN 'comment_discoveries' THEN
          INSERT INTO comment_discoveries SELECT * FROM jsonb_populate_record(NULL::comment_discoveries, v_row.row_data) ON CONFLICT DO NOTHING;
        WHEN 'description_discoveries' THEN
          INSERT INTO description_discoveries SELECT * FROM jsonb_populate_record(NULL::description_discoveries, v_row.row_data) ON CONFLICT DO NOTHING;
        ELSE
          NULL;
      END CASE;
      UPDATE merge_deleted_rows SET restored_at = NOW() WHERE id = v_row.id;
      v_archived_restored := v_archived_restored + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to restore archived row % from %: %', v_row.row_id, v_row.source_table, SQLERRM;
    END;
  END LOOP;

  -- 2b. Survivor columns the merge filled from the duplicate, while they still hold the filled value.
  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(COALESCE(v_journal -> 'survivor_filled', '{}'::jsonb)) LOOP
    CONTINUE WHEN NOT (v_key = ANY (c_filled_columns));
    EXECUTE format('UPDATE vehicles SET %1$I = NULL WHERE id = $1 AND to_jsonb(%1$I) = $2', v_key) USING v_primary_id, v_val;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_reverted := v_reverted || jsonb_build_object(v_key, v_val); END IF;
  END LOOP;

  -- 2c. A live vehicle holding the duplicate's listing_url keeps it; the duplicate's copy is parked in the journal.
  SELECT listing_url INTO v_dup_listing FROM vehicles WHERE id = v_dup_id;
  IF nullif(v_dup_listing, '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM vehicles WHERE listing_url = v_dup_listing AND deleted_at IS NULL AND id <> v_dup_id) THEN
    UPDATE vehicles SET listing_url = NULL WHERE id = v_dup_id;
    v_parked := v_dup_listing;
  END IF;

  -- 3. Restore the duplicate.
  UPDATE vehicles SET status = COALESCE(v_proposal.pre_merge_dup_status, 'active'), merged_into_vehicle_id = NULL, deleted_at = NULL WHERE id = v_dup_id;

  -- 4. image_count on both vehicles.
  UPDATE vehicles v
     SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE v.id IN (v_primary_id, v_dup_id);

  -- 5. Proposal status (with what the unmerge changed), and the merge_proposals row that was executed for this pair.
  UPDATE vehicle_merge_proposals
     SET status = 'unmerged', unmerged_at = NOW(), unmerged_by = auth.uid(),
         merge_journal = v_journal || jsonb_build_object('unmerge', jsonb_build_object(
           'at', NOW(), 'reason', p_reason, 'survivor_reverted', v_reverted, 'dup_listing_url_parked', v_parked))
   WHERE id = p_proposal_id;

  UPDATE merge_proposals mp
     SET status = 'unmerged',
         evidence = COALESCE(mp.evidence, '{}'::jsonb) || jsonb_build_object('unmerge', jsonb_build_object(
           'at', NOW(), 'reason', p_reason, 'vehicle_merge_proposal_id', p_proposal_id, 'by', auth.uid()))
   WHERE mp.status = 'executed'
     AND ((mp.vehicle_a_id = v_primary_id AND mp.vehicle_b_id = v_dup_id) OR (mp.vehicle_a_id = v_dup_id AND mp.vehicle_b_id = v_primary_id));
  GET DIAGNOSTICS v_mp_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'dup_vehicle_id', v_dup_id,
    'primary_vehicle_id', v_primary_id,
    'images_returned', v_images_returned,
    'observations_returned', v_observations_returned,
    'observations_unsuperseded', v_unsuperseded,
    'events_returned', v_events_returned,
    'comments_returned', v_comments_returned,
    'obs_disc_returned', v_obs_disc_returned,
    'vehicle_events_returned', v_vehicle_events_returned,
    'timeline_events_returned', v_timeline_returned,
    'archived_restored', v_archived_restored,
    'merge_proposals_reopened', v_mp_rows,
    'survivor_reverted', v_reverted,
    'dup_listing_url_parked', v_parked
  );
END;
$function$;

-- 4. propose_listing_vin_merge: attribute the proposal to the declared writer.
CREATE OR REPLACE FUNCTION public.propose_listing_vin_merge(p_holder uuid, p_listed uuid, p_vin text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vin text := upper(regexp_replace(coalesce(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  v_id uuid;
  v_holder_url text;
  v_listing record;
BEGIN
  IF p_holder IS NULL OR p_listed IS NULL OR p_holder = p_listed OR length(v_vin) < 8 THEN
    RAISE EXCEPTION 'need two different vehicles and a VIN of at least 8 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_holder AND upper(vin) = v_vin) THEN
    RAISE EXCEPTION 'vehicle % does not hold VIN %', p_holder, v_vin USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM merge_proposals
              WHERE (vehicle_a_id = p_holder AND vehicle_b_id = p_listed) OR (vehicle_a_id = p_listed AND vehicle_b_id = p_holder)) THEN
    RETURN NULL;
  END IF;
  SELECT source_url INTO v_holder_url FROM vehicle_events WHERE vehicle_id = p_holder AND source_url IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT source_platform, source_listing_id, source_url INTO v_listing FROM vehicle_events
   WHERE vehicle_id = p_listed AND source_url IS NOT NULL ORDER BY created_at LIMIT 1;
  INSERT INTO merge_proposals (vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence, ai_reasoning, preferred_primary,
                               status, match_tier, confidence, ai_verified, proposed_by, evidence)
  VALUES (p_holder, p_listed, 'listing_vin_match', 'REVIEW', 0.9,
          format('A listing''s seller-typed VIN %s is the VIN vehicle A already holds. Same car, two records.', v_vin),
          'A', 'pending', 1, 0.9, false, coalesce(nullif(btrim(current_setting('app.writer', true)), ''), 'extract-ebay-motors'),
          jsonb_build_object('vin', v_vin, 'basis', 'seller-typed VIN on the listing equals the VIN held by vehicle a',
                             'listing_platform', v_listing.source_platform, 'listing_id', v_listing.source_listing_id, 'listing_url', v_listing.source_url,
                             'holder_url', v_holder_url, 'note', p_note))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The live grants, stated (merge_into_primary_batch loses its PUBLIC execute: its caller is the dedup script, as postgres).
REVOKE ALL ON FUNCTION public.correct_vehicle_vin(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_vin(uuid, text, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.merge_into_primary_batch(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_into_primary_batch(uuid[], uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.unmerge_vehicle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmerge_vehicle(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.propose_listing_vin_merge(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_listing_vin_merge(uuid, uuid, text, text) TO service_role;

COMMIT;

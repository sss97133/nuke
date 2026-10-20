-- Gate 2 of both merges reads every ownership signal, not user_id alone.
--
-- Found 2026-10-20 by the image and vehicle-record rebuild lane: merge_into_primary and merge_into_primary_batch refuse an
-- owned vehicle without an approved, reviewed vehicle_merge_proposals row, but "owned" was vehicles.user_id alone. Live vehicles
-- (not merged, not deleted): 104 carry user_id, 126 more are owned through owner_id with user_id NULL, so a merge of those would
-- have run with no approval; 6 of 17 drafted merge pairs of the owner's own fleet had both rows with user_id NULL.
-- Audit of my own runs, 2026-10-19 21:00 PT onward: 10,557 merges by dedup-worker, none of the 20,000+ rows involved carried
-- user_id, owner_id, uploaded_by, ownership_verified or a vehicle_user_permissions row, so none was owned by any of those signals
-- (13 carried system-folded auction_sale ownership periods on the survivor, created after the merge).
-- Change: owned is user_id, owner_id or uploaded_by set, or an active vehicle_user_permissions row with role owner or co_owner.
-- Everything else in both functions is the live body. A vehicle whose only ownership trace is a photo album or a money row, with
-- no owner column set, is still invisible to this gate; that needs custody recorded first (record_garage_owner_correction).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.merge_into_primary(primary_id uuid, dup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dup_status TEXT;
  v_proposal_id UUID;
  v_journal JSONB := '{}'::jsonb;
  v_ids UUID[];
  v_left UUID[];
  v_sup JSONB;
  n_images INT := 0; n_obs INT := 0; n_auction_events INT := 0; n_comments INT := 0; n_obs_disc INT := 0;
  n_vehicle_events INT := 0; n_timeline INT := 0; n_obs_superseded INT := 0;
BEGIN
  -- Guard: skip if same ID or already merged
  IF primary_id = dup_id THEN
    RETURN jsonb_build_object('skipped', 'same_id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = primary_id AND (status IS DISTINCT FROM 'merged')) THEN
    RETURN jsonb_build_object('skipped', 'primary_not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = dup_id AND (status IS DISTINCT FROM 'merged')) THEN
    RETURN jsonb_build_object('skipped', 'dup_already_merged');
  END IF;

  -- Gate 2 (2026-07-08): NEVER auto-merge an OWNED vehicle without owner-approval evidence. Owned is user_id, owner_id or uploaded_by
  -- set, or an active owner / co_owner permission (2026-10-20: 126 live vehicles were owned through owner_id alone and passed).
  IF EXISTS (SELECT 1 FROM vehicles WHERE id IN (primary_id, dup_id) AND (user_id IS NOT NULL OR owner_id IS NOT NULL OR uploaded_by IS NOT NULL))
     OR EXISTS (SELECT 1 FROM vehicle_user_permissions WHERE vehicle_id IN (primary_id, dup_id) AND is_active AND role IN ('owner', 'co_owner')) THEN
    IF NOT EXISTS (
      SELECT 1 FROM vehicle_merge_proposals
      WHERE ((primary_vehicle_id = primary_id AND duplicate_vehicle_id = dup_id)
          OR (primary_vehicle_id = dup_id AND duplicate_vehicle_id = primary_id))
        AND status = 'approved' AND reviewed_by IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('skipped', 'owned_requires_approval', 'primary', primary_id, 'dup', dup_id);
    END IF;
  END IF;

  -- Two different VINs are two vehicles, whatever URL they share: never merged here (the rule merge_into_primary_batch
  -- already enforces; 49 single-pair merges since 2026-10-17 joined two 11+ character VINs and wait for unmerge review).
  IF EXISTS (
    SELECT 1 FROM vehicles p, vehicles d
     WHERE p.id = primary_id AND d.id = dup_id
       AND length(btrim(p.vin)) >= 11 AND length(btrim(d.vin)) >= 11
       AND upper(btrim(p.vin)) <> upper(btrim(d.vin))
  ) THEN
    RETURN jsonb_build_object('skipped', 'vin_conflict', 'primary', primary_id, 'dup', dup_id);
  END IF;

  SELECT status INTO v_dup_status FROM vehicles WHERE id = dup_id;

  SELECT id INTO v_proposal_id
  FROM vehicle_merge_proposals
  WHERE primary_vehicle_id = primary_id AND duplicate_vehicle_id = dup_id
  LIMIT 1;

  IF v_proposal_id IS NULL THEN
    INSERT INTO vehicle_merge_proposals (
      primary_vehicle_id, duplicate_vehicle_id,
      match_type, confidence_score, status, detected_by, detected_at
    ) VALUES (
      primary_id, dup_id,
      'exact_listing_url', 100, 'merged', 'dedup-worker', NOW()
    )
    ON CONFLICT (primary_vehicle_id, duplicate_vehicle_id) DO UPDATE
      SET status = 'merged', merged_at = NOW()
    RETURNING id INTO v_proposal_id;
  END IF;

  -- 1. vehicle_images. A photo whose (vehicle_id, file_hash) the primary already holds stays on the duplicate.
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
           SELECT 1 FROM vehicle_images p WHERE p.vehicle_id = primary_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false))),
         array_agg(d.id) FILTER (WHERE d.file_hash IS NOT NULL AND COALESCE(d.is_superseded, false) = false AND EXISTS (
           SELECT 1 FROM vehicle_images p WHERE p.vehicle_id = primary_id AND p.file_hash = d.file_hash AND COALESCE(p.is_superseded, false) = false))
    INTO v_ids, v_left
  FROM vehicle_images d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('images_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'images_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE vehicle_images SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_images = ROW_COUNT;

  -- 2. vehicle_observations: testimony. A duplicate observation that shares (source_id, source_identifier, kind) with one the
  --    primary holds is SUPERSEDED by it (and still moved); nothing is deleted.
  WITH hits AS (
    SELECT d.id,
           (SELECT p.id FROM vehicle_observations p
             WHERE p.vehicle_id = primary_id AND p.source_id = d.source_id
               AND p.source_identifier = d.source_identifier AND p.kind = d.kind
             ORDER BY p.observed_at DESC NULLS LAST, p.id LIMIT 1) AS by_id
    FROM vehicle_observations d
    WHERE d.vehicle_id = dup_id AND d.is_superseded IS NOT TRUE
  ), sup AS (
    UPDATE vehicle_observations o
       SET is_superseded = true, superseded_by = h.by_id, superseded_at = now()
      FROM hits h
     WHERE o.id = h.id AND h.by_id IS NOT NULL
    RETURNING o.id, h.by_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'by', by_id)), '[]'::jsonb), count(*) INTO v_sup, n_obs_superseded FROM sup;
  -- Protected rows stay on the duplicate, as in merge_into_primary_batch: guard_retained_vin_observation and
  --    validate_retained_listing_property_source refuse to move them (they are re-derived on the survivor).
  SELECT array_agg(id) FILTER (WHERE source_vin IS NULL
           AND source_vin_taxonomy_revision_id IS NULL
           AND extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
           AND source_vehicle_event_id IS NULL
           AND source_observation_id IS NULL
           AND source_comment_id IS NULL
           AND source_snapshot_id IS NULL),
         array_agg(id) FILTER (WHERE NOT (source_vin IS NULL
           AND source_vin_taxonomy_revision_id IS NULL
           AND extraction_method IS DISTINCT FROM 'protected_retained_vin_reference_v1'
           AND source_vehicle_event_id IS NULL
           AND source_observation_id IS NULL
           AND source_comment_id IS NULL
           AND source_snapshot_id IS NULL))
    INTO v_ids, v_left
  FROM vehicle_observations WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('observations_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'observations_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb),
                                               'observations_superseded', v_sup);
  UPDATE vehicle_observations SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_obs = ROW_COUNT;

  -- 3. auction_events. An event whose (vehicle_id, source_url) the primary already holds stays on the duplicate.
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM auction_events p WHERE p.vehicle_id = primary_id AND p.source_url = d.source_url))),
         array_agg(d.id) FILTER (WHERE d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM auction_events p WHERE p.vehicle_id = primary_id AND p.source_url = d.source_url))
    INTO v_ids, v_left
  FROM auction_events d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('events_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'events_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE auction_events SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_auction_events = ROW_COUNT;

  -- 4. auction_comments. auction_comments has no supersession columns and a unique (vehicle_id, content_hash): a comment whose
  --    content_hash the primary already holds is the same comment; it stays on the duplicate (kept, not deleted).
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.content_hash IS NOT NULL AND EXISTS (SELECT 1 FROM auction_comments p WHERE p.vehicle_id = primary_id AND p.content_hash = d.content_hash))),
         array_agg(d.id) FILTER (WHERE d.content_hash IS NOT NULL AND EXISTS (SELECT 1 FROM auction_comments p WHERE p.vehicle_id = primary_id AND p.content_hash = d.content_hash))
    INTO v_ids, v_left
  FROM auction_comments d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('comments_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'comments_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE auction_comments SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_comments = ROW_COUNT;

  -- 5. observation_discoveries: no unique key; move all.
  SELECT array_agg(id) INTO v_ids FROM observation_discoveries WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('obs_disc_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));
  UPDATE observation_discoveries SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_obs_disc = ROW_COUNT;

  -- 6. vehicle_events (listing episodes). An episode whose listing key the primary already holds stays on the duplicate.
  SELECT array_agg(d.id) FILTER (WHERE NOT (
           (d.source_listing_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_listing_id = d.source_listing_id))
        OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_url = d.source_url AND p.source_listing_id IS NULL)))),
         array_agg(d.id) FILTER (WHERE
           (d.source_listing_id IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_listing_id = d.source_listing_id))
        OR (d.source_listing_id IS NULL AND d.source_url IS NOT NULL AND EXISTS (SELECT 1 FROM vehicle_events p WHERE p.vehicle_id = primary_id AND p.source_platform = d.source_platform AND p.source_url = d.source_url AND p.source_listing_id IS NULL)))
    INTO v_ids, v_left
  FROM vehicle_events d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('vehicle_events_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'vehicle_events_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE vehicle_events SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_vehicle_events = ROW_COUNT;

  -- 7. timeline_events. A photo-session day the primary already has (idx_timeline_events_one_photo_session_per_day) stays.
  SELECT array_agg(d.id) FILTER (WHERE NOT (d.event_type IN ('photo_session', 'batch_image_upload') AND EXISTS (
           SELECT 1 FROM timeline_events p WHERE p.vehicle_id = primary_id AND p.event_type IN ('photo_session', 'batch_image_upload')
             AND p.event_date IS NOT DISTINCT FROM d.event_date AND COALESCE(p.user_id::text, 'system') = COALESCE(d.user_id::text, 'system')))),
         array_agg(d.id) FILTER (WHERE d.event_type IN ('photo_session', 'batch_image_upload') AND EXISTS (
           SELECT 1 FROM timeline_events p WHERE p.vehicle_id = primary_id AND p.event_type IN ('photo_session', 'batch_image_upload')
             AND p.event_date IS NOT DISTINCT FROM d.event_date AND COALESCE(p.user_id::text, 'system') = COALESCE(d.user_id::text, 'system')))
    INTO v_ids, v_left
  FROM timeline_events d WHERE d.vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('timeline_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
                                               'timeline_left_ids', COALESCE(to_jsonb(v_left), '[]'::jsonb));
  UPDATE timeline_events SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id WHERE id = ANY (COALESCE(v_ids, '{}'));
  GET DIAGNOSTICS n_timeline = ROW_COUNT;

  -- 8. bat_listings, comment_discoveries, description_discoveries: unique per vehicle and not stamped, so they are neither moved nor
  --    deleted: they stay on the soft-deleted duplicate (.claude/rules/db-safety.md lists them as testimony; the old merge archived
  --    then deleted them). Counts go in the journal.
  v_journal := v_journal || jsonb_build_object(
    'bat_left_count', (SELECT count(*) FROM bat_listings WHERE vehicle_id = dup_id),
    'comment_disc_left_count', (SELECT count(*) FROM comment_discoveries WHERE vehicle_id = dup_id),
    'desc_disc_left_count', (SELECT count(*) FROM description_discoveries WHERE vehicle_id = dup_id));

  -- 11. Soft-delete the duplicate; its photos are on the primary now (or stayed by file_hash, counted as duplicates).
  UPDATE vehicles SET merged_into_vehicle_id = primary_id, status = 'merged', deleted_at = NOW(),
         image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = dup_id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE id = dup_id;

  -- 12. image_count on the primary, only when a photo moved (the row trigger recounts the new vehicle only).
  IF n_images > 0 THEN
    UPDATE vehicles v
       SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
     WHERE v.id = primary_id;
  END IF;

  -- 13. Journal.
  UPDATE vehicle_merge_proposals
     SET status = 'merged', merged_at = NOW(), merge_journal = v_journal, pre_merge_dup_status = v_dup_status
   WHERE id = v_proposal_id;

  RETURN jsonb_build_object(
    'proposal_id', v_proposal_id,
    'images_moved', n_images,
    'observations_moved', n_obs,
    'observations_superseded', n_obs_superseded,
    'events_moved', n_auction_events,
    'comments_moved', n_comments,
    'obs_disc_moved', n_obs_disc,
    'vehicle_events_moved', n_vehicle_events,
    'timeline_events_moved', n_timeline,
    'bat_left', (v_journal->>'bat_left_count')::int,
    'comment_disc_left', (v_journal->>'comment_disc_left_count')::int,
    'desc_disc_left', (v_journal->>'desc_disc_left_count')::int
  );
END;
$function$;

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

  -- Filter valid pairs + enforce Gate 2 + SKIP LOCKED so concurrent maintenance jobs never block us.
  -- Owned = user_id, owner_id or uploaded_by set, or an active owner / co_owner permission (see merge_into_primary).
  WITH locked_p AS (
    SELECT id, status, user_id, owner_id, uploaded_by, vin
    FROM vehicles
    WHERE id = ANY(primary_ids) AND (status IS DISTINCT FROM 'merged') AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  ),
  locked_d AS (
    SELECT id, status, user_id, owner_id, uploaded_by, vin
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
      (vp.user_id IS NULL AND vp.owner_id IS NULL AND vp.uploaded_by IS NULL
       AND vd.user_id IS NULL AND vd.owner_id IS NULL AND vd.uploaded_by IS NULL
       AND NOT EXISTS (SELECT 1 FROM vehicle_user_permissions x
                        WHERE x.vehicle_id IN (t.p, t.d) AND x.is_active AND x.role IN ('owner', 'co_owner')))
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
     )
     -- A photo with no file_hash is still the same photo when the survivor already holds its source image_url (a re-posted
     -- listing re-uses its photos), or when a sibling duplicate in this batch with a smaller id carries it: it stays on the
     -- duplicate, kept, like a file_hash collision (2026-10-20: five Craigslist re-posts of one car would otherwise leave
     -- the survivor with five copies of each of its 20 photos).
     AND NOT (
       d.file_hash IS NULL AND COALESCE(d.image_url, '') <> '' AND COALESCE(d.is_superseded, false) = false
       AND (
         EXISTS (
           SELECT 1 FROM vehicle_images p
           WHERE p.vehicle_id = bmp.primary_id AND p.image_url = d.image_url AND COALESCE(p.is_superseded, false) = false
         )
         OR EXISTS (
           SELECT 1 FROM _batch_merge_pairs b2
           JOIN vehicle_images d2 ON d2.vehicle_id = b2.dup_id
           WHERE b2.primary_id = bmp.primary_id AND b2.dup_id <> bmp.dup_id
             AND d2.image_url = d.image_url AND d2.file_hash IS NULL AND COALESCE(d2.is_superseded, false) = false
             AND d2.id < d.id
         )
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

  -- discovery_url is filled only on a primary that has none: naming it in the UPDATE above fired
  -- vehicles_canonicalize_discovery_url on every primary, which rewrote a www. URL onto the duplicate's
  -- canonical URL and failed vehicles_discovery_url_unique (Gooding/B-J www pairs, 2026-10-19).
  UPDATE vehicles vp
     SET discovery_url = CASE
           WHEN vd.discovery_url IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM vehicles v2 WHERE v2.discovery_url = vd.discovery_url AND v2.id <> vp.id
           ) THEN vd.discovery_url
           ELSE NULL
         END
    FROM _batch_merge_pairs bmp
    JOIN vehicles vd ON vd.id = bmp.dup_id
   WHERE vp.id = ANY(v_primaries) AND vp.id = bmp.primary_id AND vp.discovery_url IS NULL;

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

REVOKE ALL ON FUNCTION public.merge_into_primary(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_into_primary_batch(uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_into_primary_batch(uuid[], uuid[]) TO service_role;

COMMIT;

-- Merges carry the duplicate's VIN; the single-pair merge leaves protected observations where the batch does.
-- Measured 2026-10-19 21:10–21:40 PT on 20 live cross-URL pairs (a.listing_url = b.discovery_url, both live), every run
-- rolled back; receipts in ~/nuke-logs/dedup-perf-20261019/ (private).
--  1. merge_into_primary_batch raised on 10 of 20 pairs at its VIN carry (its step 11): enforce_vin_uniqueness() counted
--     every vehicles row, including the duplicate the batch had just soft-deleted (status 'merged'), so any VIN of 11+
--     characters the survivor lacked raised "already exists on vehicle <the duplicate>". The partial unique indexes
--     vehicles_vin_unique_17char_v2 and vehicles_vin_unique_short_v2 already exclude status 'merged'; the trigger now
--     agrees (20261019030000 assumed it already did). The 4 carries that passed were serials under 11 characters, which
--     the trigger does not check.
--  2. merge_into_primary (single pair) raised on 2 of 20 pairs: it moved every vehicle_observations row, and
--     guard_retained_vin_observation refuses a protected retained VIN reference. It now leaves the rows the batch leaves
--     (source_vin, taxonomy revision, protected extraction method, source event / observation / comment / snapshot) and
--     journals them as observations_left_ids. It also refuses a pair whose two VINs (11+ characters) differ, as the batch does:
--     51 merged pairs since 2026-10-17 hold two different VINs, 49 of them through the single-pair function.
--  3. Where the single-pair time goes (18 merges): p50 253 ms, mean 322 ms, range 67–845 ms, proportional to the rows
--     moved. vehicle_images 92 ms avg (33 row triggers), vehicle_observations 47 ms, timeline_events 20 ms avg
--     (auto_update_primary_focus_on_timeline_events 325 ms warm, 8.2 s cold on one pair), the two vehicles updates
--     23 ms together. The vehicles updates were not the cost; this migration only folds the duplicate's image_count into
--     its soft-delete and recounts the primary only when a photo moved. The child-table triggers are left alone.
-- merge_into_primary_batch itself is unchanged (repo 20261020011000 matches live byte for byte).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

-- 1. enforce_vin_uniqueness: a merged-away row is not a live holder.
CREATE OR REPLACE FUNCTION public.enforce_vin_uniqueness()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
  DECLARE
    v_norm text;
    v_existing uuid;
    v_classic_serial boolean;
  BEGIN
    IF NEW.vin IS NULL OR length(trim(NEW.vin)) < 11 THEN
      RETURN NEW;
    END IF;

    -- A merged-away row (status 'merged') owns no VIN: the partial unique indexes vehicles_vin_unique_17char_v2 and
    -- vehicles_vin_unique_short_v2 already exclude it, and merge_into_primary_batch carries its VIN to the survivor.
    v_norm := upper(trim(NEW.vin));
    v_classic_serial := length(v_norm) < 17
      AND NEW.profile_origin = 'device_evidence'
      AND NEW.origin_metadata -> 'device_evidence' ->> 'basis' IN ('serial_album', 'capture_session');

    IF v_classic_serial THEN
      SELECT id INTO v_existing
        FROM public.vehicles
       WHERE upper(trim(vin)) = v_norm
         AND upper(public.normalize_make(make)) = upper(public.normalize_make(NEW.make))
         AND id <> NEW.id
         AND status IS DISTINCT FROM 'merged'
       LIMIT 1;
    ELSE
      SELECT id INTO v_existing
        FROM public.vehicles
       WHERE upper(trim(vin)) = v_norm
         AND id <> NEW.id
         AND status IS DISTINCT FROM 'merged'
       LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'VIN or chassis identifier % already exists on vehicle %', v_norm, v_existing
        USING ERRCODE = 'unique_violation',
              HINT = 'Attach observations to the existing vehicle via the sanctioned identity path.';
    END IF;
    RETURN NEW;
  END;
  $function$;

-- 2. merge_into_primary: protected observations stay; one vehicles update per row touched.
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

  -- Gate 2 (2026-07-08): NEVER auto-merge an OWNED vehicle without owner-approval evidence.
  IF EXISTS (SELECT 1 FROM vehicles WHERE id IN (primary_id, dup_id) AND user_id IS NOT NULL) THEN
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

COMMIT;

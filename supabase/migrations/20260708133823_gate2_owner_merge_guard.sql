-- Gate 2: owner-approval guard at merge execution point (merge_into_primary). Only the guard block added.
CREATE OR REPLACE FUNCTION public.merge_into_primary(primary_id uuid, dup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_images_moved INT := 0;
  v_comments_moved INT := 0;
  v_observations_moved INT := 0;
  v_events_moved INT := 0;
  v_bat_deleted INT := 0;
  v_comment_disc_deleted INT := 0;
  v_desc_disc_deleted INT := 0;
  v_obs_disc_moved INT := 0;
  v_dup_status TEXT;
  v_proposal_id UUID;
  v_journal JSONB := '{}'::jsonb;
  v_row RECORD;
  v_ids UUID[];
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
  -- If either side has vehicles.user_id set, require an APPROVED + REVIEWED vehicle_merge_proposals
  -- row for this exact pair. Protects Skylar's own vehicles from dedup-worker/cron auto-merge.
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

  -- Capture dup's pre-merge status
  SELECT status INTO v_dup_status FROM vehicles WHERE id = dup_id;

  -- Find or create proposal record (dedup worker may have already created one)
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

  -- -----------------------------------------------------------------------
  -- 1. vehicle_images: capture IDs, stamp provenance, re-point
  -- -----------------------------------------------------------------------
  SELECT array_agg(id) INTO v_ids FROM vehicle_images WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('images_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));

  UPDATE vehicle_images
  SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id
  WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_images_moved = ROW_COUNT;

  -- -----------------------------------------------------------------------
  -- 2. vehicle_observations: archive collisions, stamp + re-point remainder
  -- -----------------------------------------------------------------------
  -- Archive collision rows before deleting
  FOR v_row IN
    SELECT vo_dup.*
    FROM vehicle_observations vo_dup
    WHERE vo_dup.vehicle_id = dup_id
      AND EXISTS (
        SELECT 1 FROM vehicle_observations vo_pri
        WHERE vo_pri.vehicle_id = primary_id
          AND vo_pri.source_id = vo_dup.source_id
          AND vo_pri.source_identifier = vo_dup.source_identifier
          AND vo_pri.kind = vo_dup.kind
      )
  LOOP
    INSERT INTO merge_deleted_rows (proposal_id, source_table, row_id, row_data)
    VALUES (v_proposal_id, 'vehicle_observations', v_row.id, to_jsonb(v_row));
  END LOOP;

  DELETE FROM vehicle_observations vo_dup
  WHERE vo_dup.vehicle_id = dup_id
    AND EXISTS (
      SELECT 1 FROM vehicle_observations vo_pri
      WHERE vo_pri.vehicle_id = primary_id
        AND vo_pri.source_id = vo_dup.source_id
        AND vo_pri.source_identifier = vo_dup.source_identifier
        AND vo_pri.kind = vo_dup.kind
    );

  SELECT array_agg(id) INTO v_ids FROM vehicle_observations WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('observations_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));

  UPDATE vehicle_observations
  SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id
  WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_observations_moved = ROW_COUNT;

  -- -----------------------------------------------------------------------
  -- 3. auction_events: capture IDs, stamp, re-point
  -- -----------------------------------------------------------------------
  SELECT array_agg(id) INTO v_ids FROM auction_events WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('events_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));

  UPDATE auction_events
  SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id
  WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_events_moved = ROW_COUNT;

  -- -----------------------------------------------------------------------
  -- 4. auction_comments: archive collisions, stamp + re-point remainder
  -- -----------------------------------------------------------------------
  FOR v_row IN
    SELECT ac_dup.*
    FROM auction_comments ac_dup
    WHERE ac_dup.vehicle_id = dup_id
      AND ac_dup.content_hash IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM auction_comments ac_pri
        WHERE ac_pri.vehicle_id = primary_id
          AND ac_pri.content_hash = ac_dup.content_hash
      )
  LOOP
    INSERT INTO merge_deleted_rows (proposal_id, source_table, row_id, row_data)
    VALUES (v_proposal_id, 'auction_comments', v_row.id, to_jsonb(v_row));
  END LOOP;

  DELETE FROM auction_comments ac_dup
  WHERE ac_dup.vehicle_id = dup_id
    AND ac_dup.content_hash IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auction_comments ac_pri
      WHERE ac_pri.vehicle_id = primary_id
        AND ac_pri.content_hash = ac_dup.content_hash
    );

  SELECT array_agg(id) INTO v_ids FROM auction_comments WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('comments_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));

  UPDATE auction_comments
  SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id
  WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_comments_moved = ROW_COUNT;

  -- -----------------------------------------------------------------------
  -- 5. bat_listings: archive before deleting (unique on bat_listing_url)
  -- -----------------------------------------------------------------------
  FOR v_row IN SELECT * FROM bat_listings WHERE vehicle_id = dup_id
  LOOP
    INSERT INTO merge_deleted_rows (proposal_id, source_table, row_id, row_data)
    VALUES (v_proposal_id, 'bat_listings', v_row.id, to_jsonb(v_row));
  END LOOP;
  DELETE FROM bat_listings WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_bat_deleted = ROW_COUNT;

  v_journal := v_journal || jsonb_build_object('bat_deleted_count', v_bat_deleted);

  -- -----------------------------------------------------------------------
  -- 6. comment_discoveries: archive before deleting (unique on vehicle_id)
  -- -----------------------------------------------------------------------
  FOR v_row IN SELECT * FROM comment_discoveries WHERE vehicle_id = dup_id
  LOOP
    INSERT INTO merge_deleted_rows (proposal_id, source_table, row_id, row_data)
    VALUES (v_proposal_id, 'comment_discoveries', v_row.id, to_jsonb(v_row));
  END LOOP;
  DELETE FROM comment_discoveries WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_comment_disc_deleted = ROW_COUNT;

  v_journal := v_journal || jsonb_build_object('comment_disc_deleted_count', v_comment_disc_deleted);

  -- -----------------------------------------------------------------------
  -- 7. description_discoveries: archive before deleting (unique on vehicle_id)
  -- -----------------------------------------------------------------------
  FOR v_row IN SELECT * FROM description_discoveries WHERE vehicle_id = dup_id
  LOOP
    INSERT INTO merge_deleted_rows (proposal_id, source_table, row_id, row_data)
    VALUES (v_proposal_id, 'description_discoveries', v_row.id, to_jsonb(v_row));
  END LOOP;
  DELETE FROM description_discoveries WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_desc_disc_deleted = ROW_COUNT;

  v_journal := v_journal || jsonb_build_object('desc_disc_deleted_count', v_desc_disc_deleted);

  -- -----------------------------------------------------------------------
  -- 8. observation_discoveries: capture IDs, stamp, re-point
  -- -----------------------------------------------------------------------
  SELECT array_agg(id) INTO v_ids FROM observation_discoveries WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('obs_disc_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));

  UPDATE observation_discoveries
  SET vehicle_id = primary_id, merged_from_vehicle_id = dup_id
  WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_obs_disc_moved = ROW_COUNT;

  -- -----------------------------------------------------------------------
  -- 9. Soft-delete the duplicate
  -- -----------------------------------------------------------------------
  UPDATE vehicles
  SET merged_into_vehicle_id = primary_id,
      status = 'merged',
      deleted_at = NOW()
  WHERE id = dup_id;

  -- -----------------------------------------------------------------------
  -- 10. Write journal + update proposal
  -- -----------------------------------------------------------------------
  UPDATE vehicle_merge_proposals
  SET status = 'merged',
      merged_at = NOW(),
      merge_journal = v_journal,
      pre_merge_dup_status = v_dup_status
  WHERE id = v_proposal_id;

  RETURN jsonb_build_object(
    'proposal_id', v_proposal_id,
    'images_moved', v_images_moved,
    'comments_moved', v_comments_moved,
    'observations_moved', v_observations_moved,
    'events_moved', v_events_moved,
    'bat_deleted', v_bat_deleted,
    'comment_disc_deleted', v_comment_disc_deleted,
    'desc_disc_deleted', v_desc_disc_deleted,
    'obs_disc_moved', v_obs_disc_moved
  );
END;
$function$



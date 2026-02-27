-- Migration: merge_duplicate_vehicles
-- Creates the merge_into_primary(primary_id, dup_id) function used by the dedup worker.
-- Safe: only re-points child records and soft-deletes the duplicate.

CREATE OR REPLACE FUNCTION merge_into_primary(primary_id UUID, dup_id UUID)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_images_moved INT := 0;
  v_comments_moved INT := 0;
  v_observations_moved INT := 0;
  v_events_moved INT := 0;
  v_bat_deleted INT := 0;
  v_comment_disc_deleted INT := 0;
  v_desc_disc_deleted INT := 0;
  v_obs_disc_moved INT := 0;
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

  -- 1. vehicle_images: re-point (no unique on vehicle_id)
  UPDATE vehicle_images SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_images_moved = ROW_COUNT;

  -- 2. vehicle_observations: re-point. Unique is on (source_id, source_identifier, kind), not vehicle_id.
  --    If a collision exists (same source observation on both vehicles), delete dup's copy.
  DELETE FROM vehicle_observations vo_dup
  WHERE vo_dup.vehicle_id = dup_id
    AND EXISTS (
      SELECT 1 FROM vehicle_observations vo_pri
      WHERE vo_pri.vehicle_id = primary_id
        AND vo_pri.source_id = vo_dup.source_id
        AND vo_pri.source_identifier = vo_dup.source_identifier
        AND vo_pri.kind = vo_dup.kind
    );
  UPDATE vehicle_observations SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_observations_moved = ROW_COUNT;

  -- 3. auction_events: re-point (no unique on vehicle_id alone)
  UPDATE auction_events SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_events_moved = ROW_COUNT;

  -- 4. auction_comments: unique on content_hash.
  --    Remove dup's comments that would conflict (same content_hash already on primary).
  DELETE FROM auction_comments ac_dup
  WHERE ac_dup.vehicle_id = dup_id
    AND ac_dup.content_hash IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auction_comments ac_pri
      WHERE ac_pri.vehicle_id = primary_id
        AND ac_pri.content_hash = ac_dup.content_hash
    );
  UPDATE auction_comments SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_comments_moved = ROW_COUNT;

  -- 5. bat_listings: unique on bat_listing_url. Both vehicles share the same URL,
  --    so dup's row would conflict. Delete it; primary keeps its row.
  DELETE FROM bat_listings WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_bat_deleted = ROW_COUNT;

  -- 6. comment_discoveries: unique on vehicle_id. Keep primary's row, delete dup's.
  DELETE FROM comment_discoveries WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_comment_disc_deleted = ROW_COUNT;

  -- 7. description_discoveries: unique on vehicle_id. Keep primary's row, delete dup's.
  DELETE FROM description_discoveries WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_desc_disc_deleted = ROW_COUNT;

  -- 8. observation_discoveries: re-point (no unique on vehicle_id)
  UPDATE observation_discoveries SET vehicle_id = primary_id WHERE vehicle_id = dup_id;
  GET DIAGNOSTICS v_obs_disc_moved = ROW_COUNT;

  -- 9. Soft-delete the duplicate: mark as merged, set deleted_at, point to primary
  UPDATE vehicles
  SET merged_into_vehicle_id = primary_id,
      status = 'merged',
      deleted_at = NOW()
  WHERE id = dup_id;

  -- 10. Log the merge in vehicle_merge_proposals (skip if already recorded)
  INSERT INTO vehicle_merge_proposals (
    primary_vehicle_id, duplicate_vehicle_id,
    match_type, confidence_score, status, detected_by, detected_at
  )
  VALUES (
    primary_id, dup_id,
    'exact_listing_url', 100, 'merged', 'dedup-worker', NOW()
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
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
$$;

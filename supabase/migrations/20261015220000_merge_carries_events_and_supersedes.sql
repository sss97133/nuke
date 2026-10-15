-- merge_into_primary / unmerge_vehicle: carry listing episodes and the timeline, supersede instead of delete, recount, close the loop.
--
-- Found in the 2026-10-15 merge review (~/nuke-logs/merge-review-20261015.md). merge_into_primary(primary, dup):
--   1. left vehicle_events and timeline_events on the soft-deleted duplicate, so the primary's page lost the duplicate's listing
--      episodes and timeline, and nothing stamped them for an undo;
--   2. DELETED colliding vehicle_observations and auction_comments (copying them to merge_deleted_rows). Observations are
--      testimony and are superseded, never deleted. A "collision" there is the same (source_id, source_identifier, kind) with a
--      different content_hash (unique_observation includes content_hash and not vehicle_id), i.e. a revision, not a duplicate;
--   3. aborted the whole merge when a moved row hit a per-vehicle unique key it shares with the primary (auction_events
--      (vehicle_id, source_url), vehicle_images (vehicle_id, file_hash), vehicle_events listing keys, timeline photo sessions);
--   4. left vehicles.image_count stale after moving photos (the row trigger recounts the new vehicle only).
-- unmerge_vehicle never reopened merge_proposals (it stayed 'executed') and left the primary's image_count high.
--
-- After this migration a merge:
--   * moves vehicle_images, vehicle_observations, auction_events, auction_comments, observation_discoveries, vehicle_events and
--     timeline_events to the primary, stamping merged_from_vehicle_id on each moved row (all seven carry the column now);
--   * SUPERSEDES a duplicate observation that a primary observation shares (source_id, source_identifier, kind) with
--     (is_superseded, superseded_by = the primary's row, superseded_at) and still moves it; nothing is deleted;
--   * LEAVES ON THE DUPLICATE (neither moved nor deleted) any row that would collide with a row the primary already holds on a
--     per-vehicle unique key: they are the same fact the primary already has. Their ids go in the journal (*_left_ids);
--   * deletes NOTHING. bat_listings, comment_discoveries and description_discoveries (unique per vehicle, no stamp column; the old
--     merge archived them to merge_deleted_rows and deleted them, although db-safety.md lists them as testimony) stay on the
--     soft-deleted duplicate. merge_deleted_rows is only read now, by unmerge_vehicle, for merges that predate this migration;
--   * recounts vehicles.image_count on both vehicles.
-- unmerge_vehicle(proposal, reason) moves the stamped rows back, clears exactly the supersessions the journal recorded,
-- restores archived derived rows (and archived observations/comments from merges that predate this migration), recounts both
-- vehicles, and sets the executed merge_proposals row to 'unmerged' with the reason in evidence.unmerge.
--
-- Not changed: merge_duplicate_vehicles (the UI path). It has no journal, stamps nothing and deletes organization_vehicles rows;
-- unmerge_vehicle cannot undo it (noted in the review doc, not touched here). No merge is run by this migration.
--
-- Tested by supabase/sql/test_merge_into_primary_contract.sql (scratch PG17: merge a synthetic pair, unmerge, row counts and
-- row checksums identical to before).
SET statement_timeout = '60s';
SET lock_timeout = '5s';

ALTER TABLE public.vehicle_events  ADD COLUMN IF NOT EXISTS merged_from_vehicle_id uuid;
ALTER TABLE public.timeline_events ADD COLUMN IF NOT EXISTS merged_from_vehicle_id uuid;
COMMENT ON COLUMN public.vehicle_events.merged_from_vehicle_id  IS 'Set by merge_into_primary: the duplicate vehicle this row came from. unmerge_vehicle moves rows with this stamp back.';
COMMENT ON COLUMN public.timeline_events.merged_from_vehicle_id IS 'Set by merge_into_primary: the duplicate vehicle this row came from. unmerge_vehicle moves rows with this stamp back.';

ALTER TABLE public.merge_proposals DROP CONSTRAINT IF EXISTS merge_proposals_status_check;
ALTER TABLE public.merge_proposals ADD CONSTRAINT merge_proposals_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'executed'::text, 'unmerged'::text]));

CREATE OR REPLACE FUNCTION public.merge_into_primary(primary_id uuid, dup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
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
  SELECT array_agg(id) INTO v_ids FROM vehicle_observations WHERE vehicle_id = dup_id;
  v_journal := v_journal || jsonb_build_object('observations_moved_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb),
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

  -- 11. Soft-delete the duplicate.
  UPDATE vehicles SET merged_into_vehicle_id = primary_id, status = 'merged', deleted_at = NOW() WHERE id = dup_id;

  -- 12. image_count on both vehicles (the row trigger recounts the new vehicle only).
  UPDATE vehicles v
     SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE v.id IN (primary_id, dup_id);

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

REVOKE ALL ON FUNCTION public.merge_into_primary(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_into_primary(uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.unmerge_vehicle(uuid);

CREATE OR REPLACE FUNCTION public.unmerge_vehicle(p_proposal_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_proposal RECORD;
  v_primary_id UUID;
  v_dup_id UUID;
  v_images_returned INT := 0; v_comments_returned INT := 0; v_observations_returned INT := 0; v_events_returned INT := 0;
  v_obs_disc_returned INT := 0; v_vehicle_events_returned INT := 0; v_timeline_returned INT := 0;
  v_unsuperseded INT := 0; v_archived_restored INT := 0; v_mp_rows INT := 0;
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
  IF v_proposal.merge_journal IS NULL THEN
    RETURN jsonb_build_object('error', 'no_journal', 'message', 'This merge predates the journal system and cannot be automatically reversed.');
  END IF;

  v_primary_id := v_proposal.primary_vehicle_id;
  v_dup_id := v_proposal.duplicate_vehicle_id;

  -- 1. Rows that carry this merge's stamp go back. Post-merge additions have no stamp and stay on the primary.
  UPDATE vehicle_images SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_images_returned = ROW_COUNT;

  UPDATE vehicle_observations SET vehicle_id = v_dup_id, merged_from_vehicle_id = NULL WHERE vehicle_id = v_primary_id AND merged_from_vehicle_id = v_dup_id;
  GET DIAGNOSTICS v_observations_returned = ROW_COUNT;

  -- 1b. Clear exactly the supersessions this merge recorded (still pointing at the row the merge chose).
  UPDATE vehicle_observations o
     SET is_superseded = false, superseded_by = NULL, superseded_at = NULL
    FROM jsonb_to_recordset(COALESCE(v_proposal.merge_journal->'observations_superseded', '[]'::jsonb)) AS j(id uuid, by uuid)
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

  -- 3. Restore the duplicate.
  UPDATE vehicles SET status = COALESCE(v_proposal.pre_merge_dup_status, 'active'), merged_into_vehicle_id = NULL, deleted_at = NULL WHERE id = v_dup_id;

  -- 4. image_count on both vehicles.
  UPDATE vehicles v
     SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE)
   WHERE v.id IN (v_primary_id, v_dup_id);

  -- 5. Proposal status, and the merge_proposals row that was executed for this pair.
  UPDATE vehicle_merge_proposals SET status = 'unmerged', unmerged_at = NOW(), unmerged_by = auth.uid() WHERE id = p_proposal_id;

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
    'merge_proposals_reopened', v_mp_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.unmerge_vehicle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmerge_vehicle(uuid, text) TO authenticated, service_role;

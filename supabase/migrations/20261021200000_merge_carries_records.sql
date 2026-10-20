-- A merge carries the records about the car and its people, not only its photos and listings; unmerge returns them.
--
-- IC41 (the image and vehicle-record rebuild lane, 2026-10-20): a merge moved images, observations and the listing and timeline events
-- and nothing else, so work sessions, receipts and jackets, journals, permissions and organization links stayed on the merged-away row.
-- Census of every vehicle_id table (347; 301 answered, the 46 largest timed out at 20 s): 59 hold rows stranded on merged vehicles, among them
-- work_sessions 185, receipts 1, vehicle_user_permissions 2 and organization_vehicles 20,589 rows on 19,833 merged vehicles (the dealer
-- pages' "vehicles no longer present"). A merge of an owned duplicate into an unowned survivor also left the surviving car unowned.
-- Design and the bucket for each table: ~/nuke-logs/dedup-perf-20261019/ic41_carry_design.md; answers and the money tables named by the lane.
--
-- merge_carry_children(primary, dup), called by merge_into_primary and merge_into_primary_batch for every pair:
--   * moves the duplicate's rows in work_sessions, receipts, deal_jackets, journal_entries, qb_transactions, work_orders,
--     vehicle_user_permissions, vehicle_contributors, user_vehicle_links, vehicle_user_relationships, organization_vehicles, image_sets,
--     vehicle_resolver_aliases, vehicle_listings, vehicle_builder_attribution and vehicle_field_sources onto the survivor, keeping a row the
--     survivor already holds (same vehicle plus the table's unique key) on the duplicate; receipts and payment_events that name the vehicle
--     only through scope_type 'vehicle' / scope_id follow too. journal_lines and the work_order children follow through their parent id.
--   * fills the survivor's owner_id and uploaded_by where empty from the duplicate (vehicles.user_id is generated from uploaded_by, so it follows);
--     two different user_id or owner_id values refuse the pair (owner_conflict).
--   * records every moved id per table in merge_journal -> carry -> carried, the filled columns in carry -> owner_filled and a failed table in
--     carry -> errors. A table whose carry fails (a trigger, a constraint) is skipped, never failing the merge.
--   * never touches the evidence tables (evidence_runs, image_vehicle_candidates, image_capture_time_claims, evidence_links,
--     evidence_account_entities, vehicle_change_claims, vehicle_change_claim_support, user_day_vehicle_context, evidence_decisions), image_observations
--     claims or pins, derived tables (scores, metrics, search index), logs and queues, or vehicle_ownerships / ownership_transfers (written only by
--     the owner-period fold); amounts and titles are never edited, only vehicle_id (or scope_id) moves.
-- unmerge_vehicle returns exactly the journaled ids that still sit on the survivor (rows added after the merge stay) and clears the owner columns it
-- filled while they still hold the filled value. carry_children_for_merged_pair completes a merge that ran before this migration, without filling
-- the owner link unless asked (p_fill_owner).
-- Everything else in the three functions is the live body (2026-10-20, after 20261021170000).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.merge_carry_children(p_primary uuid, p_dup uuid, p_fill_owner boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  spec record;
  v_exists boolean;
  v_ids uuid[];
  v_collide text;
  v_carry jsonb := '{}'::jsonb;
  v_errors jsonb := '{}'::jsonb;
  v_filled jsonb := '{}'::jsonb;
  dup record;
  sur record;
BEGIN
  IF p_primary IS NULL OR p_dup IS NULL OR p_primary = p_dup THEN RETURN '{}'::jsonb; END IF;

  FOR spec IN SELECT * FROM (VALUES
      ('work_sessions', ARRAY['start_time']),
      ('receipts', ARRAY[]::text[]),
      ('deal_jackets', ARRAY[]::text[]),
      ('journal_entries', ARRAY[]::text[]),
      ('qb_transactions', ARRAY[]::text[]),
      ('work_orders', ARRAY[]::text[]),
      ('vehicle_user_permissions', ARRAY['user_id']),
      ('vehicle_contributors', ARRAY['user_id', 'role']),
      ('user_vehicle_links', ARRAY['user_id', 'link_type']),
      ('vehicle_user_relationships', ARRAY['user_id', 'role']),
      ('organization_vehicles', ARRAY['organization_id', 'relationship_type']),
      ('image_sets', ARRAY[]::text[]),
      ('vehicle_resolver_aliases', ARRAY['alias', 'alias_type']),
      ('vehicle_listings', ARRAY[]::text[]),
      ('vehicle_builder_attribution', ARRAY['organization_id']),
      ('vehicle_field_sources', ARRAY['field_name'])
    ) AS t(tbl, keys)
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', spec.tbl)) IS NULL;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE vehicle_id = $1)', spec.tbl) INTO v_exists USING p_dup;
    CONTINUE WHEN NOT v_exists;
    v_collide := '';
    IF cardinality(spec.keys) > 0 THEN
      v_collide := format(' AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.vehicle_id = $1 AND %s)', spec.tbl,
        (SELECT string_agg(format('p.%1$I IS NOT DISTINCT FROM d.%1$I', k), ' AND ') FROM unnest(spec.keys) k));
    ELSIF spec.tbl = 'vehicle_listings' THEN
      -- one active and one draft listing per vehicle (partial unique indexes)
      v_collide := ' AND NOT (d.status IN (''active'', ''draft'') AND EXISTS (SELECT 1 FROM public.vehicle_listings p WHERE p.vehicle_id = $1 AND p.status = d.status))';
    END IF;
    BEGIN
      EXECUTE format('WITH m AS (UPDATE public.%I d SET vehicle_id = $1 WHERE d.vehicle_id = $2%s RETURNING d.id) SELECT coalesce(array_agg(id), ''{}''::uuid[]) FROM m',
                     spec.tbl, v_collide) INTO v_ids USING p_primary, p_dup;
      IF cardinality(v_ids) > 0 THEN v_carry := v_carry || jsonb_build_object(spec.tbl, to_jsonb(v_ids)); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(spec.tbl, left(SQLERRM, 160));
    END;
  END LOOP;

  -- Rows that name the vehicle only through their scope.
  IF to_regclass('public.receipts') IS NOT NULL THEN
    BEGIN
      WITH m AS (UPDATE public.receipts r SET scope_id = p_primary::text WHERE r.scope_type = 'vehicle' AND r.scope_id = p_dup::text RETURNING r.id)
      SELECT array_agg(id) INTO v_ids FROM m;
      IF v_ids IS NOT NULL THEN v_carry := v_carry || jsonb_build_object('receipts_scope', to_jsonb(v_ids)); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('receipts_scope', left(SQLERRM, 160));
    END;
  END IF;
  IF to_regclass('public.payment_events') IS NOT NULL THEN
    BEGIN
      WITH m AS (UPDATE public.payment_events e SET scope_id = p_primary WHERE e.scope_type = 'vehicle' AND e.scope_id = p_dup RETURNING e.id)
      SELECT array_agg(id) INTO v_ids FROM m;
      IF v_ids IS NOT NULL THEN v_carry := v_carry || jsonb_build_object('payment_events_scope', to_jsonb(v_ids)); END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('payment_events_scope', left(SQLERRM, 160));
    END;
  END IF;

  -- The owner link: an owner column the survivor lacks comes from the duplicate (a conflict never reaches here: the callers refuse it).
  -- vehicles.user_id is generated from uploaded_by, so filling uploaded_by fills it.
  BEGIN
    SELECT owner_id, uploaded_by INTO dup FROM public.vehicles WHERE id = p_dup;
    SELECT owner_id, uploaded_by INTO sur FROM public.vehicles WHERE id = p_primary;
    IF FOUND AND p_fill_owner THEN
      IF sur.owner_id IS NULL AND dup.owner_id IS NOT NULL THEN v_filled := v_filled || jsonb_build_object('owner_id', dup.owner_id); END IF;
      IF sur.uploaded_by IS NULL AND dup.uploaded_by IS NOT NULL THEN v_filled := v_filled || jsonb_build_object('uploaded_by', dup.uploaded_by); END IF;
      IF v_filled <> '{}'::jsonb THEN
        UPDATE public.vehicles v
           SET owner_id = COALESCE(v.owner_id, dup.owner_id), uploaded_by = COALESCE(v.uploaded_by, dup.uploaded_by)
         WHERE v.id = p_primary;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_filled := '{}'::jsonb;
    v_errors := v_errors || jsonb_build_object('owner_columns', left(SQLERRM, 160));
  END;

  RETURN (CASE WHEN v_carry = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('carried', v_carry) END)
      || (CASE WHEN v_filled = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('owner_filled', v_filled) END)
      || (CASE WHEN v_errors = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('errors', v_errors) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.carry_children_for_merged_pair(p_proposal_id uuid, p_fill_owner boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_p record;
  v_carry jsonb;
BEGIN
  SELECT * INTO v_p FROM vehicle_merge_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'proposal_not_found'); END IF;
  IF v_p.status <> 'merged' THEN RETURN jsonb_build_object('error', 'not_merged', 'current_status', v_p.status); END IF;
  IF v_p.merge_journal IS NOT NULL AND v_p.merge_journal ? 'carry' THEN
    RETURN jsonb_build_object('already_carried', true, 'carry', v_p.merge_journal -> 'carry');
  END IF;
  -- An owned pair completes only an approved, reviewed merge: finishing the carry is part of the merge the owner approved.
  IF (EXISTS (SELECT 1 FROM vehicles WHERE id IN (v_p.primary_vehicle_id, v_p.duplicate_vehicle_id)
               AND (user_id IS NOT NULL OR owner_id IS NOT NULL OR uploaded_by IS NOT NULL))
      OR EXISTS (SELECT 1 FROM vehicle_user_permissions WHERE vehicle_id IN (v_p.primary_vehicle_id, v_p.duplicate_vehicle_id)
                  AND is_active AND role IN ('owner', 'co_owner')))
     AND v_p.reviewed_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM merge_proposals mp
                      WHERE mp.status IN ('approved', 'executed')
                        AND ((mp.vehicle_a_id = v_p.primary_vehicle_id AND mp.vehicle_b_id = v_p.duplicate_vehicle_id)
                          OR (mp.vehicle_a_id = v_p.duplicate_vehicle_id AND mp.vehicle_b_id = v_p.primary_vehicle_id))) THEN
    RETURN jsonb_build_object('error', 'owned_requires_approval', 'primary', v_p.primary_vehicle_id, 'dup', v_p.duplicate_vehicle_id);
  END IF;
  IF EXISTS (SELECT 1 FROM vehicles p, vehicles d WHERE p.id = v_p.primary_vehicle_id AND d.id = v_p.duplicate_vehicle_id
              AND ((p.user_id IS NOT NULL AND d.user_id IS NOT NULL AND p.user_id <> d.user_id)
                OR (p.owner_id IS NOT NULL AND d.owner_id IS NOT NULL AND p.owner_id <> d.owner_id))) THEN
    RETURN jsonb_build_object('error', 'owner_conflict');
  END IF;
  v_carry := public.merge_carry_children(v_p.primary_vehicle_id, v_p.duplicate_vehicle_id, p_fill_owner);
  UPDATE vehicle_merge_proposals
     SET merge_journal = COALESCE(merge_journal, '{}'::jsonb) || jsonb_build_object('carry', v_carry, 'carry_completed_at', now())
   WHERE id = p_proposal_id;
  RETURN jsonb_build_object('carried', true, 'carry', v_carry);
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_carry_children(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.carry_children_for_merged_pair(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_carry_children(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.carry_children_for_merged_pair(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.merge_carry_children(uuid, uuid, boolean) IS
  'Moves the records about a car and its people (work sessions, receipts, jackets, journals, permissions, links, organization links, albums, aliases, listings) from a merged-away vehicle onto its survivor, keeping rows that collide with one the survivor holds; fills empty owner columns on the survivor (p_fill_owner, default true); returns {carried: {table: [ids]}, owner_filled, errors}. Called by the merge functions; unmerge_vehicle reverses it from the journal. Never touches evidence tables, image_observations, derived tables or logs.';
COMMENT ON FUNCTION public.carry_children_for_merged_pair(uuid, boolean) IS
  'Completes the carry for a merge that ran before merge_carry_children existed: runs it for the proposal''s pair and appends the result to its merge_journal. An owned pair needs a reviewed proposal (or an executed merge_proposals row); two different owners refuse. Owner columns are NOT filled onto an existing survivor unless p_fill_owner is true (that changes a live vehicle''s ownership after the fact: the owner''s call). Idempotent. Service role only.';

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
  v_carry JSONB := '{}'::jsonb;
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

  -- Two different owners are two vehicles' owners: never merged here either (an owner column set on both rows and different).
  IF EXISTS (
    SELECT 1 FROM vehicles p, vehicles d
     WHERE p.id = primary_id AND d.id = dup_id
       AND ((p.user_id IS NOT NULL AND d.user_id IS NOT NULL AND p.user_id <> d.user_id)
         OR (p.owner_id IS NOT NULL AND d.owner_id IS NOT NULL AND p.owner_id <> d.owner_id))
  ) THEN
    RETURN jsonb_build_object('skipped', 'owner_conflict', 'primary', primary_id, 'dup', dup_id);
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

  -- 7b. Records about the car or its people follow the merge (work sessions, receipts and jackets, journals, permissions and links,
  --     organization links, albums, aliases, listings), and the owner link fills an unowned survivor. Collisions stay on the duplicate;
  --     a table whose carry fails is recorded and skipped, never failing the merge. Journaled for unmerge_vehicle.
  v_carry := public.merge_carry_children(primary_id, dup_id);
  v_journal := v_journal || jsonb_build_object('carry', v_carry);

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
    'carry', v_carry,
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
  v_pair record;
  n_carried INT := 0;
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
  CREATE TEMP TABLE IF NOT EXISTS _batch_merge_carry (dup_id uuid PRIMARY KEY, carry jsonb NOT NULL) ON COMMIT DROP;
  TRUNCATE _batch_merge_carry;

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
    -- Two different owners are two vehicles' owners: never merged here (an owner column set on both rows and different).
    AND NOT ((vp.user_id IS NOT NULL AND vd.user_id IS NOT NULL AND vp.user_id <> vd.user_id)
          OR (vp.owner_id IS NOT NULL AND vd.owner_id IS NOT NULL AND vp.owner_id <> vd.owner_id))
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

  -- 11b. Records about the car or its people follow each pair (see merge_carry_children). One pair at a time, so two duplicates of one
  --      survivor never collide with each other; collisions stay on the duplicate; a failed table is recorded, never failing the batch.
  FOR v_pair IN SELECT primary_id, dup_id FROM _batch_merge_pairs ORDER BY dup_id LOOP
    INSERT INTO _batch_merge_carry (dup_id, carry) VALUES (v_pair.dup_id, public.merge_carry_children(v_pair.primary_id, v_pair.dup_id));
  END LOOP;
  SELECT COALESCE(sum((SELECT count(*) FROM jsonb_each(c.carry -> 'carried') x, jsonb_array_elements(x.value))), 0)::int
    INTO n_carried FROM _batch_merge_carry c;

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
           'survivor_filled', COALESCE((SELECT jsonb_object_agg(o.key, o.value) FROM owner o WHERE o.dup_id = bmp.dup_id), '{}'::jsonb),
           'carry', COALESCE((SELECT c.carry FROM _batch_merge_carry c WHERE c.dup_id = bmp.dup_id), '{}'::jsonb))
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
    'carried_rows', n_carried,
    'merged_dup_ids', COALESCE(to_jsonb(v_dups), '[]'::jsonb)
  );
END;
$function$;

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
  v_carry_returned JSONB := '{}'::jsonb; v_ids UUID[]; v_table TEXT; v_col TEXT; v_owner_val JSONB;
  c_carry_tables CONSTANT text[] := ARRAY['work_sessions', 'receipts', 'deal_jackets', 'journal_entries', 'qb_transactions', 'work_orders',
    'vehicle_user_permissions', 'vehicle_contributors', 'user_vehicle_links', 'vehicle_user_relationships', 'organization_vehicles',
    'image_sets', 'vehicle_resolver_aliases', 'vehicle_listings', 'vehicle_builder_attribution', 'vehicle_field_sources'];
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

  -- 1c. Records the merge carried (merge_carry_children) go back by the ids it journaled, while they still sit on the primary; the owner
  --     columns it filled are cleared while they still hold the filled value. Rows added after the merge are not in the journal and stay.
  FOR v_table, v_val IN SELECT key, value FROM jsonb_each(COALESCE(v_journal -> 'carry' -> 'carried', '{}'::jsonb)) LOOP
    SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_ids FROM jsonb_array_elements_text(v_val) x;
    IF v_table = 'receipts_scope' THEN
      UPDATE receipts SET scope_id = v_dup_id::text WHERE id = ANY (v_ids) AND scope_type = 'vehicle' AND scope_id = v_primary_id::text;
    ELSIF v_table = 'payment_events_scope' THEN
      UPDATE payment_events SET scope_id = v_dup_id WHERE id = ANY (v_ids) AND scope_type = 'vehicle' AND scope_id = v_primary_id;
    ELSIF v_table = ANY (c_carry_tables) AND to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET vehicle_id = $1 WHERE id = ANY ($2) AND vehicle_id = $3', v_table) USING v_dup_id, v_ids, v_primary_id;
    ELSE
      CONTINUE;
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_carry_returned := v_carry_returned || jsonb_build_object(v_table, v_n);
  END LOOP;
  FOR v_col, v_owner_val IN SELECT key, value FROM jsonb_each(COALESCE(v_journal -> 'carry' -> 'owner_filled', '{}'::jsonb)) LOOP
    CONTINUE WHEN v_col NOT IN ('owner_id', 'uploaded_by');
    EXECUTE format('UPDATE vehicles SET %1$I = NULL WHERE id = $1 AND to_jsonb(%1$I) = $2', v_col) USING v_primary_id, v_owner_val;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_carry_returned := v_carry_returned || jsonb_build_object('owner_' || v_col, true); END IF;
  END LOOP;

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
           'at', NOW(), 'reason', p_reason, 'survivor_reverted', v_reverted, 'dup_listing_url_parked', v_parked, 'carry_returned', v_carry_returned))
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
    'dup_listing_url_parked', v_parked,
    'carry_returned', v_carry_returned
  );
END;
$function$;

COMMIT;

-- get_vehicle_profile_data: apply timeline_events' private-source policy inside the definer.
--
-- WHY. get_vehicle_profile_data(uuid) is SECURITY DEFINER and anon may execute it; it is the public profile's main
-- reader. A definer runs as its owner, so timeline_events' RLS does not apply inside it. The table's RESTRICTIVE policy
-- timeline_events_private_source_read (anon, authenticated) hides events whose source is whatsapp_ingest, call_history,
-- call_history_lead_pattern, imessage_thread or apple_health_export from everyone but their author; the reader ignored
-- it, so a public car's profile handed those events (private communications and health metadata) to anon, and counted
-- them in stats.event_count and stats.last_activity. Count before: see the PR body (prod, read-only, counts only).
--
-- WHAT. The restrictive predicate is restated in the timeline_events list and in both stats that read the table:
--   v_service OR source IS NULL OR source <> ALL (<the five sources>) OR user_id = v_uid
-- (v_service and v_uid are the reader's own request-role and auth.uid() variables). The permissive read policies need
-- no restatement: every caller who passes the reader's gate (public car, or insider) satisfies one of them. Nothing else
-- in the body changes. The copy is registered in private_row_policy_copies (#3925) when that table exists, so the
-- hourly exposure watch fails if the table's read policies change.
-- CONTRACT: supabase/sql/test_profile_timeline_private_sources.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125220000_profile_timeline_private_sources.sql (the prior live body).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE s text;
BEGIN
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') INTO s
  FROM pg_proc p WHERE p.oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;
  -- The live body read 2026-11-25 (sha256 of prosrc), or this migration's own body on a re-run.
  IF s IS DISTINCT FROM '81845bbca63c4d720771a990b6088c27f4d0479b41d4134d7c2ffcaebd445583'
     AND position('profile_timeline_private_sources_v1' in pg_get_functiondef('public.get_vehicle_profile_data(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'get_vehicle_profile_data changed after it was read for 20261125220000 (sha256 %); review it', s;
  END IF;
  -- The policy this body restates, as read 2026-11-25 (md5 of the timeline_events SELECT/ALL policies, the formula of
  -- private_row_policy_hash in 20261125204500).
  IF (SELECT md5(string_agg(p.policyname || ':' || p.permissive || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, ''),
                            '|' ORDER BY p.policyname))
      FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'timeline_events' AND p.cmd IN ('SELECT', 'ALL'))
     IS DISTINCT FROM '59207833e1b8f9ab3f0dfd6663388f71' AND current_database() NOT LIKE 'dm_%' THEN
    RAISE EXCEPTION 'timeline_events read policies changed after 20261125220000 restated them; re-read before applying';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  v_uid uuid := auth.uid();
  v_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_public boolean;
  v_insider boolean;     -- same test as vehicles_private_select
  v_org_member boolean;  -- same test as "Organization members can view org vehicle images"
BEGIN
  -- COALESCE: a NULL owner_id/uploaded_by makes the comparison NULL, and NOT (false OR NULL)
  -- is NULL, which IF treats as false -- that let a signed-in stranger open a private vehicle
  -- in the local test.
  SELECT COALESCE(v.is_public, false),
         COALESCE(v_service OR (v_uid IS NOT NULL AND (
           v_uid = v.user_id
           OR v_uid = v.owner_id
           OR v_uid = v.uploaded_by
           OR public.vehicle_user_has_access(v.id, v_uid))), false)
    INTO v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  IF NOT FOUND OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;

  v_org_member := v_uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.vehicle_id = p_vehicle_id
      AND oc.user_id = v_uid
      AND oc.status = 'active'
  );

  SELECT json_build_object(
    -- The owner's purchase facts reach insiders only (owner rule 2026-09-28): everyone else reads the
    -- row with purchase_price, purchase_date and purchase_location set to null, and money_masked = true.
    'vehicle', (
      SELECT CASE WHEN v_insider THEN row_to_json(v.*)
                  ELSE public.vehicle_row_public_projection(to_jsonb(v.*))::json END
      FROM public.vehicles v
      WHERE v.id = p_vehicle_id
    ),
    'money_masked', NOT v_insider,
    'images', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', vi.id,
            'vehicle_id', vi.vehicle_id,
            'image_url', vi.image_url,
            'thumbnail_url', vi.thumbnail_url,
            'medium_url', vi.medium_url,
            'large_url', vi.large_url,
            'variants', vi.variants,
            'is_primary', vi.is_primary,
            'is_document', vi.is_document,
            'position', vi.position,
            'created_at', vi.created_at,
            'storage_path', vi.storage_path,
            'caption', vi.caption,
            'image_type', vi.image_type,
            'category', vi.category,
            'file_name', vi.file_name,
            'source', vi.source,
            'has_analysis', (vi.ai_scan_metadata ? 'byok_deep_analysis'),
            'analysis', (
              CASE WHEN vi.ai_scan_metadata ? 'byok_deep_analysis' THEN
                json_build_object(
                  'scene_type',   vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type',
                  'build_phase',  vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess',
                  'intent',       vi.ai_scan_metadata->'byok_deep_analysis'->>'intent',
                  'narrative',    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line',
                  'confidence',   vi.ai_scan_metadata->'byok_deep_analysis'->>'confidence',
                  'component_count', jsonb_array_length(COALESCE(vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen', '[]'::jsonb))
                )
              ELSE NULL END
            )
          )
        ),
        '[]'::json
      )
      FROM (
        SELECT id, vehicle_id, image_url, thumbnail_url, medium_url, large_url,
               variants, is_primary, is_document, position, created_at,
               storage_path, caption, image_type, category, file_name, source,
               ai_scan_metadata
        FROM public.vehicle_images
        WHERE vehicle_id = p_vehicle_id
          AND public.vehicle_image_gallery_eligible(vehicle_images)
          AND COALESCE(is_document, false) = false
          AND COALESCE(is_duplicate, false) = false
          AND image_url IS NOT NULL
          AND (source IS NULL OR source <> 'e2e_test')
          AND (image_url NOT LIKE 'file://%')
          AND COALESCE(is_superseded, false) = false
          AND (v_insider OR v_org_member
               OR COALESCE(is_sensitive, false) = false
               OR user_id = v_uid)
        ORDER BY
          COALESCE(is_primary, false) DESC,
          position ASC NULLS LAST,
          created_at ASC,
          id ASC
        LIMIT 50
      ) vi
    ),
    'timeline_events', (
      SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
      FROM (
        -- Every column the page reads. Left out: search_vector (a tsvector the browser cannot use,
        -- 32 KB of the K5's 100 rows), photo_analysis, verification_documents and
        -- location_coordinates (read nowhere in the frontend). Fewer TOAST reads cold, less JSON warm.
        SELECT id, vehicle_id, user_id, event_type, source, title, description, event_date, image_urls,
               metadata, created_at, updated_at, mileage_at_event, cost_amount, cost_currency,
               duration_hours, location_name, location_address, service_provider_name,
               service_provider_type, invoice_number, warranty_info, parts_used, is_insurance_claim,
               insurance_claim_number, next_service_due_date, next_service_due_mileage, data_source,
               confidence_score, source_type, event_category, activity_type, automated_tags, manual_tags,
               receipt_data, parts_mentioned, tools_mentioned, labor_hours, cost_estimate, organization_id,
               client_id, is_monetized, work_started, work_completed, contract_id, applied_labor_rate,
               applied_shop_rate, rate_source, contextual_analysis_status, documented_by,
               primary_technician, quality_rating, quality_justification, value_impact, ai_confidence_score,
               concerns, industry_standard_comparison, work_order_id
        FROM public.timeline_events
        WHERE vehicle_id = p_vehicle_id
          -- profile_timeline_private_sources_v1: timeline_events_private_source_read (RESTRICTIVE, anon and
          -- authenticated) restated; the permissive read policies are implied by the visibility gate above.
          AND (v_service OR source IS NULL OR source <> ALL (ARRAY['whatsapp_ingest', 'call_history', 'call_history_lead_pattern', 'imessage_thread', 'apple_health_export']) OR user_id = v_uid)
        ORDER BY event_date DESC
        LIMIT 100
      ) te
    ),
    'work_sessions', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', ws.id,
          'session_date', ws.session_date,
          'title', ws.title,
          'work_type', ws.work_type,
          'image_count', ws.image_count,
          'duration_minutes', ws.duration_minutes,
          'total_parts_cost', ws.total_parts_cost,
          'total_labor_cost', ws.total_labor_cost,
          'total_job_cost', ws.total_job_cost,
          'work_description', ws.work_description,
          'status', ws.status
        )
        ORDER BY ws.session_date DESC
      ), '[]'::json)
      FROM public.work_sessions ws
      WHERE ws.vehicle_id = p_vehicle_id
        AND (v_insider OR ws.user_id = v_uid)
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM (
        SELECT * FROM public.vehicle_comments
        WHERE vehicle_id = p_vehicle_id
        ORDER BY created_at DESC
        LIMIT 50
      ) vc
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*)
      FROM public.vehicle_valuations vv
      WHERE vv.vehicle_id = p_vehicle_id
      ORDER BY vv.valuation_date DESC
      LIMIT 1
    ),
    'external_listings', (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el
      WHERE el.vehicle_id = p_vehicle_id
    ),
    'stats', json_build_object(
      'image_count', (
        SELECT COUNT(*) FROM public.vehicle_images WHERE vehicle_id = p_vehicle_id AND COALESCE(is_superseded, false) = false
      ),
      'event_count', (SELECT COUNT(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id
        AND (v_service OR source IS NULL OR source <> ALL (ARRAY['whatsapp_ingest', 'call_history', 'call_history_lead_pattern', 'imessage_thread', 'apple_health_export']) OR user_id = v_uid)),
      'comment_count', (
        (SELECT COUNT(*) FROM public.vehicle_comments WHERE vehicle_id = p_vehicle_id) +
        (SELECT COUNT(*) FROM public.auction_comments WHERE vehicle_id = p_vehicle_id
      AND (auction_comments.auction_event_id IS NULL OR EXISTS (SELECT 1 FROM public.auction_events_canonical canonical_event WHERE canonical_event.id = auction_comments.auction_event_id OFFSET 0)))
      ),
      'observation_count', (SELECT COUNT(*) FROM public.vehicle_observations WHERE vehicle_id = p_vehicle_id),
      'document_count', (
        SELECT COUNT(*) FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      ),
      'last_activity', (SELECT MAX(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id
        AND (v_service OR source IS NULL OR source <> ALL (ARRAY['whatsapp_ingest', 'call_history', 'call_history_lead_pattern', 'imessage_thread', 'apple_health_export']) OR user_id = v_uid)),
      'total_documented_costs', (
        SELECT COALESCE(SUM(d.amount), 0)
        FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND d.document_type IN ('receipt', 'invoice')
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      )
    )
  ) INTO result;

  RETURN result;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'get_vehicle_profile_data failed for vehicle %: %', p_vehicle_id, SQLERRM;
    RETURN NULL;
END;
$function$;

DO $check$
DECLARE f record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS res,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         position('profile_timeline_private_sources_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;
  IF NOT (f.prosecdef AND f.provolatile = 'v' AND f.proconfig = ARRAY['search_path=public'] AND f.res = 'json'
          AND f.anon_x AND f.marked) THEN
    RAISE EXCEPTION 'get_vehicle_profile_data not as intended';
  END IF;
END $check$;

-- Register the copy with the hourly exposure watch (20261125204500) when it is deployed; otherwise its own migration
-- or the watch's owner adds this row.
DO $reg$
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    EXECUTE $i$INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
      VALUES ('get_vehicle_profile_data(uuid)', 'timeline_events', 'p.cmd IN (''SELECT'', ''ALL'')',
              '59207833e1b8f9ab3f0dfd6663388f71', 'ta-provenance',
              '20261125220000 restates timeline_events_private_source_read (RESTRICTIVE) in the timeline list and stats')
      ON CONFLICT (reader, relation, policy_filter) DO NOTHING$i$;
  END IF;
END $reg$;
COMMIT;

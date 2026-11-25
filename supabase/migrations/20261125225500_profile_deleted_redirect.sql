-- get_vehicle_profile_data: a deleted car is public only as a merge redirect.
--
-- WHY. get_vehicle_profile_data(uuid) is SECURITY DEFINER and anon may execute it. It gated a non-insider on is_public
-- alone, so a deleted car still flagged public opened as a full profile for anyone. Prod 2026-11-25 (read-only, counts
-- only, 185 of 256 primary-key slices = 1,076,292 rows): 64,362 deleted and public, 39,600 of them not merged; about 89k
-- and 55k for the table. 34,527 deleted public cars are merged stubs (EXPLAIN ANALYZE actual rows): the page opens one
-- through this reader and redirects to merged_into_vehicle_id (loadVehicleData.ts, mergedTargetOf).
--
-- WHAT. The same predicate as vehicle_row_read (20261125214500): public.vehicle_publicly_readable(is_public, deleted_at,
-- merged_into_vehicle_id), created here too with the identical body (whichever deploys first creates it; the contract
-- pins its sha) so this applies in either order. A non-insider now reads a car only when it holds. A deleted merged car
-- answers a non-insider {"vehicle": {"id", "merged_into_vehicle_id"}} and nothing else, which is all the redirect reads,
-- when its target is publicly readable; a stub whose target is not (prod 2026-11-25, 8 of 256 pk slices: 280 of 1,050
-- public stubs, 26.7%, about 9.0k for the table, every one a private target) and a deleted car that was not merged answer
-- NULL, exactly like a missing one. The page's fallback select (loadVehicleData.ts, PUBLIC_ROW_OR) applies the same rule. Insiders and the service role are
-- unchanged. Built on 20261125221500: the guard accepts only that body (or this one on a re-run).
-- CONTRACT: supabase/sql/test_profile_deleted_redirect.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125225500_profile_deleted_redirect.sql (the 20261125221500 body).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE s text;
BEGIN
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') INTO s
  FROM pg_proc p WHERE p.oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;
  IF s IS DISTINCT FROM '8de209c9b0536fba4eeb3470970519683bf7cfdb041dfba3943d2f785554d6e8'
     AND position('profile_deleted_redirect_v1' in pg_get_functiondef('public.get_vehicle_profile_data(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'get_vehicle_profile_data is not the 20261125221500 body (sha256 %); deploy that first or review', s;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz,
                                                            p_merged_into_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
COMMENT ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) IS
  'The public-row predicate for vehicles: public, and not deleted unless it was merged (a merged stub stays readable as '
  'a redirect only). Called by vehicle_row_read, get_vehicle_profile_data and the vehicles read policy. Inlinable: keep it '
  'plain SQL with no SET clause and no table read.';
-- EXECUTE to PUBLIC, never revoked: 20261125225000 puts this predicate in the vehicles read policies (TO public), and a
-- role that reads vehicles under RLS without EXECUTE (pg_read_all_data members) would fail there. It reads no data.
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO PUBLIC, anon, authenticated, service_role;

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
  v_redirect uuid;
BEGIN
  -- COALESCE: a NULL owner_id/uploaded_by makes the comparison NULL, and NOT (false OR NULL)
  -- is NULL, which IF treats as false -- that let a signed-in stranger open a private vehicle
  -- in the local test.
  -- profile_deleted_redirect_v1: public means vehicle_publicly_readable (public, and not deleted unless merged); a
  -- deleted merged car answers a non-insider with the redirect only, never its profile.
  SELECT public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id),
         CASE WHEN v.deleted_at IS NOT NULL THEN v.merged_into_vehicle_id END,
         COALESCE(v_service OR (v_uid IS NOT NULL AND (
           v_uid = v.user_id
           OR v_uid = v.owner_id
           OR v_uid = v.uploaded_by
           OR public.vehicle_user_has_access(v.id, v_uid))), false)
    INTO v_public, v_redirect, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;

  IF NOT FOUND OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_redirect IS NOT NULL AND NOT v_insider THEN
    -- A redirect to a car that is not publicly readable (private, or deleted and unmerged) would name it to an outsider:
    -- answer as missing (2026-11-25, 2% sample: 194 of 748 public stubs point at one).
    IF NOT EXISTS (SELECT 1 FROM public.vehicles t WHERE t.id = v_redirect
                   AND public.vehicle_publicly_readable(t.is_public, t.deleted_at, t.merged_into_vehicle_id)) THEN
      RETURN NULL;
    END IF;
    RETURN json_build_object('vehicle', json_build_object('id', p_vehicle_id, 'merged_into_vehicle_id', v_redirect));
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
    'external_listings', CASE WHEN v_insider THEN (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el
      WHERE el.vehicle_id = p_vehicle_id
    ) ELSE (
      -- profile_external_listings_columns_v1: an insider reads the listing rows exactly as before (above). Anyone else
      -- reads only the external_listings columns the request role may SELECT (grants read at call time; auth.role()
      -- whitelisted, anything but 'authenticated' is anon), never reserve_price, and a listing with no such column is
      -- left out.
      SELECT COALESCE(json_agg(x.j ORDER BY x.created_at DESC), '[]'::json)
      FROM (
        SELECT el.created_at,
               (SELECT jsonb_object_agg(e.key, e.value)
                FROM jsonb_each(to_jsonb(el.*)) e
                JOIN pg_catalog.pg_attribute a
                  ON a.attrelid = 'public.external_listings'::regclass AND a.attname = e.key
                 AND a.attnum > 0 AND NOT a.attisdropped
                WHERE e.key <> 'reserve_price'
                  AND pg_catalog.has_column_privilege(
                        (SELECT CASE auth.role() WHEN 'authenticated' THEN 'authenticated' ELSE 'anon' END),
                        a.attrelid, a.attnum, 'SELECT'))::json AS j
        FROM public.external_listings el
        WHERE el.vehicle_id = p_vehicle_id
      ) x
      WHERE x.j IS NOT NULL
    ) END,
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
         position('profile_deleted_redirect_v1' in p.prosrc) > 0 AND position('profile_external_listings_columns_v1' in p.prosrc) > 0
           AND position('profile_timeline_private_sources_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.get_vehicle_profile_data(uuid)'::regprocedure;
  IF NOT (f.prosecdef AND f.provolatile = 'v' AND f.proconfig = ARRAY['search_path=public'] AND f.res = 'json'
          AND f.anon_x AND f.marked) THEN
    RAISE EXCEPTION 'get_vehicle_profile_data not as intended';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)'::regprocedure
                 AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql') AND NOT p.prosecdef
                 AND p.proconfig IS NULL AND p.provolatile = 'i'
                 AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'vehicle_publicly_readable not inlinable or not executable by anon';
  END IF;
END $check$;
COMMIT;

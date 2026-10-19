-- A vehicle's owner_name and owner_contact are a third party's personal details, now owner-only.
--
-- Live on 2026-10-14 (counts only, as the anon role): vehicles.owner_name was readable on 63 public vehicles and
-- owner_contact on 8, both through the publishable key at /rest/v1/vehicles and through the two whole-row readers,
-- which masked only the money (purchase_price, purchase_date, purchase_location). Since #1175 the vehicles table
-- grants SELECT by column (the table-wide SELECT is revoked from anon and authenticated), so these two columns were
-- among the ones re-granted.
--
-- After:
--   * vehicle_row_read and get_vehicle_profile_data null owner_name and owner_contact for every non-insider, beside
--     the money they already null. Insiders (owner, uploader, access holder, service role) still read them.
--   * SELECT on the two columns is revoked from anon and authenticated; every other vehicles column stays readable.
--     The owner still edits them through the vehicles UPDATE grant (unchanged), and reads them back through
--     vehicle_row_read. Nothing in the web selects them after #1209 (the last reader, an unused select, was dropped).
-- A third-party-contact column added to vehicles later is not readable by anon or authenticated until a migration
-- grants it, and should be added to both readers' mask.
-- Live reader bodies: supabase/sql/helpers/owner_contact_readers_live_20261014.sql.
-- Contract: supabase/sql/test_owner_contact_columns_owner_only.sql (CI job owner-contact-columns-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE
  v_vrr text;
  v_gvpd text;
BEGIN
  IF has_table_privilege('anon', 'public.vehicles', 'SELECT') THEN
    RAISE EXCEPTION 'vehicles still grants the table-wide SELECT to anon; 20261014093000 (#1175) must be live first';
  END IF;
  IF NOT (EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.vehicles'::regclass AND attname='owner_name' AND NOT attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.vehicles'::regclass AND attname='owner_contact' AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'vehicles.owner_name / owner_contact not found';
  END IF;
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'base64') INTO v_vrr FROM pg_proc WHERE oid = to_regprocedure('public.vehicle_row_read(uuid)');
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'base64') INTO v_gvpd FROM pg_proc WHERE oid = to_regprocedure('public.get_vehicle_profile_data(uuid)');
  IF v_vrr IS DISTINCT FROM 'y4yY4gXkVFTMKIU34vjwpbjfBg3fVYMQ/wYpqPBELD0=' AND v_vrr IS DISTINCT FROM 'v9AyXs0bf7DTqHbonvDuxagChbclcplB6b9/1rAxKi0=' THEN
    RAISE EXCEPTION 'vehicle_row_read differs from the reviewed definition (%)', v_vrr;
  END IF;
  IF v_gvpd IS DISTINCT FROM 'mWToLtKizvhnI1D4ZuzMeZRe/UaK6CW1b3FBt2UbdQg=' AND v_gvpd IS DISTINCT FROM 'gSQbPpb2Dl/WWZOVuJSS1CSCv74x/KPF05NwPf8FI1s=' THEN
    RAISE EXCEPTION 'get_vehicle_profile_data differs from the reviewed definition (%)', v_gvpd;
  END IF;
END $guard$;

-- The two readers, with owner_name and owner_contact added to the keys nulled for non-insiders (the only line that
CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
BEGIN
  SELECT to_jsonb(v.*),
         coalesce(v.is_public, false),
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  RETURN public.jsonb_mask_keys(v_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']);
END;
$function$;

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
                  ELSE public.jsonb_mask_keys(to_jsonb(v.*), ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact'])::json END
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
      'event_count', (SELECT COUNT(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'comment_count', (
        (SELECT COUNT(*) FROM public.vehicle_comments WHERE vehicle_id = p_vehicle_id) +
        (SELECT COUNT(*) FROM public.auction_comments WHERE vehicle_id = p_vehicle_id)
      ),
      'observation_count', (SELECT COUNT(*) FROM public.vehicle_observations WHERE vehicle_id = p_vehicle_id),
      'document_count', (
        SELECT COUNT(*) FROM public.vehicle_documents d
        WHERE d.vehicle_id = p_vehicle_id
          AND (v_insider OR d.uploaded_by = v_uid OR d.privacy_level = 'public')
      ),
      'last_activity', (SELECT MAX(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
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

REVOKE SELECT (owner_name, owner_contact) ON public.vehicles FROM anon, authenticated;

DO $check$
BEGIN
  IF has_column_privilege('anon', 'public.vehicles', 'owner_name', 'SELECT')
     OR has_column_privilege('anon', 'public.vehicles', 'owner_contact', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicles', 'owner_name', 'SELECT')
     OR has_column_privilege('authenticated', 'public.vehicles', 'owner_contact', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.vehicles', 'make', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.vehicles', 'owner_name', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.vehicles', 'UPDATE') THEN
    RAISE EXCEPTION 'owner contact column grants did not land as written';
  END IF;
END $check$;

COMMIT;

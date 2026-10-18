-- Public listing publication and vision inference are separate decisions.
-- This read predicate restores already published BaT listing images whose vision
-- status is still pending. It never writes a vision approval or alters evidence.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

-- One unnamed table-row argument exposes a PostgREST computed field. Callers
-- MUST constrain vehicle_id before filtering it; existing vehicle indexes bound
-- the image cohort. No generated column or 52-million-row backfill is needed.
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $fn$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND coalesce(($1).source='bat_import',false)
        AND ($1).is_external IS TRUE
        AND ($1).is_approved IS TRUE
        AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
        AND coalesce(($1).verification_status='approved',false)
        AND coalesce(($1).redaction_level::text='none',false)
        AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
        AND EXISTS (
          SELECT 1
          FROM public.vehicles v
          JOIN public.auction_events e ON e.vehicle_id=v.id
          WHERE v.id=($1).vehicle_id AND v.is_public IS TRUE
            AND e.source::text='bat'
            AND e.source_url ~* '^https://(www\.)?bringatrailer\.com/listing/[^/?#]+/?$'
            AND (
              (jsonb_typeof(($1).exif_data->'listing_urls')='array'
                AND (($1).exif_data->'listing_urls') ? e.source_url)
              OR rtrim(e.source_url,'/')=rtrim(($1).exif_data->>'discovery_url','/')
              OR rtrim(e.source_url,'/')=rtrim(($1).exif_data->>'source_url','/')
            )
        )
      ELSE false
    END;
$fn$;
COMMENT ON FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) IS
'Canonical gallery read predicate, filter by vehicle_id first. Excludes superseded, duplicate, document, explicit mismatch/unrelated and invalid/test/local URLs. Preserves NULL/approved vision eligibility under existing caller RLS and reader privacy checks. Pending is eligible only for nonsensitive publication-approved external BaT images on a public vehicle whose listing provenance matches that same vehicle auction event. Rejected/review-needed and pending private/user uploads remain excluded. Returns visibility eligibility, never a vision verdict; performs no writes. PostgREST computed field.';
REVOKE ALL ON FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) TO anon,authenticated,service_role;

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
    'vehicle', (
      SELECT row_to_json(v.*)
      FROM public.vehicles v
      WHERE v.id = p_vehicle_id
    ),
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
        SELECT * FROM public.timeline_events
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

COMMENT ON FUNCTION public.get_vehicle_profile_data(uuid) IS
'Existing privacy-authorized vehicle profile payload. Gallery images use vehicle_image_gallery_eligible consistently with the paginated frontend reader; published public BaT images can be displayed while vision remains pending. Existing 50-image payload limit and caller privacy authorization remain in place.';
NOTIFY pgrst, 'reload schema';

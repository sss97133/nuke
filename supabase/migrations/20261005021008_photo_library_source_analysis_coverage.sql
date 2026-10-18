-- Repair the existing owner stats reader; retain the inbox-scoped legacy fields.
-- Live SELECT reproduced 42P01 on vehicle_images with search_path=''.
-- Add owner-scoped source/output coverage, not an inference or backfill request.
BEGIN;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='10s';
CREATE OR REPLACE FUNCTION public.get_photo_library_stats(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result JSON;
BEGIN
  IF NOT (COALESCE(auth.uid() = p_user_id, false)
          OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Photo library requires its owner' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'total_photos', (
      SELECT COUNT(*)::INTEGER
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'unorganized_photos', (
      SELECT COUNT(*)::INTEGER
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
        AND (
          COALESCE(organization_status, 'unorganized') = 'unorganized'
          OR organization_status IS NULL
        )
    ),
    'organized_photos', (
      SELECT COUNT(*)::INTEGER
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND organization_status = 'organized'
    ),
    'pending_ai_processing', (
      SELECT COUNT(*)::INTEGER
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
        AND ai_processing_status IN ('pending', 'processing')
    ),
    'ai_suggestions_count', (
      SELECT COUNT(*)::INTEGER
      FROM public.vehicle_suggestions
      WHERE user_id = p_user_id
        AND status = 'pending'
    ),
    'total_file_size', (
      SELECT COALESCE(SUM(file_size), 0)::BIGINT
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'ai_status_breakdown', (
      SELECT json_build_object(
        'complete', COUNT(*) FILTER (WHERE ai_processing_status IN ('complete', 'completed'))::INTEGER,
        'pending', COUNT(*) FILTER (WHERE ai_processing_status = 'pending')::INTEGER,
        'processing', COUNT(*) FILTER (WHERE ai_processing_status = 'processing')::INTEGER,
        'failed', COUNT(*) FILTER (WHERE ai_processing_status = 'failed')::INTEGER
      )
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'angle_breakdown', (
      SELECT json_build_object(
        'front', COUNT(*) FILTER (WHERE ai_detected_angle ILIKE '%front%')::INTEGER,
        'rear', COUNT(*) FILTER (WHERE ai_detected_angle ILIKE '%rear%')::INTEGER,
        'side', COUNT(*) FILTER (WHERE ai_detected_angle ILIKE '%side%')::INTEGER,
        'interior', COUNT(*) FILTER (WHERE ai_detected_angle = 'interior')::INTEGER,
        'engine_bay', COUNT(*) FILTER (WHERE ai_detected_angle = 'engine_bay')::INTEGER,
        'undercarriage', COUNT(*) FILTER (WHERE ai_detected_angle = 'undercarriage')::INTEGER,
        'detail', COUNT(*) FILTER (WHERE ai_detected_angle = 'detail')::INTEGER
      )
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'vehicle_detection', (
      SELECT json_build_object(
        'found', COUNT(*) FILTER (WHERE ai_detected_vehicle IS NOT NULL)::INTEGER,
        'not_found', COUNT(*) FILTER (WHERE ai_detected_vehicle IS NULL)::INTEGER
      )
      FROM public.vehicle_images
      WHERE user_id = p_user_id
        AND vehicle_id IS NULL
    ),
    'source_analysis', (
      WITH images AS MATERIALIZED (
        SELECT id, source, ai_processing_status, file_hash, is_duplicate, superseded_at,
               is_sensitive, created_at, taken_at
        FROM public.vehicle_images WHERE user_id = p_user_id
      ), analysis AS (
        SELECT a.image_id, count(*) AS records,
          count(*) FILTER (WHERE a.superseded_at IS NULL) AS current_records,
          count(*) FILTER (WHERE a.citation_count > 0) AS cited_records,
          count(*) FILTER (WHERE a.analyzed_by_model IS NULL OR a.analyzed_at IS NULL OR a.overall_confidence IS NULL) AS missing_method_records,
          max(a.analyzed_at) AS last_analyzed_at
        FROM public.image_analysis_records a JOIN images i ON i.id = a.image_id
        GROUP BY a.image_id
      ), work AS (
        SELECT w.image_id FROM public.image_work_extractions w JOIN images i ON i.id = w.image_id
        GROUP BY w.image_id
      ), witnesses AS (
        SELECT w.image_id, count(*) AS records
        FROM public.observation_witnesses w JOIN images i ON i.id = w.image_id GROUP BY w.image_id
      ), recent AS MATERIALIZED (
        SELECT i.id, i.ai_processing_status, i.created_at,
               v.ai_scan_metadata->>'classifier_failed' = 'true' AS classifier_failed
        FROM images i JOIN public.vehicle_images v ON v.id = i.id
        ORDER BY i.created_at DESC NULLS LAST, i.id DESC LIMIT 100
      )
      SELECT jsonb_build_object(
        'grain', 'owner_image_rows', 'computed_at', now(), 'device_library_coverage', NULL,
        'records', count(*),
        'distinct_hashed_files', count(DISTINCT i.file_hash),
        'without_hash', count(*) FILTER (WHERE i.file_hash IS NULL),
        'marked_duplicates', count(*) FILTER (WHERE i.is_duplicate IS TRUE),
        'superseded', count(*) FILTER (WHERE i.superseded_at IS NOT NULL),
        'sensitive', count(*) FILTER (WHERE i.is_sensitive IS TRUE),
        'marked_complete', count(*) FILTER (WHERE i.ai_processing_status IN ('complete','completed')),
        'marked_failed', count(*) FILTER (WHERE i.ai_processing_status = 'failed'),
        'images_with_analysis_records', count(a.image_id),
        'images_with_current_analysis', count(*) FILTER (WHERE a.current_records > 0),
        'analysis_records', COALESCE(sum(a.records),0),
        'current_analysis_records', COALESCE(sum(a.current_records),0),
        'cited_analysis_records', COALESCE(sum(a.cited_records),0),
        'analysis_records_missing_method', COALESCE(sum(a.missing_method_records),0),
        'images_with_work_extractions', count(w.image_id),
        'images_with_witnesses', count(ow.image_id),
        'witness_records', COALESCE(sum(ow.records),0),
        'latest_ingested_at', max(i.created_at), 'latest_recorded_capture_at', max(i.taken_at),
        'latest_analysis_record_at', max(a.last_analyzed_at),
        'accuracy', NULL,
        'reviewed_classifications', (
          SELECT jsonb_build_object('items',count(*),
            'verified',count(*) FILTER (WHERE classification_verified IS TRUE),
            'agrees',count(*) FILTER (WHERE classification_verified IS TRUE AND classification_category = verified_category),
            'differs',count(*) FILTER (WHERE classification_verified IS TRUE AND classification_category IS DISTINCT FROM verified_category),
            'missing_review_actor_or_clock',count(*) FILTER (WHERE classification_verified IS TRUE AND (verified_by IS NULL OR verified_at IS NULL)))
          FROM public.photo_sync_items WHERE user_id=p_user_id
        ),
        'recent', (SELECT jsonb_build_object('sample_size',count(*),
          'failed',count(*) FILTER (WHERE r.ai_processing_status='failed'),
          'pending',count(*) FILTER (WHERE r.ai_processing_status='pending'),
          'classifier_failed',count(*) FILTER (WHERE r.classifier_failed IS TRUE),
          'with_analysis_records',count(a.image_id),'with_work_extractions',count(w.image_id),
          'with_witnesses',count(ow.image_id))
          FROM recent r LEFT JOIN analysis a ON a.image_id=r.id
          LEFT JOIN work w ON w.image_id=r.id LEFT JOIN witnesses ow ON ow.image_id=r.id),
        'sources', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.records DESC,s.source),'[]'::jsonb) FROM (
          SELECT COALESCE(i.source,'unspecified') AS source, count(*) AS records,
            count(a.image_id) AS with_analysis_records,
            count(w.image_id) AS with_work_extractions,
            count(ow.image_id) AS with_witnesses,
            count(*) FILTER (WHERE i.ai_processing_status IN ('complete','completed')) AS marked_complete,
            count(*) FILTER (WHERE i.ai_processing_status='failed') AS marked_failed,
            max(i.created_at) AS latest_ingested_at, max(a.last_analyzed_at) AS latest_analysis_record_at
          FROM images i LEFT JOIN analysis a ON a.image_id=i.id
          LEFT JOIN work w ON w.image_id=i.id LEFT JOIN witnesses ow ON ow.image_id=i.id
          GROUP BY COALESCE(i.source,'unspecified')
        ) s),
        'limits', 'Image rows are not a reconciled device inventory. Analysis-record, work-extraction and witness populations overlap; the analysis-record store is not every analysis pipeline. Processing status is not durable output or calibrated accuracy. Verified categories are a selected review subset.'
      )
      FROM images i LEFT JOIN analysis a ON a.image_id=i.id
      LEFT JOIN work w ON w.image_id=i.id LEFT JOIN witnesses ow ON ow.image_id=i.id
    )
  ) INTO result;
  
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_photo_library_stats(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_photo_library_stats(uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.get_photo_library_stats(uuid) IS
 'Owner-only live photo-library reader. Legacy total_photos/status/size/detection describe the unassigned inbox; organized_photos retains its existing organization-status scope. source_analysis covers every captured owner image row, with independently aggregated durable analysis, work and witness stores, explicit clocks and bounded newest-100 failures. No device-library completeness or classification accuracy inferred. Zero processing, identity reassignment or testimony writes.';
NOTIFY pgrst,'reload schema';
COMMIT;

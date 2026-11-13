-- Revert 20261112170000: restore the frame-filing step (20261112160000 body), the first tick and view (20261112130000), and drop the
-- page landing columns (the step's own bookkeeping; text reads it recorded stay).
DROP VIEW IF EXISTS public.capture_document_pages_to_land;
CREATE OR REPLACE FUNCTION public.capture_documents_land_by_vin(p_user uuid, p_run uuid DEFAULT gen_random_uuid(),
                                                                p_dry boolean DEFAULT true, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c record; tgt uuid; reason text; v_items jsonb := '[]'; v_reads jsonb := '[]'; v_cands jsonb := '[]';
  v_skipped jsonb := '[]'; v_read jsonb; v_apply jsonb;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'capture_documents_land_by_vin: p_user required'; END IF;
  FOR c IN
    SELECT cdp.image_id, cdp.doc_type, vi.taken_at,
           upper(regexp_replace(cdp.extraction->>'vin', '[^A-Za-z0-9]', '', 'g')) AS vin,
           coalesce(CASE WHEN cdp.extraction->>'confidence' ~ '^[0-9]+(\.[0-9]+)?$' THEN (cdp.extraction->>'confidence')::numeric END,
                    cdp.class_conf, 0) AS conf
    FROM public.capture_document_pages cdp
    JOIN public.vehicle_images vi ON vi.id = cdp.image_id
    WHERE cdp.user_id = p_user AND cdp.revoked_at IS NULL AND vi.user_id = p_user AND vi.vehicle_id IS NULL
      AND NOT coalesce(vi.is_duplicate, false) AND NOT coalesce(vi.is_sensitive, false)
      AND vi.vision_gate_status::text NOT IN ('rejected_personal', 'rejected_misattributed')
      AND cdp.extraction->>'vin' ~ '^[A-HJ-NPR-Za-hj-npr-z0-9 -]{11,20}$'
    ORDER BY vi.taken_at NULLS LAST, cdp.image_id
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
  LOOP
    -- Exactly one current vehicle with that VIN, read on idx_vehicles_vin_upper (upper(vin) WHERE vin IS NOT NULL AND
    -- deleted_at IS NULL); find_vehicle_by_vin(vin, true) normalises with a regexp no index serves and scans 1.4M rows.
    SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END INTO tgt
    FROM (SELECT v.id FROM public.vehicles v WHERE upper(v.vin) = c.vin AND v.vin IS NOT NULL AND v.deleted_at IS NULL
          AND v.status IS DISTINCT FROM 'merged' LIMIT 2) u;
    reason := CASE
      WHEN c.conf < 0.6 THEN 'low_confidence'
      WHEN length(c.vin) = 17 AND NOT public.vin_check_digit_ok(c.vin) THEN 'check_digit_failed'
      WHEN length(c.vin) < 11 THEN 'vin_too_short'
      WHEN tgt IS NULL THEN 'no_unique_vehicle'
      WHEN NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = tgt AND (v.owner_id = p_user OR v.user_id = p_user)
                         AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) THEN 'vehicle_not_held_by_user'
      WHEN public.receipt_user_vehicle_tie(p_user, tgt) IS NULL THEN 'no_tie'
      ELSE NULL END;
    IF reason IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('image_id', c.image_id, 'doc_type', c.doc_type, 'reason', reason,
                                                   'vehicle_id', tgt);
      CONTINUE;
    END IF;
    v_cands := v_cands || jsonb_build_object('image_id', c.image_id, 'doc_type', c.doc_type, 'vehicle_id', tgt,
                                             'confidence', c.conf, 'taken_at', c.taken_at);
    v_reads := v_reads || jsonb_build_object('image_id', c.image_id, 'is_document', true,
                 'vin_candidates', jsonb_build_array(jsonb_build_object('vin', c.vin, 'confidence', c.conf,
                                                     'source', 'capture_document_pages', 'doc_type', c.doc_type)));
    v_items := v_items || jsonb_build_object('set_key', 'document:' || c.image_id, 'vehicle_id', tgt,
                 'segment_ids', jsonb_build_array(c.image_id), 'image_ids', jsonb_build_array(c.image_id),
                 'confidence', c.conf, 'basis', 'vin_read',
                 'evidence', jsonb_build_object('source', 'capture_document_pages', 'doc_type', c.doc_type, 'vin', c.vin));
  END LOOP;
  IF NOT p_dry AND jsonb_array_length(v_items) > 0 THEN
    v_read := public.record_image_text_reads(p_run, 'agent:subscription-document-reader', 'capture_document_pages_vin_v1', v_reads);
    v_apply := public.capture_sets_apply(p_run, p_user, v_items, 0.6);
  END IF;
  RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'candidates', jsonb_array_length(v_items), 'skipped', v_skipped,
                            'items', v_cands, 'text_reads', v_read, 'apply', v_apply);
END $$;


CREATE OR REPLACE FUNCTION public.capture_documents_land_by_vin_tick(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u record; v_out jsonb := '[]'; v_res jsonb;
BEGIN
  FOR u IN
    SELECT DISTINCT cdp.user_id FROM public.capture_document_pages cdp JOIN public.vehicle_images vi ON vi.id = cdp.image_id
    WHERE cdp.revoked_at IS NULL AND vi.vehicle_id IS NULL AND cdp.extraction->>'vin' ~ '^[A-HJ-NPR-Za-hj-npr-z0-9 -]{11,20}$'
    ORDER BY 1 LIMIT 5
  LOOP
    BEGIN
      v_res := public.capture_documents_land_by_vin(u.user_id, gen_random_uuid(), false, p_limit);
      v_out := v_out || jsonb_build_object('user_id', u.user_id, 'run_id', v_res->'run_id', 'candidates', v_res->'candidates',
                 'filed', v_res#>'{apply,photos_filed}', 'refused', v_res#>'{apply,sets_refused}', 'skipped', jsonb_array_length(v_res->'skipped'));
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('user_id', u.user_id, 'error', left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('users', jsonb_array_length(v_out), 'runs', v_out);
END $$;


CREATE OR REPLACE VIEW public.capture_document_pages_to_land WITH (security_invoker = true) AS
SELECT cdp.image_id, cdp.user_id, vi.vehicle_id, cdp.doc_type, cdp.created_at AS page_at
FROM public.capture_document_pages cdp JOIN public.vehicle_images vi ON vi.id = cdp.image_id
WHERE cdp.revoked_at IS NULL AND vi.vehicle_id IS NOT NULL AND cdp.extraction->'landed' IS NULL;

REVOKE ALL ON public.capture_document_pages_to_land FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.capture_document_pages_to_land TO service_role;
ALTER TABLE public.capture_document_pages DROP COLUMN IF EXISTS landing_vehicle_id, DROP COLUMN IF EXISTS landing_basis, DROP COLUMN IF EXISTS landing_run_id;

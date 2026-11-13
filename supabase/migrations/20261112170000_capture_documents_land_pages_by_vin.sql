-- Capture documents: the page lands by its VIN, the frame stays where it is (2026-11-08, replaces the step of 20261112130000).
--
-- The first live pass showed the frame path cannot carry document pages: 39 of the owner's 40 VIN-bearing pages sit on
-- frames held as rejected_personal / rejected_misattributed (the document hold that keeps paper out of the public gallery),
-- which capture_sets_apply refuses by design, and attribute_testimony requires a passed visual gate per run. A photographed
-- title is private paper about a vehicle, not a photo of it: the page belongs on the vehicle's record, the frame stays held.
--
-- So the step now resolves the VIN and records the landing on the page itself:
--   capture_document_pages.landing_vehicle_id / landing_basis / landing_run_id (basis 'vin:document_page'),
-- after recording the VIN as a text read of the frame (record_image_text_reads, contributor
-- agent:subscription-document-reader) so the capture scorer's vin leg still sees it. It no longer calls capture_sets_apply.
-- capture_document_pages_to_land exposes coalesce(frame vehicle, page landing vehicle); the document route lands the page
-- on that vehicle (land_document_pages checks the custodian's tie) and writes extraction.landed.
-- Rules unchanged: a vehicle the user holds, a valid check digit on 17-character VINs, 11+ characters, confidence >= 0.6,
-- exactly one current unmerged vehicle, read on idx_vehicles_vin_upper.
-- Revert: supabase/sql/revert_20261112170000_capture_documents_land_pages_by_vin.sql. Test: supabase/sql/test_capture_documents_land_by_vin.sql.

ALTER TABLE public.capture_document_pages
  ADD COLUMN IF NOT EXISTS landing_vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS landing_basis text,
  ADD COLUMN IF NOT EXISTS landing_run_id uuid;
COMMENT ON COLUMN public.capture_document_pages.landing_vehicle_id IS 'Vehicle the page lands on when its frame has none: resolved by capture_documents_land_by_vin from the page''s VIN (landing_basis, landing_run_id say how).';

CREATE OR REPLACE FUNCTION public.capture_documents_land_by_vin(p_user uuid, p_run uuid DEFAULT gen_random_uuid(),
                                                                p_dry boolean DEFAULT true, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c record; tgt uuid; reason text; v_reads jsonb := '[]'; v_cands jsonb := '[]'; v_skipped jsonb := '[]';
  v_ids uuid[] := '{}'; v_vehicles uuid[] := '{}'; v_read jsonb; n_pages int := 0;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'capture_documents_land_by_vin: p_user required'; END IF;
  FOR c IN
    SELECT cdp.image_id, cdp.doc_type, vi.taken_at,
           upper(regexp_replace(cdp.extraction->>'vin', '[^A-Za-z0-9]', '', 'g')) AS vin,
           coalesce(CASE WHEN cdp.extraction->>'confidence' ~ '^[0-9]+(\.[0-9]+)?$' THEN (cdp.extraction->>'confidence')::numeric END,
                    cdp.class_conf, 0) AS conf
    FROM public.capture_document_pages cdp
    JOIN public.vehicle_images vi ON vi.id = cdp.image_id
    WHERE cdp.user_id = p_user AND cdp.revoked_at IS NULL AND vi.user_id = p_user
      AND vi.vehicle_id IS NULL AND cdp.landing_vehicle_id IS NULL
      AND cdp.extraction->>'vin' ~ '^[A-HJ-NPR-Za-hj-npr-z0-9 -]{11,20}$'
    ORDER BY vi.taken_at NULLS LAST, cdp.image_id
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
  LOOP
    -- Exactly one current vehicle with that VIN, read on idx_vehicles_vin_upper.
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
      v_skipped := v_skipped || jsonb_build_object('image_id', c.image_id, 'doc_type', c.doc_type, 'reason', reason, 'vehicle_id', tgt);
      CONTINUE;
    END IF;
    v_cands := v_cands || jsonb_build_object('image_id', c.image_id, 'doc_type', c.doc_type, 'vehicle_id', tgt,
                                             'confidence', c.conf, 'taken_at', c.taken_at);
    v_reads := v_reads || jsonb_build_object('image_id', c.image_id, 'is_document', true,
                 'vin_candidates', jsonb_build_array(jsonb_build_object('vin', c.vin, 'confidence', c.conf,
                                                     'source', 'capture_document_pages', 'doc_type', c.doc_type)));
    v_ids := v_ids || c.image_id; v_vehicles := v_vehicles || tgt;
  END LOOP;
  IF NOT p_dry AND cardinality(v_ids) > 0 THEN
    v_read := public.record_image_text_reads(p_run, 'agent:subscription-document-reader', 'capture_document_pages_vin_v1', v_reads);
    UPDATE public.capture_document_pages cdp
       SET landing_vehicle_id = x.vehicle_id, landing_basis = 'vin:document_page', landing_run_id = p_run
      FROM unnest(v_ids, v_vehicles) AS x(image_id, vehicle_id)
     WHERE cdp.image_id = x.image_id AND cdp.landing_vehicle_id IS NULL;
    GET DIAGNOSTICS n_pages = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('run_id', p_run, 'dry', p_dry, 'candidates', jsonb_array_length(v_cands), 'pages_resolved', n_pages,
                            'skipped', v_skipped, 'items', v_cands, 'text_reads', v_read);
END $$;

CREATE OR REPLACE FUNCTION public.capture_documents_land_by_vin_tick(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u record; v_out jsonb := '[]'; v_res jsonb;
BEGIN
  FOR u IN
    SELECT DISTINCT cdp.user_id FROM public.capture_document_pages cdp JOIN public.vehicle_images vi ON vi.id = cdp.image_id
    WHERE cdp.revoked_at IS NULL AND vi.vehicle_id IS NULL AND cdp.landing_vehicle_id IS NULL
      AND cdp.extraction->>'vin' ~ '^[A-HJ-NPR-Za-hj-npr-z0-9 -]{11,20}$'
    ORDER BY 1 LIMIT 5
  LOOP
    BEGIN
      v_res := public.capture_documents_land_by_vin(u.user_id, gen_random_uuid(), false, p_limit);
      v_out := v_out || jsonb_build_object('user_id', u.user_id, 'run_id', v_res->'run_id', 'candidates', v_res->'candidates',
                 'pages_resolved', v_res->'pages_resolved', 'skipped', jsonb_array_length(v_res->'skipped'));
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('user_id', u.user_id, 'error', left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('users', jsonb_array_length(v_out), 'runs', v_out);
END $$;

-- Pages ready for the document route: a vehicle from the frame or from the page's own VIN landing, no landed marker yet.
-- (dropped and recreated: the column list changes)
DROP VIEW IF EXISTS public.capture_document_pages_to_land;
CREATE VIEW public.capture_document_pages_to_land WITH (security_invoker = true) AS
SELECT cdp.image_id, cdp.user_id, coalesce(vi.vehicle_id, cdp.landing_vehicle_id) AS vehicle_id,
       CASE WHEN vi.vehicle_id IS NOT NULL THEN 'frame' ELSE cdp.landing_basis END AS basis,
       cdp.doc_type, cdp.created_at AS page_at
FROM public.capture_document_pages cdp JOIN public.vehicle_images vi ON vi.id = cdp.image_id
WHERE cdp.revoked_at IS NULL AND coalesce(vi.vehicle_id, cdp.landing_vehicle_id) IS NOT NULL AND cdp.extraction->'landed' IS NULL;
REVOKE ALL ON public.capture_document_pages_to_land FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.capture_document_pages_to_land TO service_role;

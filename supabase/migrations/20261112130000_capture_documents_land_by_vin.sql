-- Capture documents land by VIN (2026-11-08).
--
-- The subscription document reader records a page for every photographed document (capture_document_pages). A page whose
-- frame has no vehicle waits: lone document frames never form a capture set, so the set-based landing loop cannot place
-- them, and 406 of the owner's 418 pages were waiting on 2026-11-08. Titles, registrations and sale sheets print the VIN.
--
-- This step lands such a frame by its VIN through the existing writers, never by hand:
--   1. the page's VIN is recorded as a text read of the frame (record_image_text_reads, contributor
--      agent:subscription-document-reader, method capture_document_pages_vin_v1) so the capture scorer's vin leg and the
--      apply writer's 'vin_read' basis both see it;
--   2. find_vehicle_by_vin(vin, require_unique) resolves the vehicle; it must be held by the user (vehicles.owner_id or
--      user_id, as capture_sets_apply requires) and tied by receipt_user_vehicle_tie; a 17-character VIN must pass the
--      check digit; a pre-1981 serial needs an exact unique match of 11+ characters; the page's confidence must be >= 0.6;
--   3. capture_sets_apply files the frame (attribute_testimony + a capture_set_links row, revertible by capture_sets_revert).
-- Pages whose frames now hold a vehicle are listed by capture_document_pages_to_land for the document route to land from
-- the stored page; a page the route has landed, or recorded as a vehicle document, carries extraction.landed. The tick runs every 10 minutes for every user with
-- waiting VIN pages. Dry runs report what would land and write nothing.
-- Revert: supabase/sql/revert_20261112130000_capture_documents_land_by_vin.sql. Test: supabase/sql/test_capture_documents_land_by_vin.sql.

-- 1. The reader as a contributor (an agent; its reads carry its key).
INSERT INTO public.contributors (contributor_type, agent_key, agent_version, status)
SELECT 'agent', 'agent:subscription-document-reader', 'claude-cli sonnet', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.contributors WHERE agent_key = 'agent:subscription-document-reader');

-- 2. The step.
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
    tgt := public.find_vehicle_by_vin(c.vin, true);
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

-- 3. The tick: every user with waiting VIN pages, a bounded batch each.
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

-- 4. Pages ready for the document route: the frame holds a vehicle; the route has not yet landed the page (as a receipt)
--    or recorded it as a vehicle document (extraction.landed = {as, receipt_id?, at}).
CREATE OR REPLACE VIEW public.capture_document_pages_to_land WITH (security_invoker = true) AS
SELECT cdp.image_id, cdp.user_id, vi.vehicle_id, cdp.doc_type, cdp.created_at AS page_at
FROM public.capture_document_pages cdp JOIN public.vehicle_images vi ON vi.id = cdp.image_id
WHERE cdp.revoked_at IS NULL AND vi.vehicle_id IS NOT NULL AND cdp.extraction->'landed' IS NULL;

-- 5. Grants: service side only.
REVOKE ALL ON FUNCTION public.capture_documents_land_by_vin(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_documents_land_by_vin_tick(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_documents_land_by_vin(uuid, uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_documents_land_by_vin_tick(integer) TO service_role;
REVOKE ALL ON public.capture_document_pages_to_land FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.capture_document_pages_to_land TO service_role;

-- 6. Schedule: every 10 minutes, offset from the capture-sets drain and the reader watch.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'capture-documents-land-by-vin';
SELECT cron.schedule('capture-documents-land-by-vin', '4-59/10 * * * *',
  $c$SET statement_timeout = '120s'; SELECT public.capture_documents_land_by_vin_tick(50);$c$);

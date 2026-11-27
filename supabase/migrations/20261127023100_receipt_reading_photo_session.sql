-- Follow the actual cited photo's session FK, not a same-day receipt candidate.
-- The caller is an existing gated SECURITY DEFINER reader; this helper is internal.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.receipt_work_reading_frame_context(p_vehicle_id uuid, p_image_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
  SELECT jsonb_build_object(
    'image_id', i.id,
    'photo_taken_at', i.taken_at,
    'session', CASE WHEN s.id IS NOT NULL AND
      (auth.role() = 'service_role' OR s.user_id = auth.uid()
       OR v.user_id = auth.uid() OR v.owner_id = auth.uid())
      THEN jsonb_build_object('id', s.id, 'session_date', s.session_date,
                              'title', s.title, 'session_type', s.session_type)
      ELSE NULL END)
    FROM public.vehicle_images i
    JOIN public.vehicles v ON v.id = i.vehicle_id
    LEFT JOIN public.work_sessions s ON s.id = i.work_session_id AND s.vehicle_id = i.vehicle_id
   WHERE i.id = p_image_id AND i.vehicle_id = p_vehicle_id
     AND public.receipt_work_frame_eligible(i) IS TRUE
     AND public.vehicle_image_gallery_eligible(i) IS TRUE
     AND (auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND
          ((v.is_public IS TRUE AND v.deleted_at IS NULL)
           OR auth.uid() IN (v.user_id, v.owner_id, v.uploaded_by))))
$fn$;

REVOKE ALL ON FUNCTION public.receipt_work_reading_frame_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_work_reading_frame_context(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.receipt_work_reading_frame_context(uuid, uuid) IS
  'Viewer-qualified cited photo and its actual session FK. A session photo does not prove item identity, installation or when work occurred.';

DO $patch$
DECLARE
  d text;
  current_anchor text := $old$                    'reading', 'a model''s reading of a proposed context, not an owner Sign or proof') END) END$old$;
  current_replacement text := $new$                    'reading', 'a model''s reading of a proposed context, not an owner Sign or proof',
                    'frame_context', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(f.shown) s
                                                         WHERE s ->> 'image_id' = j.answer ->> 'image_id')
                                          THEN public.receipt_work_reading_frame_context(p_vehicle_id,
                                            CASE WHEN j.answer ->> 'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                 THEN (j.answer ->> 'image_id')::uuid END) END) END) END$new$;
  old_anchor text := $old$          'reading', 'An older model reading of its original photo context, not proof.'),$old$;
  old_replacement text := $new$          'reading', 'An older model reading of its original photo context, not proof.',
          'frame_context', public.receipt_work_reading_frame_context(p_vehicle_id,
            CASE WHEN hj.answer ->> 'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN (hj.answer ->> 'image_id')::uuid END)),$new$;
  question_anchor text := $old$    SELECT * FROM qualified_questions WHERE qualification = 'current'$old$;
  question_replacement text := $new$    SELECT * FROM qualified_questions WHERE qualification = 'current'
      AND (auth.role() = 'service_role' OR EXISTS (
        SELECT 1 FROM public.vehicles pv WHERE pv.id = p_vehicle_id AND auth.uid() IS NOT NULL
          AND ((pv.is_public IS TRUE AND pv.deleted_at IS NULL)
               OR auth.uid() IN (pv.user_id, pv.owner_id, pv.uploaded_by))))$new$;
  frame_anchor text := $old$ON vi.id = x.id AND vi.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(vi) AND public.vehicle_image_gallery_eligible(vi)$old$;
  frame_replacement text := $new$ON vi.id = x.id AND vi.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(vi) AND public.vehicle_image_gallery_eligible(vi)
          AND (auth.role() = 'service_role' OR EXISTS (
            SELECT 1 FROM public.vehicles pv WHERE pv.id = p_vehicle_id AND auth.uid() IS NOT NULL
              AND ((pv.is_public IS TRUE AND pv.deleted_at IS NULL)
                   OR auth.uid() IN (pv.user_id, pv.owner_id, pv.uploaded_by))))$new$;
BEGIN
  d := pg_get_functiondef('public.get_vehicle_receipt_work_context(uuid,date)'::regprocedure);
  IF position('receipt_work_reading_frame_context' IN d) > 0 THEN RETURN; END IF;
  IF (length(d)-length(replace(d,current_anchor,'')))/length(current_anchor) <> 1
     OR (length(d)-length(replace(d,old_anchor,'')))/length(old_anchor) <> 1
     OR (length(d)-length(replace(d,question_anchor,'')))/length(question_anchor) <> 1
     OR (length(d)-length(replace(d,frame_anchor,'')))/length(frame_anchor) <> 1 THEN
    RAISE EXCEPTION 'receipt work reader changed; inspect cited-photo anchors';
  END IF;
  EXECUTE replace(replace(replace(replace(d,current_anchor,current_replacement),old_anchor,old_replacement),
                          question_anchor,question_replacement),frame_anchor,frame_replacement);
END
$patch$;

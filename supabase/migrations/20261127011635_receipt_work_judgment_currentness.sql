-- Qualify a receipt-part answer against the current keyed source context.
-- This patches the existing signed-in reader; it does not write or retire testimony.
-- A current receipt_work_lines context is computed once per distinct window/limit,
-- then joined by both the receipt link and item. Candidate-image order is immaterial.
-- Old, unrelated or unverifiable questions are not returned as current judgments.
-- Migration requires review of performance and live function drift before deployment.

SET lock_timeout = '5s';

-- One qualification shared by readers and folds. It returns keyed question ids,
-- not testimony or values, and executes once per distinct source window.
CREATE OR REPLACE FUNCTION public.receipt_work_judgment_qualification(p_vehicle_id uuid)
RETURNS TABLE(judgment_id uuid, receipt_item_id uuid, link_id uuid, qualification text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
  WITH candidate AS MATERIALIZED (
    SELECT j.*,
           CASE WHEN j.params #>> '{context,window_days}' IS NULL THEN 90
                WHEN j.params #>> '{context,window_days}' ~ '^[0-9]{1,4}$'
                  THEN (j.params #>> '{context,window_days}')::int END AS window_days,
           CASE WHEN j.params #>> '{context,max_images}' IS NULL THEN 8
                WHEN j.params #>> '{context,max_images}' ~ '^[0-9]{1,3}$'
                  THEN (j.params #>> '{context,max_images}')::int END AS max_images
      FROM public.evidence_judgment_requests j
     WHERE j.vehicle_id = p_vehicle_id AND j.receipt_item_id IS NOT NULL
       AND j.department = 'receipt_work_reconciliation' AND j.question_kind = 'receipt_part_visible'
       AND j.subject_table = 'receipt_items' AND j.status IN ('pending', 'claimed', 'answered')
       AND j.superseded_by IS NULL AND j.cancelled_at IS NULL
       AND jsonb_typeof(j.params -> 'context') = 'object'
       AND jsonb_typeof(j.params -> 'candidate_image_ids') = 'array'
       AND jsonb_typeof(j.params #> '{context,candidate_image_ids}') = 'array'
       AND CASE WHEN jsonb_typeof(j.params -> 'candidate_image_ids') = 'array'
                THEN jsonb_array_length(j.params -> 'candidate_image_ids') > 0 ELSE false END
       AND public.jsonb_text_array_set(j.params -> 'candidate_image_ids') =
           public.jsonb_text_array_set(j.params #> '{context,candidate_image_ids}')
       AND j.params ->> 'description' IS NOT DISTINCT FROM j.params #>> '{context,description}'
       AND j.params ->> 'part_number' IS NOT DISTINCT FROM j.params #>> '{context,part_number}'
       AND j.params ->> 'receipt_id' = j.params #>> '{context,receipt_id}'
       AND j.params ->> 'receipt_item_id' = j.receipt_item_id::text
       AND j.params ->> 'receipt_item_id' = j.params #>> '{context,item_id}'
       AND j.params ->> 'vehicle_id' = p_vehicle_id::text
       AND j.params -> 'total_price' IS NOT DISTINCT FROM j.params #> '{context,total_price}'
       AND j.params ->> 'purchase_date' IS NOT DISTINCT FROM j.params #>> '{context,anchor_date}'
       AND j.params ->> 'anchor_source' IS NOT DISTINCT FROM j.params #>> '{context,anchor_source}'
       AND j.params ->> 'zone' IS NOT DISTINCT FROM j.params #>> '{context,zone}'
       AND j.params ->> 'end_hint' IS NOT DISTINCT FROM j.params #>> '{context,end_hint}'
       AND j.params #> '{printed_claims,line_date}' IS NOT DISTINCT FROM j.params #> '{context,printed_line_date}'
       AND j.params #> '{printed_claims,hours}' IS NOT DISTINCT FROM j.params #> '{context,printed_hours}'
       AND j.params #> '{printed_claims,performer}' IS NOT DISTINCT FROM j.params #> '{context,printed_performer}'
  ), windows AS MATERIALIZED (
    SELECT DISTINCT window_days, max_images FROM candidate
     WHERE window_days BETWEEN 0 AND 3650 AND max_images BETWEEN 1 AND 100
  ), current_context AS MATERIALIZED (
    SELECT w.window_days, w.max_images, r.item_id, r.link_id, r.judgment_needed, r.question_context
      FROM windows w
      CROSS JOIN LATERAL public.receipt_work_lines(p_vehicle_id, w.window_days, w.max_images) r
  )
  SELECT j.id, j.receipt_item_id, c.link_id,
         CASE WHEN c.judgment_needed IS TRUE
                    AND public.jsonb_text_array_set(j.params #> '{context,candidate_image_ids}') =
                        public.jsonb_text_array_set(c.question_context -> 'candidate_image_ids')
                    AND j.params #> '{context,conclusion}' IS NOT DISTINCT FROM c.question_context -> 'conclusion'
              THEN 'current' ELSE 'historical_photo_context' END
    FROM candidate j JOIN current_context c ON c.window_days = j.window_days AND c.max_images = j.max_images
      AND c.item_id = j.receipt_item_id AND c.link_id::text = j.params #>> '{context,link_id}'
   WHERE (j.status = 'answered' OR (c.judgment_needed IS TRUE
          AND public.jsonb_text_array_set(j.params #> '{context,candidate_image_ids}') =
              public.jsonb_text_array_set(c.question_context -> 'candidate_image_ids')
          AND j.params #> '{context,conclusion}' IS NOT DISTINCT FROM c.question_context -> 'conclusion'))
     -- Counts and the first photo day can change while the exact frames asked
     -- about remain the same; those measurements do not change the answer.
     AND ((j.params -> 'context') - ARRAY['candidate_image_ids','zone_photos_total','zone_photos_in_window','first_photo_day','conclusion']) =
         (c.question_context - ARRAY['candidate_image_ids','zone_photos_total','zone_photos_in_window','first_photo_day','conclusion'])
     -- A fold must not convey an answer derived from a frame this viewer cannot see.
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(j.params #> '{context,candidate_image_ids}') x(image_id)
       LEFT JOIN public.vehicle_images i ON i.id = CASE
         WHEN x.image_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN x.image_id::uuid END
       WHERE i.id IS NULL OR i.vehicle_id IS DISTINCT FROM p_vehicle_id
          OR public.receipt_work_frame_eligible(i) IS NOT TRUE
          OR public.vehicle_image_gallery_eligible(i) IS NOT TRUE)
     AND (j.status <> 'answered' OR (jsonb_typeof(j.answer) = 'object'
          AND j.answer ->> 'visible' IN ('yes', 'no', 'cannot_tell')
          AND j.answer ->> 'installed' IN ('yes', 'no', 'cannot_tell')))
     -- Installation or non-installation is a conclusion about a visible part,
     -- not a deduction from a frame where the part cannot be seen.
     AND (j.status <> 'answered' OR coalesce(j.answer ->> 'installed', '') NOT IN ('yes', 'no')
          OR (j.answer ->> 'visible' = 'yes' AND j.answer ->> 'image_id' IS NOT NULL))
     AND (j.status <> 'answered'
       OR (j.answer ->> 'image_id' IS NULL AND coalesce(j.answer ->> 'visible', '') <> 'yes'
           AND coalesce(j.answer ->> 'installed', '') <> 'yes')
       OR EXISTS (SELECT 1 FROM public.vehicle_images i
                  WHERE i.id = CASE WHEN j.answer ->> 'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                    THEN (j.answer ->> 'image_id')::uuid END AND i.vehicle_id = p_vehicle_id
                    AND i.id::text = ANY (public.jsonb_text_array_set(j.params #> '{context,candidate_image_ids}'))
                    AND public.receipt_work_frame_eligible(i) AND public.vehicle_image_gallery_eligible(i)))
$fn$;
REVOKE ALL ON FUNCTION public.receipt_work_judgment_qualification(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_work_judgment_qualification(uuid) TO service_role;
COMMENT ON FUNCTION public.receipt_work_judgment_qualification(uuid) IS
  'Keyed receipt-part questions classified as current or historical photo context. Historical answers retain their original frame scope; neither state proves installation or source-byte continuity.';

CREATE OR REPLACE FUNCTION public.receipt_work_current_judgments(p_vehicle_id uuid)
RETURNS TABLE(judgment_id uuid, receipt_item_id uuid, link_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
  SELECT q.judgment_id, q.receipt_item_id, q.link_id
    FROM public.receipt_work_judgment_qualification(p_vehicle_id) q
   WHERE q.qualification = 'current'
$fn$;
REVOKE ALL ON FUNCTION public.receipt_work_current_judgments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_work_current_judgments(uuid) TO service_role;
COMMENT ON FUNCTION public.receipt_work_current_judgments(uuid) IS
  'Current receipt-part questions keyed to their current item, link and viewer-eligible frame set. A model answer remains testimony, not proof.';

DO $patch$
DECLARE
  d text;
  old_cte text := $old$  judgment AS (
    SELECT DISTINCT ON (j.subject_id) j.*
      FROM evidence_judgment_requests j
     WHERE EXISTS (SELECT 1 FROM gate)
       AND j.vehicle_id = p_vehicle_id AND j.status IN ('pending', 'claimed', 'answered')
       AND j.subject_id IN (SELECT item_id FROM ev WHERE item_id IS NOT NULL)
     ORDER BY j.subject_id, (j.status = 'answered') DESC, j.created_at DESC
  ),$old$;
  new_cte text := $new$  qualified_questions AS MATERIALIZED (
    SELECT q.* FROM gate g
    CROSS JOIN LATERAL public.receipt_work_judgment_qualification(p_vehicle_id) q
  ),
  current_questions AS MATERIALIZED (
    SELECT * FROM qualified_questions WHERE qualification = 'current'
  ),
  judgment AS (
    SELECT DISTINCT ON (e.id) j.*, e.id AS evidence_id
      FROM ev e
      JOIN current_questions q ON q.receipt_item_id = e.item_id AND q.link_id = e.link_id
      JOIN evidence_judgment_requests j ON j.id = q.judgment_id
     WHERE e.receipt_id::text = j.params #>> '{context,receipt_id}'
       AND e.evidence ->> 'description' IS NOT DISTINCT FROM j.params #>> '{context,description}'
       AND e.evidence ->> 'part_number' IS NOT DISTINCT FROM j.params #>> '{context,part_number}'
       AND e.evidence -> 'total_price' IS NOT DISTINCT FROM j.params #> '{context,total_price}'
       AND e.evidence #> '{printed_claims,line_date}' IS NOT DISTINCT FROM j.params #> '{context,printed_line_date}'
       AND e.evidence #> '{printed_claims,hours}' IS NOT DISTINCT FROM j.params #> '{context,printed_hours}'
       AND e.evidence #> '{printed_claims,performer}' IS NOT DISTINCT FROM j.params #> '{context,printed_performer}'
       AND public.jsonb_text_array_set(to_jsonb(e.image_ids)) =
           public.jsonb_text_array_set(j.params #> '{context,candidate_image_ids}')
     ORDER BY e.id, (j.status = 'answered') DESC, j.created_at DESC, j.id DESC
  ),
  historical_judgment AS (
    SELECT DISTINCT ON (e.id) j.*, e.id AS evidence_id
      FROM ev e
      JOIN qualified_questions q ON q.receipt_item_id = e.item_id AND q.link_id = e.link_id
                                AND q.qualification = 'historical_photo_context'
      JOIN evidence_judgment_requests j ON j.id = q.judgment_id AND j.status = 'answered'
     -- This SECURITY DEFINER reader bypasses image-table RLS. Vehicle grants
     -- alone do not confer image access, so historical frames are shown only
     -- when the public-vehicle or vehicle-owner image policy applies.
     WHERE EXISTS (SELECT 1 FROM public.vehicles v
                    WHERE v.id = p_vehicle_id AND (auth.role() = 'service_role' OR v.is_public IS TRUE
                      OR auth.uid() IN (v.user_id, v.owner_id, v.uploaded_by)))
       AND e.receipt_id::text = j.params #>> '{context,receipt_id}'
       AND e.evidence ->> 'description' IS NOT DISTINCT FROM j.params #>> '{context,description}'
       AND e.evidence ->> 'part_number' IS NOT DISTINCT FROM j.params #>> '{context,part_number}'
       AND e.evidence -> 'total_price' IS NOT DISTINCT FROM j.params #> '{context,total_price}'
       AND e.evidence #> '{printed_claims,line_date}' IS NOT DISTINCT FROM j.params #> '{context,printed_line_date}'
       AND e.evidence #> '{printed_claims,hours}' IS NOT DISTINCT FROM j.params #> '{context,printed_hours}'
       AND e.evidence #> '{printed_claims,performer}' IS NOT DISTINCT FROM j.params #> '{context,printed_performer}'
     ORDER BY e.id, j.created_at DESC, j.id DESC
  ),$new$;
  old_join text := 'LEFT JOIN judgment j ON j.subject_id = e.item_id';
  new_join text := E'LEFT JOIN judgment j ON j.evidence_id = e.id\n      LEFT JOIN historical_judgment hj ON hj.evidence_id = e.id';
  old_json text := $old$      'judgment', CASE WHEN j.id IS NULL THEN NULL ELSE jsonb_build_object($old$;
  new_json text := $new$      'historical_judgment', CASE WHEN hj.id IS NULL THEN NULL ELSE jsonb_build_object(
        'question_id', hj.id,
        'status', 'answered',
        'reason', 'The photo context has changed since this reading.',
        'answer', jsonb_build_object(
          'visible', hj.answer ->> 'visible',
          'installed', hj.answer ->> 'installed',
          'confidence', (hj.answer ->> 'confidence')::numeric,
          'image_id', hj.answer ->> 'image_id',
          'quote', hj.answer ->> 'quote',
          'answered_at', hj.answered_at,
          'reading', 'An older model reading of its original photo context, not proof.'),
        'frame', (SELECT jsonb_build_object('image_id', vi.id, 'image_url', vi.image_url, 'taken_at', vi.taken_at)
                    FROM public.vehicle_images vi
                   WHERE vi.vehicle_id = p_vehicle_id AND vi.id::text = hj.answer ->> 'image_id'
                     AND public.receipt_work_frame_eligible(vi) AND public.vehicle_image_gallery_eligible(vi))) END,
      'judgment', CASE WHEN j.id IS NULL THEN NULL ELSE jsonb_build_object($new$;
  old_frame text := 'ON vi.id = x.id AND vi.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(vi)';
  new_frame text := 'ON vi.id = x.id AND vi.vehicle_id = p_vehicle_id AND receipt_work_frame_eligible(vi) AND public.vehicle_image_gallery_eligible(vi)';
BEGIN
  d := pg_get_functiondef('public.get_vehicle_receipt_work_context(uuid,date)'::regprocedure);
  IF position('current_questions AS MATERIALIZED' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, old_cte, ''))) / length(old_cte) <> 1
     OR (length(d) - length(replace(d, old_join, ''))) / length(old_join) <> 1
     OR (length(d) - length(replace(d, old_frame, ''))) / length(old_frame) <> 1
     OR (length(d) - length(replace(d, old_json, ''))) / length(old_json) <> 1 THEN
    RAISE EXCEPTION 'receipt work context reader changed; review before patching';
  END IF;
  EXECUTE replace(replace(replace(replace(d, old_cte, new_cte), old_join, new_join), old_frame, new_frame), old_json, new_json);
END
$patch$;

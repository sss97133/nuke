-- Restore evidence_judgment_ineligibility to the 20261111210500 body (order-sensitive candidate_image_ids).
DROP FUNCTION IF EXISTS public.jsonb_text_array_set(jsonb);

CREATE OR REPLACE FUNCTION public.evidence_judgment_ineligibility(p_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE j evidence_judgment_requests; probs text[] := '{}'; it receipt_items; rc receipts; x vehicle_images; cid text; rid uuid;
  lid uuid; ctx jsonb; cur record; diff text[];
BEGIN
  SELECT * INTO j FROM evidence_judgment_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN ARRAY['no_request']; END IF;
  IF j.question_kind <> 'receipt_part_visible' THEN RETURN ARRAY['unknown_question_kind']; END IF;
  ctx := j.params -> 'context';
  rid := coalesce(ctx ->> 'receipt_id', j.params ->> 'receipt_id')::uuid;
  lid := coalesce(ctx ->> 'link_id', j.params #>> '{lineage,link_id}')::uuid;
  SELECT * INTO rc FROM receipts WHERE id = rid;
  IF NOT FOUND THEN probs := array_append(probs, 'receipt_removed');
  ELSE
    IF rc.is_superseded THEN probs := array_append(probs, 'receipt_superseded'); END IF;
    IF rc.duplicate_of IS NOT NULL THEN probs := array_append(probs, 'receipt_duplicate'); END IF;
  END IF;
  IF lid IS NULL OR NOT EXISTS (SELECT 1 FROM receipt_vehicle_links l WHERE l.id = lid AND l.receipt_id = rid AND l.vehicle_id = j.vehicle_id
                                  AND l.status = 'linked' AND l.retired_at IS NULL) THEN
    probs := array_append(probs, 'link_retired');  -- the cited link, not any link
  END IF;
  SELECT * INTO it FROM receipt_items WHERE id = j.subject_id AND receipt_id = rid;
  IF NOT FOUND THEN probs := array_append(probs, 'line_removed');
  ELSIF it.description IS DISTINCT FROM j.params ->> 'description'
     OR it.part_number IS DISTINCT FROM j.params ->> 'part_number'
     OR it.total_price IS DISTINCT FROM (j.params ->> 'total_price')::numeric
     OR it.line_date IS DISTINCT FROM (j.params #>> '{printed_claims,line_date}')::date
     OR it.hours IS DISTINCT FROM (j.params #>> '{printed_claims,hours}')::numeric
     OR it.performer IS DISTINCT FROM j.params #>> '{printed_claims,performer}' THEN
    probs := array_append(probs, 'line_changed');
  END IF;
  FOR cid IN SELECT jsonb_array_elements_text(coalesce(j.params -> 'candidate_image_ids', '[]'::jsonb)) LOOP
    SELECT * INTO x FROM vehicle_images WHERE id = cid::uuid;
    IF NOT FOUND OR x.vehicle_id IS DISTINCT FROM j.vehicle_id OR NOT receipt_work_frame_eligible(x) THEN
      probs := array_append(probs, 'frame_ineligible:' || cid);
    END IF;
  END LOOP;
  IF jsonb_typeof(ctx) IS DISTINCT FROM 'object' THEN
    RETURN array_append(probs, 'context_unverifiable');
  END IF;
  IF ctx -> 'candidate_image_ids' IS DISTINCT FROM j.params -> 'candidate_image_ids' THEN
    probs := array_append(probs, 'context_mismatch:candidate_image_ids');  -- the question's frames are the context's frames
  END IF;
  SELECT w.question_context, w.judgment_needed INTO cur
    FROM receipt_work_lines(j.vehicle_id, coalesce((ctx ->> 'window_days')::int, 90), coalesce((ctx ->> 'max_images')::int, 8)) w
   WHERE w.item_id = j.subject_id AND w.link_id = lid;
  IF NOT FOUND THEN  -- the reader no longer returns this line through this link
    RETURN CASE WHEN cardinality(probs) > 0 THEN probs ELSE ARRAY['context_missing'] END;
  END IF;
  IF cur.judgment_needed IS NOT TRUE THEN probs := array_append(probs, 'not_asked'); END IF;
  SELECT array_agg(k ORDER BY k) INTO diff
    FROM (SELECT k FROM jsonb_object_keys(cur.question_context) k
          UNION SELECT k FROM jsonb_object_keys(ctx) k) keys
   WHERE cur.question_context -> k IS DISTINCT FROM ctx -> k;
  IF diff IS NOT NULL THEN probs := array_append(probs, 'context_changed:' || array_to_string(diff, ',')); END IF;
  RETURN probs;
END
$fn$;
REVOKE ALL ON FUNCTION public.evidence_judgment_ineligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evidence_judgment_ineligibility(uuid) TO service_role;

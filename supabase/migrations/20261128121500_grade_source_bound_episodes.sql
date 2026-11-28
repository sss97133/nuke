-- Do not grade a source-bound live prediction against another event for the same vehicle.
-- The existing grader owns auction_event_id and its outcome transition. This adds a refusal
-- condition for new receipts in notes, without changing the treatment of older predictions.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $repair$
DECLARE
  body text := pg_get_functiondef('public.grade_hammer_predictions_by_lot(integer,bigint)'::regprocedure);
  old_cand text := $old$h.predicted_low, h.predicted_hammer, h.predicted_high, h.scored_at, h.actual_hammer
      FROM public.hammer_predictions h$old$;
  new_cand text := $new$h.predicted_low, h.predicted_hammer, h.predicted_high, h.scored_at, h.actual_hammer,
             CASE WHEN h.notes IS JSON OBJECT THEN h.notes::jsonb ELSE '{}'::jsonb END AS source_receipt,
             coalesce(h.notes IS NOT JSON OBJECT AND (h.notes LIKE '%"source_event_id"%'
               OR h.notes LIKE '%"source_listing_url"%' OR h.notes LIKE '%"source_identity_basis"%'), false) AS malformed_source_receipt
      FROM public.hammer_predictions h$new$;
  old_fit text := $old$AND (NOT (lt.outcome = 'sold' AND lt.winning_bid > 0) OR c.current_bid <= lt.winning_bid * 1.01)) AS fits$old$;
  new_fit text := $new$AND (NOT (lt.outcome = 'sold' AND lt.winning_bid > 0) OR c.current_bid <= lt.winning_bid * 1.01)
              -- source-bound-grading-v1: a partial, malformed or different receipt cannot grade this row.
              AND NOT c.malformed_source_receipt
              AND (NOT (c.source_receipt ?| ARRAY['source_event_id','source_listing_url','source_identity_basis'])
                OR coalesce(c.source_receipt->>'source_identity_basis' IN ('retained_native_current_episode','canonical_native_fold')
                  AND CASE WHEN pg_input_is_valid(c.source_receipt->>'source_event_id', 'uuid')
                           THEN (c.source_receipt->>'source_event_id')::uuid END = lt.ae_id
                  AND lower(rtrim(c.source_receipt->>'source_listing_url', '/')) = 'https://bringatrailer.com/listing/' || lt.slug,
                  false))) AS fits$new$;
  prior_comment text := obj_description('public.grade_hammer_predictions_by_lot(integer,bigint)'::regprocedure, 'pg_proc');
BEGIN
  IF position('source-bound-grading-v1' IN body) > 0 THEN RETURN; END IF;
  IF (length(body)-length(replace(body,old_cand,'')))/length(old_cand) <> 1
     OR (length(body)-length(replace(body,old_fit,'')))/length(old_fit) <> 1 THEN
    RAISE EXCEPTION 'grade_hammer_predictions_by_lot source receipt anchors changed; no modification applied';
  END IF;
  body := replace(replace(body, old_cand, new_cand), old_fit, new_fit);
  EXECUTE body;
  EXECUTE format('COMMENT ON FUNCTION public.grade_hammer_predictions_by_lot(integer,bigint) IS %L',
    coalesce(prior_comment, '') || ' Source-bound predictions grade only to their exact recorded event and listing; partial or malformed source receipts are held.');
END
$repair$;
COMMIT;

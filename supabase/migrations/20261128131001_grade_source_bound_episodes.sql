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
  old_join text := $old$JOIN lot lt ON lt.slug = vs.slug
      LEFT JOIN sched sc ON sc.slug = lt.slug$old$;
  new_join text := $new$JOIN lot best ON best.slug = vs.slug
      -- The canonical receipt can identify an older raw row than a duplicate of the same lot.
      LEFT JOIN lotrows source_lot ON source_lot.slug = vs.slug AND source_lot.ae_id =
        CASE WHEN pg_input_is_valid(c.source_receipt->>'source_event_id', 'uuid')
             THEN (c.source_receipt->>'source_event_id')::uuid END
      CROSS JOIN LATERAL (
        SELECT best.slug, coalesce(source_lot.ae_id, best.ae_id) AS ae_id,
               CASE WHEN source_lot.ae_id IS NOT NULL THEN source_lot.outcome ELSE best.outcome END AS outcome,
               CASE WHEN source_lot.ae_id IS NOT NULL THEN source_lot.winning_bid ELSE best.winning_bid END AS winning_bid,
               CASE WHEN source_lot.ae_id IS NOT NULL THEN source_lot.auction_end_date ELSE best.auction_end_date END AS auction_end_date,
               best.n_hammers
      ) lt
      LEFT JOIN sched sc ON sc.slug = lt.slug$new$;
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
     OR (length(body)-length(replace(body,old_fit,'')))/length(old_fit) <> 1
     OR (length(body)-length(replace(body,old_join,'')))/length(old_join) <> 1 THEN
    RAISE EXCEPTION 'grade_hammer_predictions_by_lot source receipt anchors changed; no modification applied';
  END IF;
  body := replace(replace(replace(body, old_cand, new_cand), old_join, new_join), old_fit, new_fit);
  EXECUTE body;
  EXECUTE format('COMMENT ON FUNCTION public.grade_hammer_predictions_by_lot(integer,bigint) IS %L',
    coalesce(prior_comment, '') || ' Source-bound predictions grade only to their exact recorded event and listing; partial or malformed source receipts are held.');
END
$repair$;
COMMIT;

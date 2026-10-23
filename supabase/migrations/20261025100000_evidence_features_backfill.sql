-- Point-in-time feature backfill driver for queued vehicles (as_of = day after the BaT auction end, so
-- features only use evidence observed by the sale; listing claims are stamped with the auction end date).
ALTER TABLE public.evidence_backfill_queue ADD COLUMN IF NOT EXISTS features_done_at timestamptz;
CREATE INDEX IF NOT EXISTS evidence_backfill_queue_feat_todo ON public.evidence_backfill_queue (ord) WHERE done_at IS NOT NULL AND features_done_at IS NULL;

CREATE OR REPLACE FUNCTION public.evidence_features_next(p_run_id uuid, p_batch int DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SET statement_timeout = '120s' SET search_path = public AS $fn$
DECLARE ids uuid[]; asof timestamptz[]; n int;
BEGIN
  IF p_batch > 500 THEN RAISE EXCEPTION 'max 500 per batch'; END IF;
  SELECT array_agg(q.vehicle_id), array_agg(coalesce(
           (SELECT max(coalesce(b.auction_end_date, b.sale_date)) FROM bat_listings b WHERE b.vehicle_id = q.vehicle_id)::timestamptz + interval '1 day', now()))
    INTO ids, asof
  FROM (SELECT vehicle_id FROM evidence_backfill_queue WHERE done_at IS NOT NULL AND features_done_at IS NULL
        ORDER BY ord LIMIT p_batch FOR UPDATE SKIP LOCKED) q;
  IF ids IS NULL THEN RETURN 0; END IF;
  n := compute_evidence_features(ids, asof, p_run_id);
  UPDATE evidence_backfill_queue SET features_done_at = now() WHERE vehicle_id = ANY(ids);
  RETURN n;
END $fn$;

-- Evidence backfill queue: BaT vehicles with non-circular comps, listing descriptions only
-- (the only author_role passing the >=0.9 blind assertion-precision gate in evidence_roles_validated).
CREATE TABLE IF NOT EXISTS public.evidence_backfill_queue (
  vehicle_id uuid PRIMARY KEY, ord text NOT NULL, run_id uuid, done_at timestamptz, n_claims int);
CREATE INDEX IF NOT EXISTS evidence_backfill_queue_todo ON public.evidence_backfill_queue (ord) WHERE done_at IS NULL;
ALTER TABLE public.evidence_backfill_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.evidence_backfill_next(p_run_id uuid, p_batch int DEFAULT 500)
RETURNS TABLE (vehicles int, claims int, remaining bigint)
LANGUAGE plpgsql SET statement_timeout = '120s' AS $fn$
DECLARE ids uuid[]; n int;
BEGIN
  IF p_batch > 500 THEN RAISE EXCEPTION 'max 500 per batch'; END IF;
  SELECT array_agg(vehicle_id) INTO ids FROM (
    SELECT vehicle_id FROM public.evidence_backfill_queue WHERE done_at IS NULL ORDER BY ord LIMIT p_batch
    FOR UPDATE SKIP LOCKED) q;
  IF ids IS NULL THEN RETURN QUERY SELECT 0, 0, 0::bigint; RETURN; END IF;
  n := public.mine_bat_text_claims(ids, p_run_id, false);
  UPDATE public.evidence_backfill_queue SET done_at = now(), run_id = p_run_id WHERE vehicle_id = ANY(ids);
  RETURN QUERY SELECT array_length(ids,1), n, (SELECT count(*) FROM public.evidence_backfill_queue WHERE done_at IS NULL);
END $fn$;

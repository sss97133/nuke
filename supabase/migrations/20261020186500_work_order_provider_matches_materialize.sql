-- work_order_provider_matches_read: compute each provider x requirement match once.
--
-- The per CTE (provider_requirement_match for each candidate and requirement) was referenced once, so the planner inlined
-- it into tallied, where its inputs column is used six times (passed/failed/unknown counts, totals and the row); the
-- match ran about six times per row. Live smoke: K2500 job as the owner, warm median 530 ms (> 500 ms budget).
-- MATERIALIZED computes it once; output identical (rolled-back live check: ~476 ms -> ~185 ms).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $edit$
DECLARE def text := pg_get_functiondef('public.work_order_provider_matches_read(uuid,integer)'::regprocedure);
  anchor constant text := $a$  ), per AS (
$a$;
  n integer;
BEGIN
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 OR position('per AS MATERIALIZED' IN def) > 0 THEN
    RAISE EXCEPTION 'work_order_provider_matches_read: per anchor found % times (or already materialized)', n;
  END IF;
  EXECUTE replace(def, anchor, $r$  ), per AS MATERIALIZED (
$r$);
END $edit$;

NOTIFY pgrst, 'reload schema';
COMMIT;

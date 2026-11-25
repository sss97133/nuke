-- REVERT of 20261126111000_projection_verdicts_private_shapes.sql: takes the shape term back out of
-- retained_projection_verdicts_for (the body returns to the 20261126063500 prosrc sha256 734adc8a..., checked) and
-- records its vehicle_observations copy row at the pre-105000 hash 16c9e48f..., so while vo_private_shape_read is live
-- the exposure watch reads the copy as stale, which it then is.
-- Apply only through a migration that copies this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $revert$
DECLARE
  d text;
  term text := $t$     -- private_shape_rows_v1 (20261126111000): vo_private_shape_read hides a row matching an active
     -- vehicle_observation_private_shapes row from anon: neither the source p nor the projection o may match one
     AND NOT (coalesce(p.structured_data, '{}'::jsonb) @> ANY (ARRAY(SELECT s.structured_match
           FROM public.vehicle_observation_private_shapes s WHERE s.active)))
     AND NOT (coalesce(o.structured_data, '{}'::jsonb) @> ANY (ARRAY(SELECT s.structured_match
           FROM public.vehicle_observation_private_shapes s WHERE s.active)))
$t$;
BEGIN
  d := pg_get_functiondef('public.retained_projection_verdicts_for(uuid[])'::regprocedure);
  IF position(term IN d) > 0 THEN
    IF (length(d) - length(replace(d, term, ''))) / length(term) <> 1 THEN
      RAISE EXCEPTION 'retained_projection_verdicts_for holds the shape term more than once; re-read it';
    END IF;
    EXECUTE replace(d, term, '');
  END IF;
  IF (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') FROM pg_proc p
       WHERE p.oid = 'public.retained_projection_verdicts_for(uuid[])'::regprocedure)
       IS DISTINCT FROM '734adc8a68acff3a9af32aaa73bf6bd1365765e1509e4b684faece75542bf62d' THEN
    RAISE EXCEPTION 'retained_projection_verdicts_for is not the 20261126063500 body after the revert; re-read it';
  END IF;
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    UPDATE public.private_row_policy_copies
       SET recorded_hash = '16c9e48fc1fbfbe5dc4ae10fe8947c7c', recorded_at = now(),
           note = '20261126063500 restates the anon read of the source observation (vo_authenticated_read public term, '
                  || 'vo_public_broadcast_read, the four restrictive private-method policies)'
     WHERE reader = 'retained_projection_verdicts_for(uuid[])' AND relation = 'vehicle_observations'
       AND policy_filter = 'p.cmd IN (''SELECT'', ''ALL'')';
  END IF;
END
$revert$;
COMMIT;

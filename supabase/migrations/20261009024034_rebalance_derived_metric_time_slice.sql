-- The metric queue outgrew its 15s slice after retained intake scaled up.
-- Read-only production checkpoints, 2026-10-09 02:35..02:38Z: ~34k queued
-- vehicles, oldest >3h; 380 queue deletions / 341 inserts in 145s. The
-- controller still had a 500-row cap but stopped starting metric chunks at
-- one third of its 45s budget. Completion held 16 rows; stats/value were empty.
-- Give metric half the existing budget and reserve the next sixth for siblings.
-- No new schedule, capacity, table, grants, source writer or metric semantics.
-- Chunks/caps, retry circuit, parent locks, 2s lock timeout and value OFF stay.
-- Existing real-PG contract: supabase/sql/test_vehicle_derived_queue_chunks.sql.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $repair$
DECLARE
  f text;
  original text;
  old_slice constant text := 'v_budget / CASE WHEN v_name = ''metric'' THEN 3.0 ELSE 2.0 END';
  new_slice constant text := 'v_budget / CASE WHEN v_name = ''metric'' THEN 2.0 ELSE 1.5 END';
  old_comment constant text := E'-- Metric starts chunks only in the first third of the budget; every queue stops starting chunks at half the\n  -- budget so a slow last chunk still lands. Stats and value (one call each) run before completion.';
  new_comment constant text := E'-- Metric starts chunks in the first half; siblings stop starting chunks at two thirds of the budget.\n  -- The reserved sixth lets stats and completion progress after a metric burst; the final third is headroom.';
BEGIN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='drain-vehicle-derived-queues'
      AND active AND schedule='*/2 * * * *'
      AND encode(sha256(convert_to(command,'UTF8')),'base64')=
        'DyTDHVzhBBk4V6M507lB5RC/LsN7MqREJY1+qg0rTBI=') THEN
    RAISE EXCEPTION 'Active value-OFF derived drain contract changed; preserve owner pause';
  END IF;
  IF encode(sha256(convert_to(pg_get_functiondef('public.drain_vehicle_metric_queue(integer)'::regprocedure),'UTF8')),'base64')
      IS DISTINCT FROM 'i/bVyc6ZROIvmHwIkdlQHzhGTOavHdmp7DfrM0B2QnA=' THEN
    RAISE EXCEPTION 'Canonical metric owner changed; review before tuning controller';
  END IF;
  f:=pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure);
  original:=replace(replace(f,new_slice,old_slice),new_comment,old_comment);
  IF encode(sha256(convert_to(original,'UTF8')),'base64') IS DISTINCT FROM
      'ORa96HNSwkFyBo1zNXUkSTEylzENegsEdhfF0EmuSko=' THEN
    RAISE EXCEPTION 'Derived controller body drifted; review before replacement';
  END IF;
  IF cardinality(string_to_array(original,old_slice))<>2
      OR cardinality(string_to_array(original,old_comment))<>2 THEN
    RAISE EXCEPTION 'Derived controller slice anchors changed';
  END IF;
  f:=replace(replace(original,old_slice,new_slice),old_comment,new_comment);
  EXECUTE f;
  IF pg_get_functiondef('public.drain_vehicle_derived_queues(boolean,integer)'::regprocedure)
      IS DISTINCT FROM f THEN
    RAISE EXCEPTION 'Derived controller replacement changed outside the reviewed slice';
  END IF;
END $repair$;
COMMENT ON FUNCTION public.drain_vehicle_derived_queues(boolean,integer) IS
  'Existing sequential metric/stats/value/completion controller. Budget coalesce45 clamped5..60; metric10/call,500/run starts through half the budget; siblings stats50/value100/completion25,1000/run start through two thirds, with final-third headroom. Existing retry circuit and transaction-local2s lock timeout. Value remains OFF in the unchanged every2min cron. Canonical metric owner and source clocks unchanged. Rebalanced2026-10-09 after >3h metric lag.';
COMMIT;

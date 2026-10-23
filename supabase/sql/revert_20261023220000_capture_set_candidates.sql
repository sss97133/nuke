-- Revert of 20261023220000_capture_set_candidates.sql. Ship as its own migration if the table must go; to withdraw a
-- scorer run only, call capture_set_candidates_revert(run_id, reason) instead. Nothing else references these objects.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DROP FUNCTION IF EXISTS public.record_capture_set_candidates(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.capture_set_candidates_revert(uuid, text);
DROP TABLE IF EXISTS public.capture_set_candidates;

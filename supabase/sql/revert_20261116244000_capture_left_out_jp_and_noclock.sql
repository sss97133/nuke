-- Restore capture_left_out_to_review_v1 to the #3330 5-arg body.
-- Refuses while unreverted left-out or classifier-override log rows exist.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('public.capture_left_out_to_review_log') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.capture_left_out_to_review_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_left_out_jp_and_noclock: unreverted left-out log rows; revert those runs first';
  END IF;
  IF to_regclass('public.capture_left_out_classifier_override_log') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.capture_left_out_classifier_override_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_left_out_jp_and_noclock: unreverted classifier override log rows; revert those runs first';
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.capture_left_out_to_review_v1(uuid, uuid, uuid, boolean, integer, jsonb);
DROP FUNCTION IF EXISTS public.capture_left_out_to_review_revert_v1(uuid, uuid);
DROP TABLE IF EXISTS public.capture_left_out_classifier_override_log;

ALTER TABLE IF EXISTS public.capture_left_out_to_review_log
  DROP COLUMN IF EXISTS clock_missing;

\i supabase/migrations/20261115235000_capture_left_out_to_review.sql

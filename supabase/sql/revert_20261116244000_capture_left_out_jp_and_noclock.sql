-- Restore capture_left_out_to_review_v1 to the #3330 5-arg body.
-- Refuses while unreverted left-out log rows exist.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('public.capture_left_out_to_review_log') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.capture_left_out_to_review_log WHERE reverted_at IS NULL) THEN
    RAISE EXCEPTION 'capture_left_out_jp_and_noclock: unreverted left-out log rows; revert those runs first';
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.capture_left_out_to_review_v1(uuid, uuid, uuid, boolean, integer, jsonb);
DROP FUNCTION IF EXISTS public.capture_left_out_to_review_revert_v1(uuid, uuid);

ALTER TABLE IF EXISTS public.capture_left_out_to_review_log
  DROP COLUMN IF EXISTS clock_missing,
  DROP COLUMN IF EXISTS classifier_items;

\i supabase/migrations/20261115235000_capture_left_out_to_review.sql

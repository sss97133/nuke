-- Revert 20261115235000 capture_left_out_to_review.
-- Refuses while unreverted log rows remain.

DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.capture_left_out_to_review_log') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.capture_left_out_to_review_log WHERE reverted_at IS NULL;
    IF n > 0 THEN
      RAISE EXCEPTION 'capture_left_out_to_review: % unreverted log rows; revert those runs first', n;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.capture_left_out_to_review_v1(uuid, uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_left_out_to_review_revert_v1(uuid, uuid);
DROP TABLE IF EXISTS public.capture_left_out_to_review_log;

-- Revert 20261124203000_receipt_itemise_retained_lines: remove the lines the fold itemised (line_source IS NOT NULL),
-- the fold, its cron, its rule rows and outcome table. Lines written by landing writers (line_source NULL) stay.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'receipt-itemise-retained';
  END IF;
END $$;
DELETE FROM public.receipt_items WHERE line_source IS NOT NULL;
DROP FUNCTION IF EXISTS public.receipt_itemise_retained(integer, text);
DROP FUNCTION IF EXISTS public.receipt_line_pick(jsonb, text[]);
DROP FUNCTION IF EXISTS public.receipt_itemise_sibling(uuid);
DROP FUNCTION IF EXISTS public.receipt_line_number_value(text);
DROP INDEX IF EXISTS public.receipt_items_receipt_line_number_key;
ALTER TABLE public.receipt_items DROP COLUMN IF EXISTS line_source;
DROP TABLE IF EXISTS public.receipt_itemisation_outcomes;
DROP TABLE IF EXISTS public.receipt_line_sources;
COMMIT;

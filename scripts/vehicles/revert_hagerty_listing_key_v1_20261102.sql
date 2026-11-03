-- Revert run hagerty_listing_key_v1_20261102 (20261108130100_vehicles_source_listing_key_backfill_hagerty.sql).
-- Nulls source_listing_key on exactly the vehicles the run set (and only while the key is still the one the run wrote),
-- and stamps reverted_at on their log rows. Touches no other column. The column, function, log table and index stay;
-- the schema down script is supabase/rollbacks/20261108130000_vehicles_source_listing_key_down.sql.
-- Rows keyed later by the extractor are not in the log for this run and are left alone.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '50s';

WITH r AS (
  UPDATE public.vehicles v
     SET source_listing_key = NULL
    FROM public.source_listing_key_backfill_log l
   WHERE l.run_id = 'hagerty_listing_key_v1_20261102'
     AND l.action = 'set' AND l.reverted_at IS NULL
     AND v.id = l.vehicle_id AND v.source_listing_key = l.key
  RETURNING v.id
)
UPDATE public.source_listing_key_backfill_log l
   SET reverted_at = now()
  FROM r
 WHERE l.run_id = 'hagerty_listing_key_v1_20261102' AND l.vehicle_id = r.id;

COMMIT;

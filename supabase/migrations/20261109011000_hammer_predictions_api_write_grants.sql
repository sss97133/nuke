-- hammer_predictions: anon and authenticated keep their column SELECT and lose every write privilege.
--
-- On prod 2026-11-08 both API roles held INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER and REFERENCES on the table (Supabase's
-- default grant), beside SELECT on nine columns read through one policy (hammer_predictions_live_bands_read, model 31).
-- RLS has no write policy, so INSERT, UPDATE and DELETE already matched no row; TRUNCATE is not subject to RLS.
-- Every writer uses the service role or a definer: scripts/market/live-finish.mjs, live-finish-33.py and live-bands.mjs
-- (service key), score-live-auctions (project secret key; it calls score_closed_predictions, an invoker function, as
-- service_role), grade_hammer_predictions_by_lot and the vehicle_event repoint functions (definers). The frontend reads
-- model 31 bands (useMarketPulse) and nothing writes. A table-level REVOKE leaves the column SELECT grants as they are.
-- Contract: supabase/sql/test_hammer_predictions_api_write_grants.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.hammer_predictions FROM anon, authenticated;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.hammer_predictions', 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES')
     OR has_table_privilege('authenticated', 'public.hammer_predictions', 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES') THEN
    RAISE EXCEPTION 'hammer_predictions: an API role still holds a write privilege';
  END IF;
  IF NOT has_column_privilege('anon', 'public.hammer_predictions', 'predicted_hammer', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.hammer_predictions', 'predicted_hammer', 'SELECT') THEN
    RAISE EXCEPTION 'hammer_predictions: the API roles lost their column SELECT';
  END IF;
END $$;

COMMIT;

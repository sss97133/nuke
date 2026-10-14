-- vehicles: a plain index for  vin = $1,  the lookup every ingest function and API route sends before it writes a car.
--
-- Measured 2026-10-14. The edge functions (extract-*, ingest, api-v1-*, import-*, mcp-connector, image-intake ...: 38 call
-- sites) ask  vehicles?select=id&vin=eq.X&limit=1,  sometimes with  id=neq.Y.  pg_stat_statements since 2026-09-29, service_role:
-- 491 + 358 + 239 = 1,088 calls, means 15.6 s, 18.1 s and 17.4 s, max 58 s, 18,300 s of database time. auto_explain logged 135 of
-- them over 10 s in the window available; every plan is  Gather > Parallel Seq Scan on vehicles  (cost 316,423 for a 1-row
-- answer), a read of the whole 2.4 GB heap: 19.3 s for one lookup at 04:01Z.
--
-- Cause: no index serves an unqualified equality on vin. The two unique indexes are partial,
--   vehicles_vin_unique_17char_v2 (vin) WHERE vin IS NOT NULL AND length(vin) = 17 AND status IS DISTINCT FROM 'merged'
--   vehicles_vin_unique_short_v2 (vin, make) WHERE vin IS NOT NULL AND length(vin) < 17 AND status IS DISTINCT FROM 'merged'
-- and a planner cannot prove length(vin) = 17 or status from  vin = 'X'.  The expression indexes (upper(vin),
-- upper(trim(vin))) do not match a plain  vin = ,  and neither is leakproof. Spelling the predicate out answers the same
-- lookup from the 17-character index in 3 buffers (EXPLAIN on production, deploy role); without it the statement does not
-- finish inside a 10 s cap.
--
-- idx_vehicles_vin is that lookup's index: btree (vin) WHERE vin IS NOT NULL, about a third of the 1.01 M rows, an estimated 25 MB (the 17-character unique index holds most of them at 22 MB). An
-- equality implies NOT NULL, so every  vin = $1  qualifies, case and spacing exactly as stored (this is not a normalizing
-- index; vehicle_by_vin_public keeps the case-insensitive VIN search). texteq is leakproof, so the index is usable under
-- the anon and authenticated row policies too. No uniqueness, no row, policy or function change. vin is already indexed by
-- the four indexes above, so updates keep the HOT behaviour they have.
--
-- Build: CONCURRENTLY, 2.4 GB heap read twice. lock_timeout bounds the wait for older transactions (20261006133000: 5 s was
-- too short on a table the pollers write). An interrupted build leaves an INVALID index; the conditional drop clears it on
-- a re-run and the assertion fails the deploy rather than leave one that IF NOT EXISTS would accept.
-- No BEGIN: the deploy applies this file with psql -f in autocommit, and CREATE INDEX CONCURRENTLY cannot run in a block.
-- Contract: supabase/sql/test_vehicles_vin_equality_index.sql (CI job vehicles-vin-index-contract).
SET statement_timeout = '900s';
SET lock_timeout = '180s';

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_vin') AND NOT indisvalid) AS vin_invalid \gset
\if :vin_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_vin;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_vin
  ON public.vehicles (vin)
  WHERE vin IS NOT NULL;

DO $assert$
DECLARE
  def text;
BEGIN
  IF NOT coalesce((SELECT indisvalid AND indisready AND NOT indisunique FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_vin')), false) THEN
    RAISE EXCEPTION 'idx_vehicles_vin is missing, INVALID or unique after the build; DROP INDEX CONCURRENTLY public.idx_vehicles_vin and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_vehicles_vin'));
  IF def NOT LIKE '% USING btree (vin) WHERE (vin IS NOT NULL)' THEN
    RAISE EXCEPTION 'idx_vehicles_vin exists with another definition: %', def;
  END IF;
END
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_vehicles_vin IS
'Equality lookups on vehicles.vin: every  vin = $1  from the ingest functions, the API routes and the MCP connector. Plain btree, exact stored spelling, rows with a VIN only. Without it the two partial unique indexes (length 17 / under 17, not merged) cannot be proven from an equality and the lookup was a parallel sequential scan of the 2.4 GB heap (mean 17 s, 1,088 calls from 2026-09-29 to 2026-10-14). Built CONCURRENTLY 2026-10-14.';
RESET lock_timeout;
RESET statement_timeout;

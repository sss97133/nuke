-- 20261007213000_key_vehicle_location_county_from_zip.sql
--
-- Key vehicle_location_observations to the place entity at intake: when a location observation arrives with a US postal
-- code and a US state code but no county, a BEFORE INSERT trigger keys county_fips (and county_name) through zip_to_fips
-- into us_county_boundaries and records the method in metadata.county_key. A sanctioned, batched, receipted writer
-- back-fills the rows that arrived while nothing coded them. Follows 20261007210000 (the declaration and the NOT VALID
-- key), case ledger C8, and the "sources are pluggable" rule: the key arrives from a cheaper source (the postal code the
-- writers already parse) instead of the geocoder that stopped.
--
-- WHY. County coding stopped in 2026-04. scripts/geocode-backfill.mjs (a laptop script) coded county_fips from
-- coordinates through 2026-03-29; since then 0 of 207,324 rows carry a code or coordinates, while the writers
-- (extract-bat-core, extract-cars-and-bids-core, process-cl-queue through _shared/parseLocation.ts) parse "City, State
-- 12345" into postal_code and a two-letter region_code on nearly every row. The place entity (S01 and nine other stacks)
-- is declared but fed by nothing. map-vehicles aggregates by county_fips for its county and state views.
--
-- EVIDENCE (read-only, prod, 2026-10-07 10:55-11:30Z, scripts/data/q.sh):
--   vehicle_location_observations: 574,905 rows, heap 191 MB (354 MB with indexes); county_fips on 337,576, none written
--     since 2026-03-29. Rows without county_fips: 237,329; with a five-digit postal code: 210,817; of those 186,150 have
--     their ZIP in zip_to_fips and 183,478 key to a county present in us_county_boundaries (the rest hit the 244 retired
--     codes or unknown ZIPs). Since 2026-04-01: 202,524 BaT rows (postal code on 196,592; two-letter region_code on
--     196,636) and 4,830 Cars & Bids rows (4,824 / 4,824). No trigger on the table; 0 write_receipts rows ever.
--   The parser (_shared/parseLocation.ts): zip = the first 5-digit (optionally +4) group in the raw text; state = a
--     two-letter code from its US state set or a full state name mapped to one; a place it cannot map gets state NULL.
--     Checked on the data: among the 201,224 rows since April with a five-digit postal code, the only rows naming a
--     non-US place ("Lehre, Wendhausen, Germany 38165", 2 rows) have region_code NULL; "New Mexico", "Switzerland,
--     Florida" and "Denmark, Maine" are US places with US codes. So region_code ~ '^[A-Z]{2}$' selects US rows.
--   Consistency of the ZIP route with the state code: on the 265,437 rows coded from coordinates that carry a state code,
--     264,103 (99.5%) carry the modal region_code of their county's state; 128 (state, code) pairs are off-modal (parse
--     noise). A ZIP can straddle counties, so the key is ZIP-grain (one county per ZIP in zip_to_fips); the method is
--     recorded on every row it keys.
--   zip_to_fips: 41,173 five-digit ZIPs, fips filled on every row, 244 onto codes absent from the county table (the join
--     through us_county_boundaries skips them, so the trigger never writes a code the NOT VALID key refuses).
--
-- WHAT.
--   1. key_vehicle_location_county(): BEFORE INSERT OR UPDATE OF postal_code, region_code, FOR EACH ROW, WHEN
--      county_fips IS NULL and postal_code ~ '^[0-9]{5}(-[0-9]{4})?$' and region_code ~ '^[A-Z]{2}$'. Looks the ZIP up
--      through zip_to_fips joined to us_county_boundaries; when a county is found sets county_fips, county_name and
--      metadata.county_key = {method: zip_to_fips, zip, grain: zip, at, writer}. Never raises; a ZIP with no county leaves
--      the row as written. Two primary-key lookups per row.
--   2. key_vehicle_location_county_from_zip(p_batch integer default 5000) returns jsonb: SECURITY DEFINER, EXECUTE for
--      service_role only, app.writer set with set_config for the call and restored. One UPDATE of up to p_batch eligible
--      rows (same predicate as the trigger, FOR UPDATE SKIP LOCKED, no ORDER BY so the scan stops at the batch), the same
--      metadata record with writer key_vehicle_location_county_from_zip, one write_receipts row per call (the table has
--      no receipt trigger). Returns {keyed, batch, ms}. Idempotent: keyed rows leave the predicate. p_batch 1..20000.
--   3. Comments: county_fips and county_name updated for the new coder; the function and trigger described.
--   4. pipeline_registry: column rows for county_fips and county_name (owned by the trigger; back-fill named in write_via),
--      the table row's write_via extended. Rows updated, not versioned, like the registry.
--   5. A NOTICE with the eligible count at apply time.
--   The back-fill is run by hand after deploy (one call per batch through scripts/data/q.sh, logged); nothing here writes
--   a row.
--
-- LIMITS. ZIP grain: a ZIP that straddles counties gets zip_to_fips's one county; the 0.5% off-modal state pairs show the
-- parse noise the key inherits. Rows with no region_code (about 3% of recent BaT rows) or a ZIP absent from the crosswalk
-- stay uncoded. county_fips coded from coordinates (through 2026-03) carries no metadata.county_key; the two methods are
-- told apart by that key. Coordinates are not derived here (the ZIP has none).
--
-- CONTRACT. supabase/sql/test_key_vehicle_location_county_from_zip.sql (PostgreSQL 17, synthetic rows, CI job
-- metric-fold-health-contract).
-- MEASURED BEFORE (11:05Z): county_fips on 337,576 of 574,905 rows; 0 of 80,779 rows in 30 days coded; eligible 183,478.
-- EXPECTED AFTER the back-fill: county_fips on about 521,000 rows (90.6%); new BaT and Cars & Bids rows keyed at insert;
--   the assay below reads 0 eligible rows older than a day.
-- ASSAY. select count(*) from vehicle_location_observations where county_fips is null and postal_code ~ '^[0-9]{5}'
--   and region_code ~ '^[A-Z]{2}$' and created_at < now() - interval '1 day'
--   and exists (select 1 from zip_to_fips z join us_county_boundaries c on c.fips = z.fips where z.zip = left(postal_code, 5))
--   -- 0 when the trigger and the back-fill hold.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. The intake key --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.key_vehicle_location_county()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_zip  text := left(NEW.postal_code, 5);
  v_fips text;
  v_name text;
BEGIN
  SELECT c.fips, c.name INTO v_fips, v_name
  FROM public.zip_to_fips z
  JOIN public.us_county_boundaries c ON c.fips = z.fips
  WHERE z.zip = v_zip;

  IF v_fips IS NOT NULL THEN
    NEW.county_fips := v_fips;
    NEW.county_name := v_name;
    NEW.metadata := CASE WHEN NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) = 'object'
                         THEN coalesce(NEW.metadata, '{}'::jsonb)
                         ELSE jsonb_build_object('prior', NEW.metadata) END
                    || jsonb_build_object('county_key', jsonb_build_object(
                         'method', 'zip_to_fips', 'zip', v_zip, 'grain', 'zip', 'at', now(),
                         'writer', 'trg_key_vehicle_location_county'));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_key_vehicle_location_county ON public.vehicle_location_observations;
CREATE TRIGGER trg_key_vehicle_location_county
BEFORE INSERT OR UPDATE OF postal_code, region_code ON public.vehicle_location_observations
FOR EACH ROW
WHEN (NEW.county_fips IS NULL AND NEW.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$' AND NEW.region_code ~ '^[A-Z]{2}$')
EXECUTE FUNCTION public.key_vehicle_location_county();

COMMENT ON FUNCTION public.key_vehicle_location_county() IS
'BEFORE INSERT OR UPDATE OF postal_code, region_code trigger function on vehicle_location_observations (trigger trg_key_vehicle_location_county, migration 20261007213000). For a row with no county_fips, a five-digit US postal code and a two-letter US state code (parseLocation.ts emits one only for US states), looks the ZIP up through zip_to_fips joined to us_county_boundaries and, when a county is found, sets county_fips, county_name and metadata.county_key {method zip_to_fips, zip, grain zip, at, writer}. A ZIP with no county (unknown, or one of the 244 retired codes) leaves the row as written; never raises. ZIP grain: one county per ZIP. Two primary-key lookups per keyed row. Back-fill of older rows: key_vehicle_location_county_from_zip().';
COMMENT ON TRIGGER trg_key_vehicle_location_county ON public.vehicle_location_observations IS
'Keys county_fips and county_name from the postal code through zip_to_fips at insert (and when postal_code or region_code changes on an uncoded row); see key_vehicle_location_county(). Fires only when county_fips is NULL, postal_code is a US ZIP and region_code is a two-letter state code.';

-- 2. The back-fill writer --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.key_vehicle_location_county_from_zip(p_batch integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'key_vehicle_location_county_from_zip';
  v_prev_writer text := current_setting('app.writer', true);
  v_started     timestamptz := clock_timestamp();
  v_keyed       integer := 0;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 20000 THEN
    RAISE EXCEPTION 'key_vehicle_location_county_from_zip: p_batch must be between 1 and 20000, got %', p_batch
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  WITH pick AS (
    SELECT o.id, c.fips, c.name, left(o.postal_code, 5) AS zip
    FROM public.vehicle_location_observations o
    JOIN public.zip_to_fips z ON z.zip = left(o.postal_code, 5)
    JOIN public.us_county_boundaries c ON c.fips = z.fips
    WHERE o.county_fips IS NULL
      AND o.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'
      AND o.region_code ~ '^[A-Z]{2}$'
    LIMIT p_batch
    FOR UPDATE OF o SKIP LOCKED
  ), upd AS (
    UPDATE public.vehicle_location_observations o
    SET county_fips = p.fips,
        county_name = p.name,
        metadata    = CASE WHEN o.metadata IS NULL OR jsonb_typeof(o.metadata) = 'object'
                           THEN coalesce(o.metadata, '{}'::jsonb)
                           ELSE jsonb_build_object('prior', o.metadata) END
                      || jsonb_build_object('county_key', jsonb_build_object(
                           'method', 'zip_to_fips', 'zip', p.zip, 'grain', 'zip', 'at', now(), 'writer', c_writer))
    FROM pick p
    WHERE p.id = o.id
    RETURNING 1
  )
  SELECT count(*) INTO v_keyed FROM upd;

  -- vehicle_location_observations has no write-receipt trigger; record this writer's statement the way record_write_receipt does.
  IF v_keyed > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('vehicle_location_observations', 'UPDATE', v_keyed, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('keyed', v_keyed, 'batch', p_batch,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;

REVOKE ALL ON FUNCTION public.key_vehicle_location_county_from_zip(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_vehicle_location_county_from_zip(integer) TO service_role;

COMMENT ON FUNCTION public.key_vehicle_location_county_from_zip(integer) IS
'Sanctioned back-fill writer for vehicle_location_observations.county_fips (migration 20261007213000): keys up to p_batch (1..20000, default 5000) rows that have no county_fips, a five-digit US postal code and a two-letter state code, through zip_to_fips joined to us_county_boundaries, setting county_fips, county_name and metadata.county_key {method zip_to_fips, zip, grain zip, at, writer}; the same rule as trigger trg_key_vehicle_location_county. FOR UPDATE SKIP LOCKED, no ORDER BY (the scan stops at the batch). One write_receipts row per call under writer key_vehicle_location_county_from_zip; app.writer is set for the call and restored. Idempotent: keyed rows leave the predicate, so repeated calls walk the table to zero. Returns {keyed, batch, ms}. SECURITY DEFINER, EXECUTE for service_role only. Run by hand through scripts/data/q.sh, one call per batch, until keyed = 0 (183,478 eligible rows on 2026-10-07 11:05Z).';

-- 3. Column comments ----------------------------------------------------------------------------------------------------
COMMENT ON COLUMN public.vehicle_location_observations.county_fips IS
'County the observation falls in: a US county FIPS code, a foreign key to us_county_boundaries(fips) since 2026-10-07 (NOT VALID: the 3,244 rows coded ''_none'' stay unchecked; a new or re-keyed code must be a county). Two coders, told apart by metadata.county_key: (1) scripts/geocode-backfill.mjs, from coordinates by point-in-county, 337,576 rows through 2026-03-29 and none since, no metadata record; (2) since 2026-10-07, trigger trg_key_vehicle_location_county at insert and key_vehicle_location_county_from_zip() for the back-fill, from the postal code through zip_to_fips (ZIP grain: one county per ZIP; metadata.county_key = {method zip_to_fips, zip, grain, at, writer}). Eligible for (2) on 2026-10-07: 183,478 rows with a US ZIP and a two-letter state code (0 of 80,779 rows written in the previous 30 days were coded). Unit: none (code). Source: the coder named above. Grain: one observation. Clock: metadata.county_key.at for (2); created_at for (1). Partial indexes idx_vlo_county_fips and idx_vlo_county_id_page; read by map-vehicles for county and state aggregates; the key of the place entity for S01 and the other stacks that name it.';
COMMENT ON COLUMN public.vehicle_location_observations.county_name IS
'Name of the county in county_fips, copied from us_county_boundaries.name by the coder that set county_fips (the geocoder through 2026-03-29; the ZIP key since 2026-10-07); not a key (join on county_fips). 334,332 rows on 2026-10-07 before the back-fill: every coded row except the 3,244 coded ''_none''. Unit: none (text). Source: the coder of county_fips. Grain: one observation. Clock: the clock of county_fips.';

-- 4. Registry rows -----------------------------------------------------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vehicle_location_observations', 'county_fips', 'trg_key_vehicle_location_county',
       'County FIPS key of the observation (us_county_boundaries). Set at insert from the postal code through zip_to_fips when the writer left it NULL; earlier rows were coded from coordinates by scripts/geocode-backfill.mjs (through 2026-03-29).',
       true,
       'trg_key_vehicle_location_county (BEFORE INSERT OR UPDATE OF postal_code, region_code) and key_vehicle_location_county_from_zip() for the back-fill (service_role, receipted). A writer may still set county_fips itself (the trigger then does nothing). Migration 20261007213000.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vehicle_location_observations' AND column_name = 'county_fips');
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vehicle_location_observations', 'county_name', 'trg_key_vehicle_location_county',
       'County name copied from us_county_boundaries.name by the coder of county_fips; not a key.',
       true,
       'Set with county_fips by trg_key_vehicle_location_county and key_vehicle_location_county_from_zip(). Migration 20261007213000.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vehicle_location_observations' AND column_name = 'county_name');
UPDATE public.pipeline_registry
SET write_via = write_via || ' county_fips and county_name are keyed at insert by trg_key_vehicle_location_county from the postal code (zip_to_fips), and back-filled by key_vehicle_location_county_from_zip() (migration 20261007213000).',
    updated_at = now()
WHERE table_name = 'vehicle_location_observations' AND column_name IS NULL
  AND write_via NOT LIKE '%trg_key_vehicle_location_county%';

-- 5. The eligible count at apply time ------------------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.vehicle_location_observations o
  WHERE o.county_fips IS NULL AND o.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$' AND o.region_code ~ '^[A-Z]{2}$'
    AND EXISTS (SELECT 1 FROM public.zip_to_fips z JOIN public.us_county_boundaries c ON c.fips = z.fips
                WHERE z.zip = left(o.postal_code, 5));
  RAISE NOTICE 'vehicle_location_observations rows eligible for the ZIP county key: % (183,478 on 2026-10-07 11:05Z)', n;
END $$;

COMMIT;

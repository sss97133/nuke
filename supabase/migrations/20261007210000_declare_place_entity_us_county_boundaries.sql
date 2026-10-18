-- 20261007210000_declare_place_entity_us_county_boundaries.sql
--
-- Declare the place entity at county grain. public.us_county_boundaries becomes the table behind the abstract need
-- 'place entity' (stack_substrates); the text codes vehicle_location_observations.county_fips and zip_to_fips.fips already
-- carry become foreign keys to it; the county table gets its format checks, its comments and its registry row. No row of
-- testimony is written and no table is created: SCHEMA_LAW pre-mint memo docs/proposals/2026-10-07-place-entity.md
-- (PR #777, merged c3a6ced2e) found the entity already exists and recommended "declare, don't mint".
--
-- WHY. 'place entity' is the abstract need missing in the most stacks: 10 of 65 (S01, S11, S13, S16, S40, S42, S61, SB, SC,
-- SD; v_stacks, 2026-10-07 11:05Z), and 0 of the 61 substrates had a declared table. The registry rule (stack_substrates
-- comment, 20261007014500): a declaration moves every stack that names the substrate, with no new stack version. S01 (county
-- performance surface per model) has this as its only need (coverage 0 of 1). Case ledger C8 ("Place is not an entity").
--
-- EVIDENCE (read-only, prod, 2026-10-07 10:55-11:10Z, scripts/data/q.sh):
--   us_county_boundaries: 3,231 rows, 3,231 distinct fips, every fips five digits, state_fips = left(fips, 2) on every row,
--     56 distinct state_fips (states, DC, territories); PRIMARY KEY (fips), GiST index on geom; 0 writes since the statistics
--     reset, 33,209 reads; RLS on with no policy; no foreign key in or out; 0 of 4 columns described; no pipeline_registry row.
--     Loader: not in the repo (no migration creates or loads it; 20260713020000 reads it for mv_vehicle_county). Vintage: Unknown.
--   vehicle_location_observations: 574,905 rows; county_fips on 337,576 (58.7%), 2,217 distinct codes, 2,216 in the county
--     table; the one unmatched code is '_none' on 3,244 rows, last written 2026-03-29; county_name on 334,332 rows (every coded
--     row but the '_none' ones). Coding has stopped: of the 80,779 rows written in the last 30 days, 0 carry county_fips and
--     0 carry coordinates, while 22,196 of the 23,236 October rows carry a postal code. By month: 2026-03 323,011 of 352,234
--     rows coded; 2026-04 0 of 44,532; 2026-07 0 of 82,013; 2026-09 0 of 57,543; 2026-10 0 of 23,236. The coder was
--     scripts/geocode-backfill.mjs (a laptop script, per the registry row). No trigger on the table. Partial indexes
--     idx_vlo_county_fips and idx_vlo_county_id_page exist. The column comment named only the spatial method.
--   zip_to_fips: 41,173 rows (PRIMARY KEY zip), 3,229 distinct fips; 244 rows name a fips not in the county table (Florida 137,
--     Alaska 53, South Dakota 7, Virginia 6, New York 5, 23 states in all: retired and territory codes from another release).
--     0 writes since the statistics reset; RLS on with no policy; 0 of 2 columns described; no registry row. Of the 210,817
--     observations with a five-digit postal code and no county, 186,150 have a ZIP in this table and 183,478 key to a county.
--
-- WHAT.
--   1. us_county_boundaries: CHECK fips ~ '^[0-9]{5}$' and CHECK state_fips = left(fips, 2), validated (0 rows fail);
--      comments on the table and its 4 columns; a pipeline_registry table-level row (reference load, loader not in the repo).
--   2. vehicle_location_observations.county_fips -> us_county_boundaries(fips), NOT VALID: the 3,244 '_none' rows stay
--      unchecked, every new or re-keyed code must be a county. ON DELETE NO ACTION: a county is never deleted while referenced.
--      Comments on the constraint, on county_fips and on county_name.
--   3. zip_to_fips.fips -> us_county_boundaries(fips), NOT VALID (244 rows stay unchecked); comments and a registry row.
--   4. stack_substrates 'place entity': declared_table = 'us_county_boundaries', declared_at, declared_by; the note keeps the
--      candidates and records what the declaration covers.
--   5. NOTICEs with S01's coverage and the count of stacks still missing the need, when the registry functions exist.
--   Every step is guarded, so a re-apply adds and changes nothing (contract below).
--
-- LOCKS. ADD CONSTRAINT takes SHARE ROW EXCLUSIVE on both tables for the catalog change only (NOT VALID: no scan of the
-- 574,905 rows); lock_timeout 5 s makes the migration fail rather than queue behind a busy writer. The validated CHECKs scan
-- 3,231 rows. One transaction.
--
-- LIMITS. The declaration is structural: stack_coverage() reads the county table as present by rows (3,231 > 0); it says
-- nothing about how many vehicles are keyed to a county (337,576 observations through 2026-03, none since). The intake repair
-- (key county_fips from the postal code through zip_to_fips at insert; back-fill the 183,478 rows that key) is a separate
-- writer PR. The 244 zip_to_fips orphans and the 3,244 '_none' rows are not decided here. States, regions, countries and
-- non-US places have no table and are not covered. The county table's vintage stays Unknown until its loader is found.
--
-- CHANGED EXISTING COMMENTS. The table comments of us_county_boundaries and zip_to_fips (20261006073000) are replaced by
-- fuller ones that keep their substance. vehicle_location_observations.county_fips is replaced: it is now a key, and coding
-- has stopped. county_name had none.
--
-- CONTRACT. supabase/sql/test_place_entity_declaration.sql (PostgreSQL 17, synthetic rows, CI job metric-fold-health-contract).
-- MEASURED BEFORE (11:05Z): v_stacks S01 coverage 0 of 1; 'place entity' missing in 10 of 65 stacks; mean coverage 0.115;
--   5 stacks showable (>= 0.9); stack_substrates declared 0 of 61; us_county_boundaries fk_in 0, described 0 of 4.
-- EXPECTED AFTER: S01 1 of 1 (showable 6); the other 9 stacks each gain one present need; declared 1 of 61;
--   us_county_boundaries fk_in 2, described 4 of 4; zip_to_fips described 2 of 2.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. The county table: validated format checks, comments, registry row ------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.us_county_boundaries'::regclass
                 AND conname = 'us_county_boundaries_fips_format_check') THEN
    ALTER TABLE public.us_county_boundaries
      ADD CONSTRAINT us_county_boundaries_fips_format_check CHECK (fips ~ '^[0-9]{5}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.us_county_boundaries'::regclass
                 AND conname = 'us_county_boundaries_state_fips_check') THEN
    ALTER TABLE public.us_county_boundaries
      ADD CONSTRAINT us_county_boundaries_state_fips_check CHECK (state_fips = left(fips, 2));
  END IF;
END $$;

COMMENT ON TABLE public.us_county_boundaries IS
'The place entity at county grain: one row per US county or county-equivalent (grain: one county; PRIMARY KEY fips, the five-digit Census county FIPS code) with its name, its state FIPS code and its boundary geometry (PostGIS, SRID 4326, GiST index idx_county_boundaries_geom). 3,231 rows on 2026-10-07 across 56 state codes (the states, DC and territories); every fips is five digits and state_fips = left(fips, 2), both now CHECKs. Reference data from the US Census Bureau county boundaries; the loader and the release vintage are not in the repo (Unknown), and no row has been written since the statistics reset (33,209 reads). Declared on 2026-10-07 as the table behind the stack_substrates row ''place entity'' (migration 20261007210000, from docs/proposals/2026-10-07-place-entity.md): every stack that names that need is measured on this table. Keys to it: vehicle_location_observations.county_fips and zip_to_fips.fips (NOT VALID foreign keys). Readers: mv_vehicle_county and county_density_filtered() (point-in-county, 20260713020000), map-vehicles through county_fips. Not covered: states, regions, countries and places outside the US; boundary vintages (a re-release must land as a new vintage, which needs a vintage column first). Access: RLS on with no policy, so anon and authenticated read nothing; service_role and postgres read. Registry: pipeline_registry table-level row, do_not_write_directly. Clock: none; a row is a reference, not an observation.';
COMMENT ON COLUMN public.us_county_boundaries.fips IS
'Five-digit US county FIPS code (two-digit state code + three-digit county code): the primary key and the key every place reference uses (vehicle_location_observations.county_fips, zip_to_fips.fips). CHECK us_county_boundaries_fips_format_check (^[0-9]{5}$). 3,231 distinct values (2026-10-07). Unit: none (code). Source: US Census Bureau county codes, loaded with the table. Grain: one county. Clock: n/a.';
COMMENT ON COLUMN public.us_county_boundaries.name IS
'Name of the county or county-equivalent as the Census publishes it (Clark, Los Angeles, St. Louis city), without the word County (no name contains it). Filled on every row (3,231, 2026-10-07). Unit: none (text). Source: loaded with the table. Grain: one county. Clock: n/a.';
COMMENT ON COLUMN public.us_county_boundaries.state_fips IS
'Two-digit state FIPS code of the county: left(fips, 2), enforced by CHECK us_county_boundaries_state_fips_check. Filled on every row; 56 distinct values (2026-10-07): the states, DC and territories. No state table exists, so the code has no name here; a state level is deferred to its first reader (docs/proposals/2026-10-07-place-entity.md Q4). Unit: none (code). Source: loaded with the table. Grain: one county. Clock: n/a.';
COMMENT ON COLUMN public.us_county_boundaries.geom IS
'Boundary of the county as a PostGIS geometry in SRID 4326 (longitude, latitude), indexed by idx_county_boundaries_geom (GiST) for point-in-county lookups (mv_vehicle_county, 20260713020000). Filled on every row (3,231, 2026-10-07). Release vintage: Unknown (the loader is not in the repo). Unit: degrees. Source: US Census Bureau boundary files, loaded with the table. Grain: one county. Clock: n/a (a boundary change is a new vintage, never an UPDATE).';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'us_county_boundaries', NULL, 'reference load (loader not in the repo)',
       'US county reference table (3,231 counties, key fips, PostGIS boundary): the declared place entity (stack_substrates ''place entity'', 2026-10-07).',
       true,
       'No writer: reference data loaded once (loader and vintage not in the repo). A new boundary release lands as a new vintage through a migration, never an UPDATE. vehicle_location_observations.county_fips and zip_to_fips.fips key to it (NOT VALID, 20261007210000).'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'us_county_boundaries' AND column_name IS NULL);

-- 2. The observation key --------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vehicle_location_observations'::regclass
                 AND conname = 'vehicle_location_observations_county_fips_fkey') THEN
    ALTER TABLE public.vehicle_location_observations
      ADD CONSTRAINT vehicle_location_observations_county_fips_fkey
      FOREIGN KEY (county_fips) REFERENCES public.us_county_boundaries (fips) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT vehicle_location_observations_county_fips_fkey ON public.vehicle_location_observations IS
'The county the observation is keyed to. NOT VALID since 2026-10-07: enforced for new and re-keyed rows; the 3,244 rows coded ''_none'' (last written 2026-03-29) stay unchecked. ON DELETE NO ACTION: a county is never deleted while observations reference it.';
COMMENT ON COLUMN public.vehicle_location_observations.county_fips IS
'County the observation falls in: a US county FIPS code, a foreign key to us_county_boundaries(fips) since 2026-10-07 (NOT VALID: the 3,244 rows coded ''_none'' stay unchecked; a new or re-keyed code must be a county). Filled on 337,576 of 574,905 rows (58.7%, 2026-10-07), 2,217 distinct codes, 2,216 of them counties. Coded by scripts/geocode-backfill.mjs from coordinates (point-in-county against us_county_boundaries) through 2026-03-29 and by nothing since: 0 of the 80,779 rows written in the last 30 days carry a code or coordinates, while 22,196 of the 23,236 October rows carry a postal code (zip_to_fips keys 183,478 of the uncoded rows to a county; that intake repair is separate). Unit: none (code). Source: spatial lookup for the rows through 2026-03; the coder named in metadata when a later writer sets it. Grain: one observation. Clock: as of created_at (when the row was coded), not observed_at. Partial indexes idx_vlo_county_fips and idx_vlo_county_id_page; read by map-vehicles for county and state aggregates.';
COMMENT ON COLUMN public.vehicle_location_observations.county_name IS
'Name of the county in county_fips, copied from us_county_boundaries.name by the coder; not a key (join on county_fips). Filled on 334,332 rows (2026-10-07): every coded row except the 3,244 coded ''_none''; last written 2026-03-29. Unit: none (text). Source: the coder of county_fips. Grain: one observation. Clock: as of created_at.';

-- 3. The crosswalk key ----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.zip_to_fips'::regclass
                 AND conname = 'zip_to_fips_fips_fkey') THEN
    ALTER TABLE public.zip_to_fips
      ADD CONSTRAINT zip_to_fips_fips_fkey
      FOREIGN KEY (fips) REFERENCES public.us_county_boundaries (fips) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT zip_to_fips_fips_fkey ON public.zip_to_fips IS
'The county a ZIP is assigned to. NOT VALID since 2026-10-07: 244 rows name retired or territory codes absent from us_county_boundaries and stay unchecked; a new row must name a county.';
COMMENT ON TABLE public.zip_to_fips IS
'ZIP to county crosswalk: one row per US ZIP code (grain: one ZIP; PRIMARY KEY zip) naming the county FIPS code the ZIP is assigned to. 41,173 rows on 2026-10-07, 3,229 distinct fips. A ZIP can straddle counties; this table keeps one county per ZIP, so a county derived through it is ZIP-grain, not point-grain, and a writer must say so. 244 rows name a fips that is not in us_county_boundaries (Florida 137, Alaska 53, South Dakota 7, Virginia 6, New York 5; 23 states in all: retired and territory codes from another release); they stay unchecked under the NOT VALID key zip_to_fips_fips_fkey, and a new row must name a county. Reference data; the loader and release are not in the repo (Unknown); no row written since the statistics reset. Readers in code on 2026-10-07: none (the intake repair that keys vehicle_location_observations.county_fips from the postal code is the first). Access: RLS on with no policy; service_role and postgres read. Registry: pipeline_registry table-level row, do_not_write_directly. Clock: none.';
COMMENT ON COLUMN public.zip_to_fips.zip IS
'Five-digit US ZIP code, the primary key (every row matches ^[0-9]{5}$, 2026-10-07). 41,173 distinct values. Unit: none (code, text). Source: loaded with the table. Grain: one ZIP. Clock: n/a.';
COMMENT ON COLUMN public.zip_to_fips.fips IS
'County FIPS code the ZIP is assigned to: a foreign key to us_county_boundaries(fips), NOT VALID (244 rows name codes that are not in the county table). Filled on every row; 3,229 distinct values (2026-10-07). Unit: none (code). Source: loaded with the table. Grain: one ZIP. Clock: n/a.';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'zip_to_fips', NULL, 'reference load (loader not in the repo)',
       'ZIP to county FIPS crosswalk (41,173 ZIPs onto 3,229 counties): the key from a postal code to the place entity.',
       true,
       'No writer: reference data loaded once (loader not in the repo). A re-load lands as a migration. Keys to us_county_boundaries(fips), NOT VALID (20261007210000).'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'zip_to_fips' AND column_name IS NULL);

-- 4. The declaration ------------------------------------------------------------------------------------------------------
UPDATE public.stack_substrates
SET declared_table = 'us_county_boundaries',
    declared_at    = now(),
    declared_by    = 'migration 20261007210000 (lead session skylar-64, Claude Fable 5.1), from docs/proposals/2026-10-07-place-entity.md (PR #777)',
    note           = note || ' Declared 2026-10-07: us_county_boundaries, US county grain (3,231 counties, key fips). Keys to it: vehicle_location_observations.county_fips and zip_to_fips.fips (NOT VALID). Not covered: states, regions, countries, non-US places. Live coding of county_fips stopped in 2026-04 (0 of 207,324 rows since); the intake repair through zip_to_fips is separate.'
WHERE substrate = 'place entity' AND declared_table IS NULL;

-- 5. Read the effect where the registry functions exist (skipped in the isolated contract) --------------------------------
DO $$
DECLARE v jsonb; n integer;
BEGIN
  IF to_regprocedure('public.stack_coverage(text)') IS NOT NULL THEN
    SELECT to_jsonb(c) - 'needs' INTO v FROM public.stack_coverage('S01') c;
    RAISE NOTICE 'S01 after the declaration: %', v;
  END IF;
  IF to_regclass('public.v_stacks') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.v_stacks WHERE 'place entity' = ANY (needs_missing);
    RAISE NOTICE 'stacks still missing the place entity: % (10 before)', n;
  END IF;
END $$;

COMMIT;

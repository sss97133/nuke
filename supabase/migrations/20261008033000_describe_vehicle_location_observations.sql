-- Describe vehicle_location_observations: the 18 columns without a comment (2 of 20 had one, county_fips and county_name,
-- written tonight by 20261007210000_declare_place_entity_us_county_boundaries.sql and
-- 20261007213000_key_vehicle_location_county_from_zip.sql and kept unchanged; catalog count on prod, 2026-10-07) and a
-- corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 575,905 rows on 2026-10-07 15:11Z by exact count (the
-- atlas estimate of 574,915 is a stale pg_class.reltuples); rows keep arriving (the newest created 15:11Z).
--
-- METHOD (read 2026-10-07 15:05-15:14Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists),
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy and pg_description; foreign keys in (none) and the 7 materialized
--   views that read it from pg_depend. Exact over the whole table (256 MB heap, 451 MB in all, read only): the counts by
--   source_type, source_platform and load group (told apart by created_at), the fill of every column, the value shapes
--   of country_code, region_code, postal_code, precision and confidence, the clock comparisons, the repeated places of the
--   live writers, the county coding by kind, the Canadian rows, and the photo GPS rows against vehicle_images. The orphan
--   vehicle ids and the vehicles columns the 2026-03-10 load copied come from a 1% block sample (TABLESAMPLE SYSTEM (1)
--   REPEATABLE (20261007), 5,104 rows), because the exact anti-join against vehicles exceeded the 10 s timeout. What anon
--   can read comes from a count under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main aa850dad4 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps): the creating migration supabase/migrations/20251216000003_vehicle_location_
--   observations.sql; 20251216000004_backfill_bat_location_into_canonical.sql; prod migration 20260310191755
--   add_vlo_indexes_and_rls (supabase_migrations.schema_migrations; not in the repo); 20260713020000_vehicle_county_and_
--   filtered_map.sql; 20261004213500_vehicle_location_county_id_page_index.sql; 20261007210000 and 20261007213000; commit
--   bcfdca9a1 (2026-03-10, the hand load) and f20916474 (2026-03-29, the county map); the writers extract-bat-core,
--   extract-cars-and-bids-core and process-cl-queue with supabase/functions/_shared/parseLocation.ts;
--   scripts/geocode-backfill.mjs; the readers map-vehicles, nuke_frontend/src/components/map/ChoroplethMap.tsx,
--   nuke_frontend/src/components/map/panels/MapVehicleDetail.tsx and apps/nuke-capture-ios/Sources/NukeCapture/
--   MarketMapView.swift; the bodies, read with pg_get_functiondef, of the 3 live functions whose body names the table
--   (get_county_vehicles, get_county_detail, key_vehicle_location_county_from_zip) and of the trigger function
--   key_vehicle_location_county; pg_trigger; cron.job (refresh-geo-analysis, jobid 462, inactive; no command writes the
--   table); write_receipts (21 rows); pg_stat_user_tables; pipeline_registry (3 rows; none is added or changed here).
-- LIMITS:
--   The orphan shares and the vehicles columns behind the 2026-03-10 load come from a 1% block sample. Who ran the
--   2026-03-10 load, the 2026-03-29 facebook statement and the pass that set coordinates and county_fips on rows through
--   2026-03-29 is not recorded in the repo or the prod migration log (commit bcfdca9a1 names the first). Live rows arrive
--   while this is read, so counts of live rows move by tens per minute. pg_stat_user_tables counters began at the last
--   server start (2026-09-29 09:20Z). The rows place vehicles of public listings and of one account's own photos: quoted
--   values are platform, precision and region codes, column and function names and counts only; no place text, city,
--   postal code, coordinate, URL, vehicle id or user id.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Where a source placed a vehicle at a moment: one row per location observation (grain: vehicle x source
--   x observed_at) with raw and cleaned text, region, postal code, coordinates and county. Event time = observed_at
--   (source time; 2003 .. 2026). Ingest time = created_at. Writers: extract-bat-core, extract-cars-and-bids-core,
--   process-cl-queue, scripts/geocode-backfill.mjs. Keys only to vehicles: the place is text and codes, not a FK to a
--   geography table." The opening stays. Corrected: observed_at is not a source time on live rows (the writers send their
--   own clock at extraction); scripts/geocode-backfill.mjs writes no row here (its upsert has no matching unique index and
--   no geocoded row exists); county_fips keys to us_county_boundaries since 2026-10-07. Added: the four ways rows came in,
--   the repeated places, the orphans, the readers and the anon read of every row, photo GPS included.
--   Columns county_fips and county_name: unchanged. The county_fips comment credits scripts/geocode-backfill.mjs with the
--   337,576 coordinate-coded rows; no version of that script in the repo names county_fips, so the table comment says
--   the coder of those rows is not recorded.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_location_observations IS
'Where a source placed a vehicle at a moment: one row per location observation (grain: one place of one vehicle as one source gave it; the live writers insert a row on every extraction, so a place repeats). 575,905 rows on 2026-10-07 15:11Z (the atlas estimate of 574,915 is a stale reltuples) for 398,621 vehicles. Four ways in, told apart by created_at (exact): (1) live writers, 278,762 rows since 2026-02-26 and still arriving: extract-bat-core (source_platform bat, 250,977), extract-cars-and-bids-core (carsandbids, 27,762) and process-cl-queue (craigslist, 23, all on 2026-02-26), each inserting source_type listing with the text parsed by supabase/functions/_shared/parseLocation.ts and observed_at set to its own clock; 42.2% of the bat rows and 52.5% of the carsandbids rows repeat a vehicle, URL and place already stored (2026-10-07 15:09Z). (2) A hand load on 2026-03-10 19:18-19:27Z, 265,503 rows in 27 platform spellings, copied from vehicles (place text, coordinates, vehicle dates; metadata.source vehicles) and from vehicle_images GPS (4,165 sightings; metadata.source vehicle_images), recorded only in commit bcfdca9a1 (populated VLO from vehicle_images GPS + vehicles table coordinates). (3) One statement at 2026-03-29 19:12:41Z, 31,602 facebook_marketplace rows with URLs and US places; its writer is not recorded. (4) Migration 20251216000004, 38 bat rows on 2025-12-16. scripts/geocode-backfill.mjs, named as a writer before, writes no row: its upsert names a conflict target with no unique index and no source_type geocoded row exists. Coordinates and county: no live writer sends coordinates; rows created through 2026-03-29 got them from the loads or from an unrecorded pass (37,002 live bat and 21,962 carsandbids rows of 2026-02-26 .. 2026-03-29), and no row created later has them. county_fips keys the place entity us_county_boundaries (foreign key NOT VALID since 2026-10-07): 337,576 rows were coded from coordinates through 2026-03-29 (the coder is not recorded; the county_fips comment names scripts/geocode-backfill.mjs, but no version of it in the repo writes county_fips), and since 2026-10-07 the trigger trg_key_vehicle_location_county (BEFORE INSERT OR UPDATE OF postal_code, region_code) and key_vehicle_location_county_from_zip() key it from the ZIP (184,270 rows with metadata.county_key at 15:11Z; the back-fill wrote 183,519 rows at 11:44-11:46Z under 21 write receipts). Liveness: pg_stat_user_tables counts 36,549 inserts, 183,519 updates (the back-fill) and 0 deletes since the server last started (2026-09-29 09:20Z; read 15:05Z). Orphans: the foreign key to vehicles is ON DELETE CASCADE and validated, yet in a 1% block sample 335 of 2,204 hand-loaded rows (15.2%) and 15 of 2,650 live rows (0.6%) point at a vehicle that is not in vehicles; how is not recorded. Readers: the edge function map-vehicles (service role; county and state aggregates by county_fips); the web map (ChoroplethMap.tsx by bounding box, MapVehicleDetail.tsx per vehicle) and the iOS market map (MarketMapView.swift by county) read it directly with the public key; get_county_vehicles(text) and get_county_detail(text) (SECURITY DEFINER, EXECUTE for anon, no fixed search_path) read it; 7 materialized views select from it (mv_county_market_analysis, mv_make_geographic_density, mv_platform_geographic_coverage, mv_state_market_summary, mv_vehicle_county, vehicle_map_county_data, vehicle_map_state_data; SELECT granted to anon; their refresh job refresh-geo-analysis, jobid 462, is inactive). Access: RLS is on. Public read high confidence observations (SELECT, anon and authenticated, confidence >= 0.5) admits every row, since no row has a lower confidence: anon reads all 575,869 rows counted at 15:05Z, including source_url, place text, ZIP and coordinates, and the exact GPS points and times of the 4,165 photo sightings, 3,179 of which come from photos uploaded or synced by one account. Service role full access (ALL, service_role). anon and authenticated also hold INSERT, UPDATE, DELETE and TRUNCATE, but no policy admits a write for them. Clocks: observed_at is an event time only on hand-loaded and facebook rows; on live rows it is the read time; created_at is the insert time; county_key.at in metadata dates a ZIP key.';

-- ── Identity and subject ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_location_observations.id IS
'Surrogate key of the observation, uuid, gen_random_uuid() default, the PRIMARY KEY; idx_vlo_county_id_page pages a county by (county_fips, id). 575,905 values (2026-10-07 15:11Z). Nothing references it. Unit: none (uuid). Source: column default. Grain: one observation. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_location_observations.vehicle_id IS
'Vehicle the observation places: a vehicles.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), indexed with observed_at (idx_vehicle_location_observations_vehicle_time). 398,621 distinct vehicles (2026-10-07). Despite the validated key, a 1% block sample finds rows whose vehicle is not in vehicles: 335 of 2,204 rows of the 2026-03-10 hand load (15.2%) and 15 of 2,650 live rows (0.6%); how they lost it is not recorded. Readers that join vehicles (the iOS county list) drop those rows. Unit: none (uuid). Source: the writer. Grain: one observation. Clock: n/a.';

-- ── Source ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_location_observations.source_type IS
'Kind of observation, text NOT NULL, no CHECK, indexed (idx_vehicle_location_observations_source_type). 2 values occur (2026-10-07 15:11Z): listing 571,740 (every writer and load except the photo rows) and sighting 4,165 (the photo GPS rows of the 2026-03-10 hand load). The creating migration listed listing, exif, gps, manual and inferred; scripts/geocode-backfill.mjs would write geocoded, but no such row exists. Unit: none (text code). Source: the writer. Grain: one observation. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_location_observations.source_platform IS
'Where the place came from, a free-text slug, text, nullable, filled on every row, no CHECK and no key to observation_sources. 28 values (2026-10-07 15:12Z): bat 363,199 (live, hand load and the December migration), mecum 45,907, barrett-jackson 45,042, facebook_marketplace 32,097, carsandbids 27,762 (live), cars_and_bids 24,942 (hand load), bonhams 17,960, photo_exif 4,165, facebook-marketplace 3,277, craigslist 2,677, then Beverly Hills Car Club, gooding, broad_arrow, gaa-classic-cars, rm-sothebys, collecting_cars, Collective Auto, sbx-cars, pcarmarket, hemmings, unknown, user-submission, Volo Cars, conceptcarz, Motor Vault, ksl, historics and h-and-h. One platform appears under two spellings (carsandbids and cars_and_bids, facebook_marketplace and facebook-marketplace), and dealer names stand where a platform code would. Unit: none (text code). Source: the writer constant, or the vehicles row in the hand load. Grain: one observation. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_location_observations.source_url IS
'Listing page the place was read from, text, nullable. Filled on 310,391 rows (53.9%, 2026-10-07): every live row (bat, carsandbids, craigslist) and the 31,602 facebook_marketplace rows of 2026-03-29; NULL on every row of the 2026-03-10 hand load and of the December migration. Readable by anon (see the table comment). Public listing pages; none is quoted here. Unit: none (URL). Source: the writer. Grain: one observation. Clock: n/a.';

-- ── Clock of the observation ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_location_observations.observed_at IS
'When the source placed the vehicle there, timestamptz NOT NULL, default now(); its meaning depends on the writer. The live writers (extract-bat-core, extract-cars-and-bids-core, process-cl-queue) send new Date() at extraction, so on live rows it is the time the listing was read, a median 0.03 s before created_at, not the time the listing first named the place. The 2026-03-10 hand load copied vehicle dates (in a 1% block sample of its rows whose vehicle exists: the auction end date on 963 of 1,869, the sale date on 733, the vehicle created_at on 854, overlapping; the rule is not recorded), 1903-05-24 .. 2034-07-26; its photo rows carry vehicle_images.taken_at (on all 3,936 whose image still exists; 10 before 1990). The 2026-03-29 facebook rows span 2026-02-03 .. 2026-03-29 (rule not recorded); the December migration used the listing start date or last update. 8 rows lie in the future (bat 3 in 2031, sbx-cars 3, broad_arrow 1, collecting_cars 1; 2026-10-07). Indexed with vehicle_id and inside idx_vlo_map_query; the index on it alone from prod migration 20260310191755 (idx_vlo_time) is absent. Unit: timestamptz. Source: the writer. Grain: one observation. Clock: event time on hand-loaded and facebook rows; read time (writer clock) on live rows.';

-- ── Place text ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_location_observations.location_text_raw IS
'Place text as the source gave it, text, nullable. Filled on every listing row (571,740) and NULL on the 4,165 photo sightings (2026-10-07). Live rows: the listing location string before parsing. Hand-loaded rows: vehicles.listing_location (equal on 1,796 of 1,869 rows of a 1% block sample whose vehicle exists). Seller places of public listings (city, state, sometimes a ZIP); none is quoted here. Unit: none (text). Source: the listing page, or the vehicles row. Grain: one observation. Clock: as of observed_at.';
COMMENT ON COLUMN public.vehicle_location_observations.location_text_clean IS
'Normalised place text from parseLocation (City, ST or City, ST 12345), text, nullable. Filled on every live row (the writers insert only when the text parsed) and on the 38 December rows; NULL on the facebook rows and on all but 1 hand-loaded row (2026-10-07). Unit: none (text). Source: supabase/functions/_shared/parseLocation.ts. Grain: one observation. Clock: as of observed_at.';

-- ── Structured place ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_location_observations.country_code IS
'Country, text, nullable. Filled on 34,322 rows (2026-10-07): US on the 31,602 facebook_marketplace rows of 2026-03-29 and CA (Canada; province codes AB, BC, MB, NB, NL, NS, ON, PE, QC and SK in region_code) on 2,720 bat rows of the 2026-03-10 hand load. NULL everywhere else, US rows included, so NULL does not mean an unknown country; on live rows a two-letter region_code marks a US place. No live writer sets it. 34 of the Canadian rows carry a US county code from the coordinate coding. Unit: none (ISO 3166-1 alpha-2 code). Source: the hand load or the facebook statement. Grain: one observation. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_location_observations.region_code IS
'State or province code, text, nullable. Filled on 483,362 rows (2026-10-07), two upper-case letters on all but 23 facebook rows that hold longer names. Live writers store the parser state: a US state code, or NULL for a place it cannot map, so a two-letter code marks a US place on live rows; the hand load stored the vehicle state, Canadian provinces included (see country_code). The ZIP county key fires only on two upper-case letters. Unit: none (state or province code). Source: parseLocation, or the vehicles row. Grain: one observation. Clock: as of observed_at.';
COMMENT ON COLUMN public.vehicle_location_observations.city IS
'City name, text, nullable. Filled on 491,253 rows (2026-10-07): nearly every live row (from parseLocation), 180,998 hand-loaded rows (from the vehicles row) and every facebook row. Public place names; none is quoted here. Unit: none (text). Source: the writer. Grain: one observation. Clock: as of observed_at.';
COMMENT ON COLUMN public.vehicle_location_observations.postal_code IS
'US ZIP code as parsed, text, nullable. Filled on 270,693 rows (2026-10-07), live rows only (the hand load, the facebook statement and the December migration set none); every value is five digits or five plus four. parseLocation takes the first such group in the raw text. The trigger trg_key_vehicle_location_county keys county_fips from it through zip_to_fips when region_code is two letters (see county_fips). Unit: none (ZIP code). Source: parseLocation. Grain: one observation. Clock: as of observed_at.';
COMMENT ON COLUMN public.vehicle_location_observations.latitude IS
'Latitude in decimal degrees (datum not recorded), double precision, nullable, indexed with longitude (idx_vlo_bbox, idx_vlo_map_query). Filled on 353,051 rows (61.3%, 2026-10-07), all within -90 .. 90, none at 0,0: the hand-loaded rows (copied from vehicles.gps_latitude on 1,867 of 1,869 sampled rows whose vehicle exists, or from the photo EXIF in vehicle_images), 28,585 facebook rows and live rows created 2026-02-26 .. 2026-03-29 that an unrecorded pass geocoded (37,002 bat, 21,962 carsandbids). No live writer sends it, and no row created after 2026-03-29 19:12Z has it. Readable by anon, photo GPS included (see the table comment). Unit: degrees. Source: the loads or the unrecorded geocoding pass. Grain: one observation. Clock: as of observed_at.';
COMMENT ON COLUMN public.vehicle_location_observations.longitude IS
'Longitude in decimal degrees (datum not recorded), double precision, nullable; filled exactly where latitude is (353,051 rows, 2026-10-07), all within -180 .. 180. Same sources, gaps and readers as latitude. Unit: degrees. Source: the loads or the unrecorded geocoding pass. Grain: one observation. Clock: as of observed_at.';
COMMENT ON COLUMN public.vehicle_location_observations.precision IS
'Granularity the writer claims, text, nullable, no CHECK, filled on every row (2026-10-07): city 551,822, region 18,273, gps 5,777 (the 4,165 photo sightings and 1,612 facebook rows), country 8 and region 30 on the December rows by their rule (a comma in the text means region), address 1 (a hand-loaded craigslist row). Live writers write city when the parser found a city, else region. The creating migration listed country, region, city and point; gps stands for point. Unit: none (text code). Source: the writer. Grain: one observation. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_location_observations.confidence IS
'Writer confidence in the place, real, nullable, filled on every row (2026-10-07). Live rows copy parseLocation: 0.9 with city, state and ZIP, 0.8 with city and state, 0.6 or 0.5 when the text did not parse to a state, so it measures how completely the text parsed, not whether the place is right. The hand load wrote 0.5 to 0.95 by precision (0.95 on photo GPS), the facebook statement 0.8 or 0.95, the December migration 0.7. Values: 0.9 on 294,577, 0.8 on 203,991, 0.85 on 38,252, 0.5 on 18,090, 0.6 on 7,989, 0.75 on 7,135, 0.95 on 5,777, 0.7 on 44, 0.65 on 37, and 95 on 1 hand-loaded craigslist row, a percentage on a 0 to 1 scale. Every value is at least 0.5, so the anon read policy (confidence >= 0.5) admits every row. Indexed where at least 0.5 (idx_vlo_confidence). Unit: ratio (0 to 1), except the one row. Source: the writer. Grain: one observation. Clock: n/a.';

-- ── Extras and ingest clock ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_location_observations.metadata IS
'Writer extras, jsonb NOT NULL, default {}. Non-empty on 449,800 rows (2026-10-07): county_key {method zip_to_fips, zip, grain, at, writer} on the rows keyed from the ZIP (184,270 at 15:11Z; see county_fips); source (vehicles or vehicle_images) and event_type (listing or sighting) on the 265,503 rows of the 2026-03-10 hand load, plus image_id (a vehicle_images.id) on its 4,165 photo rows; backfill and source (migration_20251216000004) on the 38 December rows. The live writers send {} and the facebook statement wrote {}. Unit: none (jsonb). Source: the writer, then the ZIP county key. Grain: one observation. Clock: county_key.at for the key; else as of created_at.';
COMMENT ON COLUMN public.vehicle_location_observations.created_at IS
'When the row was inserted: default now(), the transaction clock of the insert (no writer sends it), timestamptz NOT NULL, not indexed. 2025-12-16 17:46Z .. 2026-10-07 15:11Z (2026-10-07). It tells the four ways in apart: 2025-12-16 17:46:40Z (38 rows, migration 20251216000004); 2026-03-10 19:18:05Z .. 19:27:43Z (265,503 rows, the hand load); 2026-03-29 19:12:41Z (31,602 facebook rows, one statement); the live writers from 2026-02-26 16:11Z on (36,585 rows since the server started on 2026-09-29 09:20Z). On live rows it trails observed_at by a median 0.03 s. Unit: timestamptz. Source: column default. Grain: one observation. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_location_observations'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_location_observations: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_location_observations columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

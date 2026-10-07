-- Describe epa_fuel_economy: all 40 columns, none had a COMMENT ON COLUMN (0 of 40 described before, catalog count on
-- prod, 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Idle table in the atlas: 49,846 rows on 2026-10-07 11:05Z by exact count (equal to the
-- atlas estimate), loaded once on 2026-05-02, no insert, update, delete or scan since the statistics counters began.
--
-- METHOD (read 2026-10-07 10:58-11:15Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants and existing comments from pg_attribute,
--   pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy, information_schema and pg_description. Fill, values,
--   distributions and date windows are exact counts over the whole table (97 MB heap, read only, one scan per query). The
--   mapping of each typed column to its CSV header was proven on the data: for each of the 36 typed columns the number of
--   rows where the column is not distinct from the cast of raw_record->>header (the strings NA and empty read as NULL) is
--   49,846 of 49,846. What anon can read comes from a count under SET LOCAL ROLE anon in a read-only transaction.
--   "Filled" means non-NULL.
--   Writers and readers from code at origin/main d77fc17cd (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs; also a whole-repo case-insensitive search for the table name and a pickaxe
--   search of git history: no hit anywhere), from prod: 0 hits in pg_proc (function bodies), cron.job, pg_depend
--   (views and rules), pg_trigger and write_receipts; pg_stat_user_tables; pipeline_registry (no row); and the applied
--   migration log supabase_migrations.schema_migrations, which holds version 20260502032609 create_epa_fuel_economy (the
--   statements are the CREATE TABLE of these 40 columns, the two indexes and the old table comment; it is not in the repo).
--   Related code that does not write this table: scripts/import-epa-fuel-economy.mjs, which downloads the same
--   vehicles.csv.zip but inserts into oem_vehicle_specs.
-- LIMITS:
--   The loader is not in the repo and the log keeps no run record, so the load is dated by created_at and by the version
--   above. The meaning of each EPA field is taken from EPA published data dictionary for vehicles.csv (fueleconomy.gov)
--   and checked against the ranges in the data; where the data or the repo cannot confirm it, the comment says so
--   (the S value of guzzler). EPA changes the file between releases; this table holds the 2026-05-02 download only. The
--   table holds a government dataset and no personal data; quoted values are categorical codes, labels and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "EPA fueleconomy.gov vehicles.csv ingest. ~45K rows, 1984+. Source: ...". It stays true in
--   substance (49,846 rows, not about 45K); it now adds the grain, the load, the shape, the placeholders, the readers, the
--   access and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.epa_fuel_economy IS
'EPA fueleconomy.gov vehicles.csv, loaded once: one row per EPA vehicle record (grain: one EPA record, the CSV id, PRIMARY KEY epa_id), meaning one model year + make + model + engine + transmission + drive configuration as EPA publishes it, not one row per vehicle in our database. Source: https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip. 49,846 rows on 2026-10-07 (exact), model years 1984 .. 2026 (1984-1989 8,405; 1990s 9,572; 2000s 10,656; 2010s 12,318; 2020-2026 8,895; about 1,150 to 1,330 a year from 2023), 146 makes, 5,560 models; epa_id runs 1 .. 50,311 with 465 ids absent. Idle: every row was created in one load, 2026-05-02 03:26:40Z .. 03:31:15Z (4 min 35 s), 31 seconds after prod migration 20260502032609 create_epa_fuel_economy created the table (applied by the account that owns the project; the migration is in the prod migration log and not in the repo); source_csv_version is 2026-05-02 on every row, created_at equals updated_at on every row, and pg_stat shows 0 writes and 0 scans since the counters began. The loader is unknown: no writer found in the repo on 2026-10-07; scripts/import-epa-fuel-economy.mjs downloads the same CSV but inserts into oem_vehicle_specs (44,523 EPA rows there, loaded 2026-03-23, deduplicated), not here. Shape: 36 typed columns hold the CSV fields the loader chose, each equal to its CSV header on every row (exact check on all 49,846 rows; the header name is in each column comment; the strings NA and empty load as NULL), and raw_record keeps the whole CSV record as JSON with 84 keys on every row, all values as strings, so 48 CSV fields exist only there (among them createdOn and modifiedOn, the EPA record dates; the unrounded mpg fields city08U, comb08U, highway08U and their alternate-fuel and utility-factor variants; electric range and charge time fields; barrels08, engId, mpgData, youSaveSpend; the full list is in the raw_record comment). EPA placeholder values are kept as loaded: co2_gpm is -1 on 31,939 rows (64.1%, all in model years 1984 .. 2012), ghg_score and fe_score are -1 on the same 32,012 rows (64.2%, none after 2025), and the alternate-fuel and plug-in columns hold 0, not NULL, when the vehicle has no second fuel. Readers: none. No function body, view, rule, policy, trigger, cron.job command, edge function, script or frontend code names it; pg_stat shows 0 reads; no write receipts; no pipeline_registry row. A drop-list candidate (101 MB): idle since its load and reproducible from the public CSV, recorded as a fact and not decided here. It overlaps what oem_vehicle_specs already carries for the EPA slice (same source file, earlier load: 25,959 distinct year + make + model there against 25,998 here). Access: RLS is on with no policy, so anon sees 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07) although anon and authenticated hold every table privilege; service_role and postgres read it. Indexes: the primary key, (year, make, model) and (lower(make), lower(model)). Clocks: created_at = updated_at = the load time (our ingest); year is the model year (the event time of the record); EPA own record dates are inside raw_record.';

-- ── Identity and vehicle ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.epa_id IS
'EPA vehicle record id: CSV header id, integer, NOT NULL, the PRIMARY KEY. 49,846 distinct values (2026-10-07), range 1 .. 50,311 with 465 ids absent in the range. Identifies one EPA record (a model year + make + model + engine, transmission and drive configuration), not a vehicle in vehicles; nothing in our database keys to it (no foreign key into the table). Unit: none (integer id). Source: CSV header id. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.year IS
'Model year of the EPA record: CSV header year, integer. Filled on all 49,846 rows (2026-10-07), 1984 .. 2026: 1984-1989 8,405 rows, 1990s 9,572, 2000s 10,656, 2010s 12,318, 2020-2026 8,895; 2023 1,330, 2024 1,277, 2025 1,273, 2026 1,150. Indexed with make and model. Unit: model year. Source: CSV header year. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.make IS
'Manufacturer name as EPA spells it: CSV header make, text. Filled on all rows; 146 distinct values (2026-10-07). Not keyed to a make table, so match with lower() as the index on (lower(make), lower(model)) does; our other tables spell makes by their own rules. Unit: none (text). Source: CSV header make. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.model IS
'Model name as EPA spells it: CSV header model, text. Filled on all rows; 5,560 distinct values (2026-10-07). EPA model names often carry drive or body words: 20,224 rows (40.6%) contain 2WD, 4WD, AWD, FWD or RWD. Not keyed to a model table. Unit: none (text). Source: CSV header model. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.base_model IS
'EPA base model name, the model without its variant words: CSV header baseModel, text. Filled on all rows; 1,491 distinct values (2026-10-07), against 5,560 for model. Unit: none (text). Source: CSV header baseModel. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.vehicle_class IS
'EPA vehicle size class: CSV header VClass, text. Filled on all rows; 34 distinct values (2026-10-07), the largest Compact Cars 6,599, Midsize Cars 5,866, Subcompact Cars 5,799, Large Cars 2,778, Two Seaters 2,514, Standard Pickup Trucks 2,354. A size and type class, not a body style. Unit: none (text). Source: CSV header VClass. Grain: one EPA vehicle record. Clock: n/a.';

-- ── Fuels ───────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.fuel_type IS
'EPA fuel description, one phrase covering both fuels of a dual-fuel vehicle: CSV header fuelType, text. Filled on all rows; 16 distinct values (2026-10-07): Regular 29,639, Premium 15,192, Electricity 1,425, Gasoline or E85 1,410, Diesel 1,310, Premium and Electricity 252, Midgrade 169, Regular Gas and Electricity 131, Premium or E85 128, CNG 60, Premium Gas or Electricity 55, Hydrogen 42 and 4 smaller values. Use fuel_type1 for the primary fuel. Unit: none (text). Source: CSV header fuelType. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.fuel_type1 IS
'Primary fuel (EPA fuel 1; the mpg, CO2 and fuel cost columns without alt in their name refer to it): CSV header fuelType1, text. Filled on 49,845 rows (2026-10-07): Regular Gasoline 31,212, Premium Gasoline 15,627, Electricity 1,425, Diesel 1,310, Midgrade Gasoline 169, Natural Gas 60, Hydrogen 42; NULL on 1 row, a 2025 vehicle described as electricity and hydrogen. Unit: none (text). Source: CSV header fuelType1. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.fuel_type2 IS
'Second fuel of a dual-fuel vehicle (EPA fuel 2; the alt columns refer to it): CSV header fuelType2, text. Filled on 2,008 rows (4.0%, 2026-10-07): E85 1,538, Electricity 442, Natural Gas 20, Propane 8; NULL on 47,838 single-fuel rows. Unit: none (text). Source: CSV header fuelType2. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.atv_type IS
'EPA alternative-fuel or advanced-technology type: CSV header atvType, text. Filled on 6,550 rows (13.1%, 2026-10-07): Hybrid 1,786, FFV 1,538, EV 1,425, Diesel 1,238, Plug-in Hybrid 442, CNG 50, FCV 42, Bifuel (CNG) 20, Bifuel (LPG) 8, eFCV 1; NULL on 43,296 rows, the conventional gasoline vehicles. Unit: none (text). Source: CSV header atvType. Grain: one EPA vehicle record. Clock: n/a.';

-- ── Fuel economy ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.city_mpg IS
'EPA city fuel economy on fuel 1, whole miles per gallon: CSV header city08, integer. Filled on all rows (2026-10-07), 6 .. 153, no zero. Electric and plug-in vehicles are rated in miles per gallon equivalent: the maximum among rows with no atv_type is 44. A rating from EPA test cycles, not observed on any vehicle of ours. Unit: miles per gallon (MPGe for electric). Source: CSV header city08. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.highway_mpg IS
'EPA highway fuel economy on fuel 1, whole miles per gallon: CSV header highway08, integer. Filled on all rows (2026-10-07), 9 .. 142, no zero; electric vehicles in MPGe. A rating, not observed on any vehicle of ours. Unit: miles per gallon (MPGe for electric). Source: CSV header highway08. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.comb_mpg IS
'EPA combined city and highway fuel economy on fuel 1: CSV header comb08, integer. Filled on all rows (2026-10-07), 7 .. 146, no zero: electric vehicles 28 .. 146 (MPGe), conventional vehicles (no atv_type) at most 48. A rating, not observed on any vehicle of ours. Unit: miles per gallon (MPGe for electric). Source: CSV header comb08. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.city_mpg_alt IS
'EPA city fuel economy on fuel 2 (fuel_type2): CSV header cityA08, integer. Filled on every row but 0 means no second fuel, not a measured zero: non-zero on 2,009 rows (4.0%, 2026-10-07), maximum 145. Unit: miles per gallon (MPGe for electric). Source: CSV header cityA08. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.highway_mpg_alt IS
'EPA highway fuel economy on fuel 2 (fuel_type2): CSV header highwayA08, integer. Filled on every row but 0 means no second fuel: non-zero on 2,009 rows (4.0%, 2026-10-07). Unit: miles per gallon (MPGe for electric). Source: CSV header highwayA08. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.comb_mpg_alt IS
'EPA combined fuel economy on fuel 2 (fuel_type2): CSV header combA08, integer. Filled on every row but 0 means no second fuel: non-zero on 2,009 rows (4.0%, 2026-10-07), maximum 133. Unit: miles per gallon (MPGe for electric). Source: CSV header combA08. Grain: one EPA vehicle record. Clock: event time (model year, as published).';

-- ── Emissions, scores and cost ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.co2_gpm IS
'EPA tailpipe CO2 on fuel 1 in grams per mile, one of two CO2 fields in the file: CSV header co2, numeric. Filled on all rows (2026-10-07) but -1 means not available: -1 on 31,939 rows (64.1%), all in model years 1984 .. 2012; real values start at model year 1998; 0 on 1,468 rows, exactly the electric and fuel-cell vehicles; maximum 979. Equal to co2_tailpipe_gpm on 17,907 rows. Prefer co2_tailpipe_gpm, which has no -1. Unit: grams per mile. Source: CSV header co2. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.co2_tailpipe_gpm IS
'EPA tailpipe CO2 on fuel 1 in grams per mile: CSV header co2TailpipeGpm, numeric. Filled on all rows (2026-10-07) with no -1 placeholder; 0 on 1,468 rows, exactly the electric and fuel-cell vehicles (atv_type EV, FCV, eFCV); maximum 1,269.57, and fractional for some vehicles. Unit: grams per mile. Source: CSV header co2TailpipeGpm. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.ghg_score IS
'EPA greenhouse gas score, 1 .. 10, with -1 meaning no score: CSV header ghgScore, integer. Filled on all rows (2026-10-07); -1 on 32,012 rows (64.2%), the same rows as fe_score = -1, in model years up to 2025; first scored model year 2013. Unit: score, 1 .. 10 (-1 = none). Source: CSV header ghgScore. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.fe_score IS
'EPA fuel economy score, 1 .. 10, with -1 meaning no score: CSV header feScore, integer. Filled on all rows (2026-10-07); -1 on 32,012 rows (64.2%), the same rows as ghg_score = -1. Unit: score, 1 .. 10 (-1 = none). Source: CSV header feScore. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.fuel_cost08 IS
'EPA estimated annual fuel cost on fuel 1, whole US dollars a year, under the mileage and fuel price assumptions EPA states in its data dictionary, not a price observed on any vehicle: CSV header fuelCost08, integer. Filled on all rows (2026-10-07), 0 .. 9,900; 0 on 43 rows. Unit: US dollars per year (EPA estimate). Source: CSV header fuelCost08. Grain: one EPA vehicle record. Clock: as of the CSV version (source_csv_version).';

-- ── Engine and drivetrain ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.displacement IS
'Engine displacement in liters: CSV header displ, numeric. Filled on 48,377 rows (97.1%, 2026-10-07), 0.0 .. 8.4 (0.0 on 1 row); NULL on 1,469 rows (2.9%), almost all electric and fuel-cell vehicles (1,467 of them). Unit: liters. Source: CSV header displ. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.cylinders IS
'Engine cylinders: CSV header cylinders, integer. Filled on 48,375 rows (97.0%, 2026-10-07): 4 on 19,302, 6 on 16,582, 8 on 10,218, 5 on 780, 12 on 760, 3 on 449, 10 on 199, 2 on 63, 16 on 22; NULL on 1,471 rows, 1,468 of them electric and fuel-cell vehicles. Unit: count. Source: CSV header cylinders. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.drive IS
'Drive axle type as EPA words it: CSV header drive, text. Filled on 48,660 rows (97.6%, 2026-10-07), 7 values: Front-Wheel Drive 15,821, Rear-Wheel Drive 15,753, 4-Wheel or All-Wheel Drive 6,645, All-Wheel Drive 6,530, 4-Wheel Drive 2,685, Part-time 4-Wheel Drive 719, 2-Wheel Drive 507; NULL on 1,186. Unit: none (text). Source: CSV header drive. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.transmission IS
'Transmission type and gears as EPA words it: CSV header trany, text. Filled on 49,835 rows (2026-10-07), 40 distinct values, the largest Automatic 4-spd 11,048, Manual 5-spd 8,392, Automatic (S8) 3,615, Automatic (S6) 3,379, Automatic 3-spd 3,151, Manual 6-spd 3,136; NULL on 11 rows. Unit: none (text). Source: CSV header trany. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.trans_dscr IS
'EPA transmission descriptor, extra features of the transmission: CSV header trans_dscr, text. Filled on 15,044 rows (30.2%, 2026-10-07), 52 distinct values, the largest CLKUP 7,809, SIL 2,189, 2MODE CLKUP 1,235, Creeper 525, 3MODE CLKUP 517; NULL otherwise. Unit: none (text). Source: CSV header trans_dscr. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.eng_dscr IS
'EPA engine descriptor, such as injection type: CSV header eng_dscr, text. Filled on 31,637 rows (63.5%, 2026-10-07), 626 distinct values, the largest SIDI 9,331, (FFS) 8,827, SIDI & PFI 1,173, (FFS) CA model 926; NULL on 18,209 rows. Unit: none (text). Source: CSV header eng_dscr. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.start_stop IS
'Whether the vehicle has engine start-stop technology: CSV header startStop, text, Y or N. Filled on 18,157 rows (36.4%, 2026-10-07): N 9,552, Y 8,605; NULL on 31,689 rows, where EPA gives no value (first filled model year 1998). Unit: none (Y or N). Source: CSV header startStop. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.t_charger IS
'Turbocharger flag: CSV header tCharger, text. T on 11,532 rows (23.1%, 2026-10-07); NULL on the other 38,314, so NULL means not flagged. Unit: none (T or NULL). Source: CSV header tCharger. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.s_charger IS
'Supercharger flag: CSV header sCharger, text. S on 1,144 rows (2.3%, 2026-10-07); NULL on the other 48,702, so NULL means not flagged. Unit: none (S or NULL). Source: CSV header sCharger. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.guzzler IS
'Gas guzzler flag: CSV header guzzler, text. Filled on 2,833 rows (5.7%, 2026-10-07): G 1,854, T 964, S 15; NULL on 47,013. EPA documents G and T as vehicles subject to the gas guzzler tax; the meaning of S is not documented in the repo. Unit: none (code). Source: CSV header guzzler. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.mfr_code IS
'EPA three-character manufacturer code: CSV header mfrCode, text. Filled on 19,038 rows (38.2%, 2026-10-07), 58 distinct values; NULL on every row through model year 2008, first filled in model year 2009, still NULL on some rows through 2011, and filled on every row from 2012. Unit: none (text code). Source: CSV header mfrCode. Grain: one EPA vehicle record. Clock: n/a.';

-- ── Plug-in hybrids ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.phev_blended IS
'Whether a plug-in hybrid runs on a blend of gasoline and electricity in charge-depleting mode: CSV header phevBlended, boolean. Filled on every row (2026-10-07): true on 383 rows (0.8%), false on 49,463, including every vehicle that is not a plug-in hybrid. Unit: none (boolean). Source: CSV header phevBlended. Grain: one EPA vehicle record. Clock: n/a.';
COMMENT ON COLUMN public.epa_fuel_economy.phev_city IS
'EPA composite gasoline and electricity city fuel economy of a plug-in hybrid: CSV header phevCity, integer. Filled on every row but 0 means not a plug-in hybrid: non-zero on 443 rows (0.9%, 2026-10-07). Unit: miles per gallon equivalent. Source: CSV header phevCity. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.phev_hwy IS
'EPA composite gasoline and electricity highway fuel economy of a plug-in hybrid: CSV header phevHwy, integer. Filled on every row but 0 means not a plug-in hybrid: non-zero on 443 rows (0.9%, 2026-10-07). Unit: miles per gallon equivalent. Source: CSV header phevHwy. Grain: one EPA vehicle record. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.epa_fuel_economy.phev_comb IS
'EPA composite gasoline and electricity combined fuel economy of a plug-in hybrid: CSV header phevComb, integer. Filled on every row but 0 means not a plug-in hybrid: non-zero on 443 rows (0.9%, 2026-10-07), maximum 101. Unit: miles per gallon equivalent. Source: CSV header phevComb. Grain: one EPA vehicle record. Clock: event time (model year, as published).';

-- ── Provenance and row clocks ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.epa_fuel_economy.raw_record IS
'The whole CSV record of the EPA row as a JSON object, NOT NULL: 84 keys on every row (2026-10-07), every value a string (numbers, dates and the text NA included). It holds the 36 CSV fields that are also typed columns and 48 that exist only here: createdOn and modifiedOn (EPA record dates, text), city08U, cityA08U, comb08U, combA08U, highway08U, highwayA08U, UCity, UCityA, UHighway, UHighwayA, cityE, combE, highwayE, cityCD, combinedCD, highwayCD, cityUF, combinedUF, highwayUF, range, rangeA, rangeCity, rangeCityA, rangeHwy, rangeHwyA, charge120, charge240, charge240b, c240Dscr, c240bDscr, barrels08, barrelsA08, co2A, co2TailpipeAGpm, fuelCostA08, ghgScoreA, youSaveSpend, engId, evMotor, mpgData, hlv, hpv, lv2, lv4, pv2 and pv4. Use it for any CSV field with no typed column. Unit: none (jsonb of strings). Source: the CSV row. Grain: one EPA vehicle record. Clock: as of source_csv_version.';
COMMENT ON COLUMN public.epa_fuel_economy.source_csv_version IS
'Label of the CSV download the row came from, text. 2026-05-02 on all 49,846 rows (2026-10-07), the same date as the load, so it is our label for the download and not an EPA release number; EPA own record dates are raw_record createdOn and modifiedOn. Unit: none (text, a date). Source: the loader. Grain: one EPA vehicle record. Clock: ingest time (the download date).';
COMMENT ON COLUMN public.epa_fuel_economy.created_at IS
'When the row was inserted: default now(), NOT NULL. 2026-05-02 03:26:40Z .. 03:31:15Z on all 49,846 rows (2026-10-07), one load of 4 min 35 s; equal to updated_at on every row. Ingest time of our load, not an EPA date. Unit: timestamptz. Source: column default. Grain: one EPA vehicle record. Clock: ingest time.';
COMMENT ON COLUMN public.epa_fuel_economy.updated_at IS
'When the row was last written: default now(), NOT NULL, no update trigger. Equal to created_at on every row (2026-10-07), because the table has had no update since the load (pg_stat: 0). Unit: timestamptz. Source: column default. Grain: one EPA vehicle record. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.epa_fuel_economy'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'epa_fuel_economy: every column has a comment';
  ELSE
    RAISE NOTICE 'epa_fuel_economy columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

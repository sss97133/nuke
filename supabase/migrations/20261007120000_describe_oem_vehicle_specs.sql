-- Describe oem_vehicle_specs: the 44 columns with no COMMENT ON COLUMN (0 of 44 described before, catalog count on
-- prod, 2026-10-07 05:20Z) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-07 05:20-05:25Z UTC):
--   Columns, defaults, constraints and triggers from information_schema, pg_constraint and pg_trigger; fill per column
--   counted on the whole table (57,902 rows); value shapes from pg_stats. Writers from code at origin/main 582419f4f:
--   supabase/migrations/20251102000003_oem_factory_specs.sql (creating file, 15 seed rows), scripts/import-nhtsa-catalog.mjs
--   (NHTSA vPIC catalog), scripts/import-epa-fuel-economy.mjs (EPA vehicles.csv), and the live trigger function
--   link_document_to_specs() (trigger trg_link_doc_to_specs on library_documents; its body was read from pg_proc, it is
--   not the apply_extraction_to_specs() of 20251122_extraction_backend.sql, which does not exist on prod).
--   Readers: the live function auto_populate_vehicle_specs() (fuzzy make/model/year match, copies specs into empty
--   vehicles columns), scripts/derive-specs-from-ymm.py and scripts/derive-specs-text-fields.py (same overlay by hand),
--   scripts/discovery/configuration-catalog-relations.sql (source_library_id). The vehicles trigger
--   trg_auto_populate_vehicle_specs is still attached, but its function trigger_auto_populate_specs() is a no-op on prod
--   (RETURN NEW), so nothing copies specs at vehicle insert.
-- Rows by source (2026-10-07 05:20Z): EPA_fueleconomy_gov 44,523 and NHTSA_VPIC 13,340 (both created 2026-03-23),
--   Reference Library 31 (2025-11-21 .. 2026-03-23), GM_Heritage 5 and NHTSA 3 (the 2025-11 seed rows).
-- LIMITS:
--   The two import scripts ran by hand and left no run log in the database; their runs are dated by created_at only.
--   No row keeps the source record's own id as a column or the source release date. Units are the writers' units; none
--   is enforced by a CHECK.
-- CHANGED EXISTING COMMENTS:
--   Table comment: it said "factory OEM specifications for auto-populating vehicle data"; 99.9% of rows are EPA and
--   NHTSA catalog rows with no dimensions or weights, and the insert-time auto-populate is off. It now names the grain
--   per source, the writers, the fill and the clocks.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.oem_vehicle_specs IS
'Reference catalog of make, model and model-year rows with whatever specifications the source carries; not one row per factory configuration. 57,902 rows (2026-10-07). Three sources with different grains: EPA_fueleconomy_gov 44,523 rows (scripts/import-epa-fuel-economy.mjs, 2026-03-23; one row per year + make + model + displacement + transmission + drive, the first EPA record of each combination kept), with engine, transmission, drive, fuel type, EPA size class and mpg; NHTSA_VPIC 13,340 rows (scripts/import-nhtsa-catalog.mjs, 2026-03-23; one row per make + model + model year, case-insensitive), with names and years only; and 39 hand or document rows (8 seed rows from the creating migration, 2025-11, GM trucks with dimensions, weights and paint codes; 31 Reference Library rows created by the trigger link_document_to_specs when a library document lands). Read by auto_populate_vehicle_specs() and by the hand scripts derive-specs-*.py, which copy values into empty vehicles columns by make/model/year match; the insert trigger on vehicles that called it is a no-op on prod. Values are the source''s published claims, not observations of a vehicle. Clock: created_at is ingest time; there is no event time.';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.id IS
'Surrogate key of the row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by reference_libraries.oem_spec_id (foreign key; set by link_document_to_specs), the only foreign key into the table on prod (2026-10-07). Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.make IS
'Manufacturer name as the source spells it, NOT NULL, not keyed to a make table. EPA rows: the EPA make field; NHTSA rows: the vPIC Make_Name (often upper case, e.g. FORD beside Ford); seed and library rows: typed or copied from reference_libraries.make. 141 distinct values (pg_stats, 2026-10-07); case differs between sources, readers match with ILIKE. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.model IS
'Model name as the source spells it, NOT NULL. EPA rows carry EPA model names, which embed drive and body (e.g. F150 Pickup 2WD, Sierra 1500 4WD); NHTSA rows carry vPIC Model_Name; library rows built by link_document_to_specs use series + body_style, else reference_libraries.model, else the literal Unknown. About 5,700 distinct values (pg_stats). Not keyed to a model table; auto_populate_vehicle_specs matches it to vehicles.model by exact, prefix and suffix-stripped ILIKE. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.year_start IS
'First model year the row covers, NOT NULL. EPA and NHTSA rows: the single model year (year_end = year_start). Seed rows: the first year of a range (e.g. 1973). Library rows: reference_libraries.year. Range 1901 .. 2026 (2026-10-07). Unit: model year. Grain: one catalog row. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.oem_vehicle_specs.year_end IS
'Last model year the row covers, inclusive. Equal to year_start on all EPA and NHTSA rows; the last year of the range on seed rows; NULL on the 31 rows link_document_to_specs created (readers treat NULL as open-ended). Unit: model year. Grain: one catalog row. Clock: event time (model year, as published).';
COMMENT ON COLUMN public.oem_vehicle_specs.trim_level IS
'Trim name (e.g. Cheyenne, Silverado, SLE). Filled only on the 8 seed rows (2026-10-07); neither import script writes it. auto_populate_vehicle_specs prefers a row whose trim_level matches vehicles.trim. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.series IS
'Manufacturer series code (e.g. C10, K10, K5, K1500). Filled on 14 rows: the seed rows and library rows copied from reference_libraries.series (2026-10-07). link_document_to_specs matches on it. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.body_style IS
'Body description, two vocabularies. EPA rows: the EPA vehicle size class VClass (e.g. Compact Cars, Midsize Cars, Standard Pickup Trucks, Small Sport Utility Vehicle 4WD), which is a size and type class, not a body style. Seed and library rows: a body name (e.g. Pickup Short Bed, SUV 2-door). NULL on NHTSA rows. Filled on 44,546 rows (2026-10-07). auto_populate_vehicle_specs and derive-specs-*.py copy it into an empty vehicles.body_style, so EPA class names can land there. Unit: none. Grain: one catalog row. Clock: n/a.';

-- ── Dimensions and weights (seed rows only) ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.wheelbase_inches IS
'Wheelbase. Filled on the 8 seed rows only (GM_Heritage 5, NHTSA 3; 2026-10-07); no import writes it. Unit: inches. Source: the seed migration (GM_Heritage / NHTSA labels, no document cited). Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.length_inches IS
'Overall length. Filled on 8 seed rows only (2026-10-07). Unit: inches. Source: the seed migration. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.width_inches IS
'Overall width. Filled on 8 seed rows only (2026-10-07). Unit: inches. Source: the seed migration. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.height_inches IS
'Overall height. Filled on 8 seed rows only (2026-10-07). Unit: inches. Source: the seed migration. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.ground_clearance_inches IS
'Ground clearance by name. UNUSED: empty on all rows (2026-10-07); no writer sets it. Unit: inches by name. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.bed_length_inches IS
'Pickup bed length by name. UNUSED: empty on all rows (2026-10-07); no writer sets it. Unit: inches by name. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.curb_weight_lbs IS
'Curb weight. Filled on 8 seed rows only (2026-10-07). auto_populate_vehicle_specs copies it into vehicles.weight_lbs. Unit: pounds. Source: the seed migration. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.gross_vehicle_weight_lbs IS
'Gross vehicle weight rating by name. UNUSED: empty on all rows (2026-10-07); no writer sets it. Unit: pounds by name. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.payload_capacity_lbs IS
'Payload capacity. Filled on 8 seed rows only (2026-10-07). Unit: pounds. Source: the seed migration. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.towing_capacity_lbs IS
'Towing capacity. Filled on 8 seed rows only (2026-10-07). Unit: pounds. Source: the seed migration. Grain: one catalog row. Clock: n/a.';

-- ── Powertrain ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.engine_size IS
'Engine label as text. EPA rows: built by the import as displacement + L + engine_config, plus Turbo or Supercharged from the EPA tCharger and sCharger flags (e.g. 2L I4 Turbo, 5.7L V8), so it inherits engine_config''s guess (see that column). Seed rows: typed (e.g. 5.7L V8). Filled on 43,089 rows (2026-10-07). Copied into an empty vehicles.engine_size by auto_populate_vehicle_specs and derive-specs-*.py. Unit: none (text). Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.engine_displacement_liters IS
'Engine displacement. EPA rows: the EPA displ field. Filled on 43,082 rows (2026-10-07; NULL on NHTSA rows and on EPA electric vehicles). Unit: liters. Source: EPA vehicles.csv. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.engine_displacement_cid IS
'Engine displacement in cubic inches. Filled on 9 rows, the 8 seed rows (value 350) and one other (2026-10-07); the EPA import writes liters only. Unit: cubic inches. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.engine_config IS
'Cylinder layout code (I4, V6, V8, ...). On EPA rows this is NOT published by EPA: scripts/import-epa-fuel-economy.mjs guesses it from the cylinder count alone (up to 4 cylinders I<n>, 5 I5, 6 V6, 8 V8, 10 V10, 12 V12, 16 W16), so flat, inline-six and other layouts are mislabeled (a flat-six reads V6, an inline-six reads V6). Seed rows: typed. Filled on 43,088 rows (2026-10-07). Treat as derived from cylinder count, not as a layout claim. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.horsepower IS
'Rated engine power. Filled on 9 rows, the 8 seed rows and 1 NHTSA_VPIC row set outside the import (2026-10-07); neither import writes it. Copied into an empty vehicles.horsepower by auto_populate_vehicle_specs. Unit: horsepower (rating basis not recorded). Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.torque_ft_lbs IS
'Rated engine torque. Filled on 9 rows, the 8 seed rows and one other (2026-10-07). Copied into an empty vehicles.torque by auto_populate_vehicle_specs. Unit: pound-feet. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.fuel_type IS
'Fuel, mapped by the EPA import from EPA fuelType to Gasoline, Premium Gasoline, Midgrade Gasoline, Diesel, Electric, Natural Gas, Hybrid, Flex Fuel or Bi-Fuel (unmapped EPA values kept as written, e.g. Premium or E85, CNG, Hydrogen); seed rows use lower-case gasoline. 12 distinct values (pg_stats). Filled on 44,532 rows (2026-10-07). Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.transmission IS
'Transmission, normalized by the EPA import from EPA trany (e.g. 4-Speed Automatic, 5-Speed Manual, Automatic); the raw EPA text is kept in notes. Seed rows: typed (e.g. 3-speed automatic). Filled on 44,520 rows (2026-10-07). Part of the EPA de-duplication key. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.drivetrain IS
'Driven wheels as a short code: RWD, FWD, AWD or 4WD on EPA rows, mapped from EPA drive (2-Wheel Drive maps to RWD; 4-Wheel or All-Wheel Drive and Part-time 4-Wheel Drive map to 4WD); 2WD or 4WD on seed rows. Filled on 43,964 rows (2026-10-07). Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.drive_type IS
'Two meanings by source. EPA rows: the unmapped EPA drive text (e.g. Rear-Wheel Drive, 4-Wheel or All-Wheel Drive), the input to drivetrain. Seed rows: the GM chassis prefix C (2WD), K (4WD) or V, as the creating file documents. Filled on about 76% of rows (pg_stats). Unit: none. Grain: one catalog row. Clock: n/a.';

-- ── Fuel economy ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.mpg_city IS
'City fuel economy. EPA rows: EPA city08, the current-method estimate for the primary fuel, as an integer; for electric vehicles it is miles per gallon equivalent (values above about 70). Seed rows: typed. Filled on 44,531 rows (2026-10-07). Unit: miles per US gallon (MPGe for electric). Source: EPA vehicles.csv. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.mpg_highway IS
'Highway fuel economy. EPA rows: EPA highway08, integer; MPGe for electric vehicles. Seed rows: typed. Filled on 44,531 rows (2026-10-07). Unit: miles per US gallon (MPGe for electric). Source: EPA vehicles.csv. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.mpg_combined IS
'Combined fuel economy. EPA rows: EPA comb08, integer; MPGe for electric vehicles. Filled on 44,523 rows, the EPA rows only (2026-10-07). Unit: miles per US gallon (MPGe for electric). Source: EPA vehicles.csv. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.fuel_tank_gallons IS
'Fuel tank capacity. Filled on 8 seed rows only (2026-10-07); the EPA import does not write it. scripts/derive-specs-from-ymm.py copies it into vehicles.fuel_capacity_gallons. Unit: US gallons. Grain: one catalog row. Clock: n/a.';

-- ── Body and configuration (seed rows only) ─────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.doors IS
'Door count. Filled on 8 seed rows only (2026-10-07). Unit: count of doors. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.seats IS
'Seating capacity. Filled on 8 seed rows only (2026-10-07). Unit: count of seats. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.cab_style IS
'Cab or body family (e.g. Regular Cab, Extended Cab, Full Size SUV). Filled on 8 seed rows only (2026-10-07). Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.available_paint_codes IS
'Factory paint codes the seed author listed as offered for the row (two-digit GM codes, e.g. 10, 40, 70). Filled on 8 seed rows only (2026-10-07); no document is cited for them. Unit: none (text[] of codes). Grain: one catalog row. Clock: n/a.';

-- ── Provenance and trust ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.source IS
'Writer label, no CHECK: EPA_fueleconomy_gov (44,523), NHTSA_VPIC (13,340), Reference Library (31, link_document_to_specs), GM_Heritage (5) and NHTSA (3), the last two typed in the creating migration (2026-10-07). Names the publisher or path, not the document or release; NHTSA (seed) and NHTSA_VPIC (import) are different writers. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.notes IS
'Free text set by the writer. NHTSA rows: NHTSA VPIC catalog. Make ID: <vPIC make id>, Model ID: <vPIC model id>, the only place the source ids are kept. EPA rows: EPA fuel economy database. Engine: <EPA eng_dscr>. Trans: <EPA trans_dscr or trany>. Library rows: Auto-created from <document title>. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.source_library_id IS
'The reference library (factory manual or brochure set) whose document last linked this row, foreign key to reference_libraries.id. Set by link_document_to_specs on each new library_documents row (it overwrites, so it holds the latest library). Filled on 32 rows (2026-10-07). Read by scripts/discovery/configuration-catalog-relations.sql. Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.source_documents IS
'library_documents ids appended by link_document_to_specs, one per document that linked to the row (no foreign key on array members; duplicates not prevented). 32 rows carry 1 .. 39 ids (2026-10-07). It records which documents matched the row''s make, year and series, not which fields a document proves. Unit: none (uuid[]). Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.verification_status IS
'Writer-set label, default unverified, no CHECK. verified on all 57,863 EPA and NHTSA rows: the import scripts stamp it as a constant because the source is a government catalog; no review step sets it. unverified on the seed and library rows (2026-10-07). Unit: none. Grain: one catalog row. Clock: n/a.';
COMMENT ON COLUMN public.oem_vehicle_specs.confidence_score IS
'Writer-set trust constant, default 50, no CHECK, not calibrated. NHTSA_VPIC 95 and EPA_fueleconomy_gov 90 (import constants); seed rows 50. Library rows: link_document_to_specs sets LEAST(95, 50 + 20 x the number of documents already linked); with no documents the sum is NULL and LEAST returns 95, so one document gives 95, two give 70, three give 90 and four or more give 95 (measured: 4 rows with 1 document at 95, 3 rows with 2 at 70, 1 row with 3 at 90, 2026-10-07). It does not rise with evidence as intended. auto_populate_vehicle_specs breaks match ties on it. Unit: score 0 .. 100. Grain: one catalog row. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.oem_vehicle_specs.created_at IS
'When the row was inserted, default now(): 2026-03-23 for all 57,863 EPA and NHTSA rows (two hand runs), 2025-11-02 and 2025-11-10 for the seed rows, 2025-11-21 .. 2026-03-23 for library rows. Not when the source published the figures; the EPA and NHTSA release dates are not kept. Unit: timestamptz. Grain: one catalog row. Clock: ingest time.';
COMMENT ON COLUMN public.oem_vehicle_specs.updated_at IS
'Default now() at insert. No trigger maintains it and link_document_to_specs does not set it, so it moves only when a writer sets it by hand: later than created_at on 9 rows (2026-10-07). Not a reliable last-change time. Unit: timestamptz. Grain: one catalog row. Clock: ingest time (insert, rarely a later write).';

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.oem_vehicle_specs'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF v_missing > 0 THEN
    RAISE NOTICE 'oem_vehicle_specs: % columns still have no comment (a column was added after 2026-10-07)', v_missing;
  END IF;
END $$;

COMMIT;

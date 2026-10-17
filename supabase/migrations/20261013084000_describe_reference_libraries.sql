-- Describe reference_libraries: the 21 columns with no COMMENT ON COLUMN (0 of 21 described before, catalog count on
-- prod, 2026-10-13) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-13 08:36-08:41 UTC):
--   Columns, types, defaults, constraints, policies, grants and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_policy, has_table_privilege and pg_description; fill and value shape from pg_stats and exact
--   whole-table counts (48,907 rows). Live bodies of the SQL functions that name the table (pg_proc.prosrc):
--   get_or_create_library_for_vehicle, link_document_to_specs, trigger_update_library_stats, update_coverage_on_upload,
--   get_vehicle_library_docs, get_vehicle_references; the triggers on library_documents that call the middle three; the
--   view reference_library_stats. Code at origin/main bf8830617: supabase/migrations/20251122_reference_library_system.sql
--   (this shape), nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx and nuke_frontend/src/pages/Library.tsx,
--   scripts/upload-service-manuals.js, upload-catalog-urls.js, upload-multiple-catalogs.js, upload-3m-catalog.js, and
--   the merged description of vehicle_reference_links (20261008024000), which records the auto-link trigger history.
-- LIMITS:
--   No run log records which writer created a given row. Most rows were created by get_or_create_library_for_vehicle
--   from the auto-link trigger on vehicles (one library per new year, make, series and body style); that trigger is now
--   a stub (see vehicle_reference_links). Who set is_verified on 7 rows is Unknown: no code in the repo sets it on this
--   table. Quoted values are column, function and categorical names and counts; no ids, names or amounts.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it named parse-reference-document as a writer; that function only reads the table (an inner
--   join from library_documents). The new comment keeps the rest and adds the clocks, the auto-create origin and the
--   uniqueness gap. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.reference_libraries IS
'Reference library per year, make, model, series and body: one row per library that holds contributed manuals, brochures and specs (grain: one library; 48,907 rows, 2026-10-13). Most rows were auto-created, one per new year, make, series and body style seen on a vehicle insert, by get_or_create_library_for_vehicle through the vehicles auto-link trigger (now a stub, so no library has been created since 2026-04-25 05:37 UTC); others were created by the upload scripts in scripts/ and the vehicle page upload form (VehicleReferenceLibrary.tsx), the only paths that write description (14 rows). Only 218 rows hold a document (library_documents). Maintained by triggers on library_documents: trigger_update_library_stats (document_count, updated_at) and link_document_to_specs (oem_spec_id). Readers: Library.tsx, VehicleReferenceLibrary.tsx, parse-reference-document (a join from library_documents), the view reference_library_stats, get_vehicle_library_docs, get_vehicle_references and update_coverage_on_upload. UNIQUE (year, make, series, body_style) does not deduplicate rows with a NULL series (48,437 of them): 15 rows repeat another row''s year, make, model, series and body style. Rows 2025-11-21 .. 2026-04-25. Clocks: created_at is insert time; there is no event time.';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.id IS
'Surrogate key of the library. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by foreign keys from library_documents.library_id, vehicle_reference_links.library_id, oem_vehicle_specs.source_library_id and manhunt_searches.library_id (2026-10-13). Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.year IS
'Model year the library covers, NOT NULL, copied from vehicles.year by get_or_create_library_for_vehicle or typed by an uploader. Not checked: 57 rows hold a year before 1886 or after 2027, with values from 0 to 9999 (2026-10-13); the auto-create path copies vehicles.year without a check, and which vehicle each came from is not recorded. Unit: model year. Grain: one library. Clock: event time (model year, as recorded on the vehicle).';
COMMENT ON COLUMN public.reference_libraries.make IS
'Manufacturer as the vehicle or uploader spelled it, NOT NULL, not keyed to a make table; casing varies (scripts/upload-service-manuals.js writes lower case; vehicle-derived rows keep the vehicle''s spelling). get_or_create_library_for_vehicle matches it with ILIKE. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.model IS
'Model copied from vehicles.model when the library was auto-created, or typed by an uploader. Not part of the UNIQUE key or the lookup, so the first vehicle''s model wins for a year, make, series and body style. NULL on 455 rows; placeholder values such as N/a, Unknown, boat and trailer are among the most common (pg_stats, 2026-10-13). Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.series IS
'Manufacturer series code (for example C/K, C10), copied from vehicles.series or typed by an uploader. Filled on 470 of 48,907 rows (2026-10-13). Part of UNIQUE (year, make, series, body_style); because NULL never equals NULL in that constraint, the 48,437 rows without a series are not protected from duplicates. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.body_style IS
'Body style copied from vehicles.body_style or typed by an uploader (for example Coupe, Pickup, Convertible); free text, 960 distinct values (pg_stats, 2026-10-13). Filled on 16,535 of 48,907 rows. Part of the UNIQUE key and of the lookup. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries."trim" IS
'Never written: NULL on every row (exact count, 2026-10-13); no writer in the repo sets it. Read by the view reference_library_stats. Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.description IS
'Free-text label written by the upload scripts and the vehicle page upload form (for example "Reference library for <year> <make> <series>"); get_or_create_library_for_vehicle does not set it. Filled on 14 rows (2026-10-13). Unit: none. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.notes IS
'Never written: NULL on every row (exact count, 2026-10-13); no writer in the repo sets it. Unit: none. Grain: one library. Clock: n/a.';

-- ── Counters ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.vehicle_count IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13), although 47,836 libraries have a vehicle_reference_links row. The live vehicle count per library is computed by the view reference_library_stats. Unit: count. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.document_count IS
'Number of library_documents rows for the library, kept by the trigger trigger_update_library_stats on library_documents (+1 on insert, -1 on delete, floor 0). Agrees with a live count of library_documents on all but 1 row (2026-10-13). Above 0 on 218 rows. Unit: count. Grain: one library. Clock: as of the last document insert or delete.';
COMMENT ON COLUMN public.reference_libraries.contributor_count IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13). The view reference_library_stats computes it as distinct library_documents.uploaded_by. Unit: count. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.total_downloads IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13). The view reference_library_stats sums library_documents.download_count instead. Unit: count. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.total_views IS
'Stored counter that nothing maintains: 0 on every row (2026-10-13). The view reference_library_stats sums library_documents.view_count instead. Unit: count. Grain: one library. Clock: n/a.';

-- ── People and verification ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.created_by IS
'User who created the library, foreign key to auth.users(id). NULL on every row (2026-10-13): neither the auto-create function nor the upload paths pass it. The live update policy (libraries_authenticated_update) does not use it: its condition is true (2026-10-13). Unit: none (uuid). Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.is_verified IS
'Whether a person marked the library verified; default false. True on 7 rows (2026-10-13); which path set them is Unknown (no code in the repo sets it on this table; scripts/upload-service-manuals.js sets is_verified on library_documents, not here). Unit: boolean. Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.verified_by IS
'User who verified the library, foreign key to auth.users(id). NULL on every row (2026-10-13), including the 7 rows marked verified. Unit: none (uuid). Grain: one library. Clock: n/a.';
COMMENT ON COLUMN public.reference_libraries.verified_at IS
'When the library was verified. NULL on every row (2026-10-13), including the 7 rows marked verified. Unit: timestamptz. Grain: one library. Clock: would be the verification time; never recorded.';

-- ── Link to the OEM catalog ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.oem_spec_id IS
'The oem_vehicle_specs row the library''s documents describe, foreign key to oem_vehicle_specs(id). Set by the trigger function link_document_to_specs when a library_documents row is inserted: it takes the first spec whose make (ILIKE), year range and series fit the library, or inserts one. Filled on exactly the 218 libraries that hold a document (2026-10-13). Read by scripts/discovery/configuration-catalog-relations.sql. Unit: none (uuid). Grain: one library. Clock: as of the last document insert.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.reference_libraries.created_at IS
'Insert time of the library: now() default, never passed by a writer. For auto-created rows this is the insert time of the first vehicle with that year, make, series and body style. 2025-11-21 20:21 UTC .. 2026-04-25 05:37 UTC (2026-10-13). Unit: timestamptz. Grain: one library. Clock: ingest time.';
COMMENT ON COLUMN public.reference_libraries.updated_at IS
'Time of the last change by trigger_update_library_stats (a document insert or delete); default now() at insert. Differs from created_at on exactly the 218 rows with documents; latest 2026-05-06 05:38 UTC (2026-10-13). There is no updated_at trigger, so other edits do not move it. Unit: timestamptz. Grain: one library. Clock: ingest time (last document change).';

COMMIT;

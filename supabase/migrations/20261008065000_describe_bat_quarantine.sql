-- Describe bat_quarantine: all 14 columns (0 of 14 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 464,699 rows on 2026-10-07 17:59Z by exact count (the
-- atlas estimate of 442,895 is a stale pg_class.reltuples); 5,843 rows arrived in the 24 hours to 17:58Z.
--
-- METHOD (read 2026-10-07 17:57-18:05Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies, RLS, grants
--   (has_table_privilege and relacl for anon and authenticated) and the existing comment from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; views from pg_depend (none); the
--   creating statements from supabase_migrations.schema_migrations (20260315162919 create_bat_test_results_and_quarantine,
--   applied on prod with no file in the repo). Exact over the whole table (162 MB heap, read only): the counts by kind
--   (field conflict or whole-record rejection), extraction_version, field_name, listing host, quality_score, issue code,
--   issues per row and created month; the fills; the distinct vehicles; the distinct (vehicle, field, existing,
--   proposed) conflicts; the resolution columns. What anon can read comes from a count under SET LOCAL ROLE anon in a
--   read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main f37d112e1 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps, docs; git history): _shared/batUpsertWithProvenance.ts (the Tetris write layer,
--   quarantine and quarantineRecord; first committed in e8ec6de3d, 2026-03-15) and its callers _shared/observationWriter.ts,
--   extract-bat-core (the quality gate before a new vehicle), bat-snapshot-parser, bat-price-propagation,
--   ingest/craigslistCapture.ts (and its test) and extract-vehicle-data-ai/vehicleWrite.ts; _shared/extractionQualityGate.ts;
--   20261007002507_declare_table_owners_1.sql; docs/ledger/2026-09-30_bat-data-coverage-audit.md (section 4.3 and P8).
--   Bodies read with pg_get_functiondef: match_bat_listings_for_propagation, the one live function whose body names the
--   table (prod history 20260315180519 fix_bat_propagation_rpc_skip_quarantined), with its EXECUTE grants; cron.job (no job
--   names the table); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 row; none is added or changed
--   here).
-- LIMITS:
--   The share of formatting differences (about 80% of the rows) is the 2026-09-30 audit, not measured again here; whether
--   each vehicle still holds existing_value is not measured. pg_stat_user_tables counters began at the last server start
--   (2026-09-29 09:20Z), and the reads of this session added sequential scans to them after 17:57Z. The rows hold values
--   from public listings, platform handles of sellers and buyers among them, and the issues array repeats them: quoted
--   values are field names, version labels, issue codes, host names and counts only.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Conflicts detected by Tetris write layer: when a new extraction disagrees with existing data, the
--   disagreement is quarantined here for review instead of overwriting." The sentence stays. Corrected: no review exists
--   (no reader looks at a row to settle it, and no writer resolves one); the table also holds whole-record rejections of
--   the quality gate and rows from pages other than BaT. Added: the two kinds of row, the writers, the repeats, liveness,
--   the reader that skips quarantined pairs for good, and access.
--   There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.bat_quarantine IS
'Conflicts detected by Tetris write layer: when a new extraction disagrees with existing data, the disagreement is quarantined here for review instead of overwriting. Two kinds of row (grain: one rejected value, or one rejected record). A field conflict (field_name set): _shared/batUpsertWithProvenance.ts found that a proposed value for a vehicles field differs from the non-empty stored value after trimming and lower-casing (numbers compared as numbers), kept the stored value, wrote this row and a conflicting receipt in extraction_metadata. A whole-record rejection (field_name NULL): quarantineRecord, when a quality gate rejects an extraction. 464,699 rows on 2026-10-07 17:59Z (exact) for 130,323 vehicles: 451,910 field conflicts and 12,789 record rejections. Writers by extraction_version (2026-10-07 17:57Z): observation-writer:1.0.0 337,895 (the layer called from _shared/observationWriter.ts, since 2026-03-31), extract-bat-core 84,772 (3.0.0 from 2026-03-15 to 2026-07-28, 4.0.0 to 4.4.0 since 2026-09-27), batParser:1.0.0 41,686 (bat-snapshot-parser, 2026-03-15 to 2026-07-02), bat-price-propagation:1.0.0 330 (2026-03-15 to 04-12). Field conflicts by field: transmission 220,246 rows on 116,096 vehicles, model 38,372, interior_color 25,524, sale_status 22,825, high_bid 21,685, color 20,871, mileage 15,801, sale_price 14,949, bat_views 14,064, make 14,022, engine_size 13,001 and 24 smaller fields. The layer does not look for an earlier row, so every re-read files the same pair again: the field rows hold 283,164 distinct (vehicle, field, stored, proposed) conflicts, and 168,730 rows (37.3%) repeat one. docs/ledger/2026-09-30_bat-data-coverage-audit.md (section 4.3) judged about 80% of the rows formatting differences, such as two spellings of one transmission, engine or color (2026-09-30). Record rejections: 12,707 by the quality gate (_shared/extractionQualityGate.ts) for missing identity, 12,654 of them from extract-bat-core before it inserts a new vehicle (so without vehicle_id) and 53 from bat-snapshot-parser; and 82 price mismatches from bat-price-propagation. Nothing resolves a row: resolved is false on every row, resolution, resolved_at and resolved_by are empty, no code or SQL function sets them, and pg_stat_user_tables counts 0 updates and 0 deletes since the server last started. Liveness: 59,374 inserts since the server start (2026-09-29 09:20Z; read 17:59Z); 5,843 rows in the 24 hours to 17:58Z; none in 2026-05, 2026-06 or 2026-08. Readers: match_bat_listings_for_propagation (SECURITY INVOKER, called by bat-price-propagation) skips a vehicle and listing that has an unresolved row, which, since nothing resolves, keeps every quarantined pair out for good; the 2026-09-30 audit read it by hand; no web page, view or cron job reads it. 15 sequential and 4 index scans since the server start before this session read it (17:57Z). pipeline_registry holds one table-level row (owner batUpsertWithProvenance, do_not_write_directly true). Foreign key: vehicle_id references vehicles(id) with no ON DELETE action (validated), so a vehicle with a quarantine row cannot be deleted outright. The creating migration (prod history 20260315162919, no file in the repo) also made a partial index on open rows, idx_bat_quarantine_open, which is no longer on prod. Access: RLS is on with no policy; anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, read 0 rows (counted under SET LOCAL ROLE anon, 2026-10-07) and cannot write rows through the API. Clocks: created_at is the insert time; there is no clock of the extraction or of when the stored value was written.';

-- ── The conflict ───────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.bat_quarantine.id IS
'Surrogate key of the quarantine row, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 464,699 values (2026-10-07 17:59Z). No foreign key points at it. Unit: none (uuid). Source: column default. Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.vehicle_id IS
'Vehicle the rejected value was for: a vehicles.id, uuid, nullable, foreign key with no ON DELETE action (validated), indexed (idx_bat_quarantine_vehicle). Filled on every field conflict and on the 135 record rejections of bat-snapshot-parser and bat-price-propagation; NULL on the 12,654 record rejections of extract-bat-core, which rejects a new vehicle before inserting it (2026-10-07). 130,323 distinct vehicles. match_bat_listings_for_propagation matches it with listing_url. Unit: none (uuid). Source: the writer. Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.listing_url IS
'Page the rejected extraction came from, text NOT NULL. bringatrailer.com on all but 780 rows (2026-10-07 17:58Z): carsandbids.com 580, facebook.com 187, pcarmarket.com 7, allcollectorcars.com 4 and goodingco.com 2, all from observation-writer, so the rows are not only BaT despite the table name. match_bat_listings_for_propagation matches it with vehicle_id. Public listing URLs; none is quoted here. Unit: none (URL). Source: the writer (the URL it read). Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.field_name IS
'vehicles field of a field conflict, text, nullable; NULL marks a whole-record rejection (12,789 rows, 2026-10-07). 35 fields on the 451,910 field rows: transmission 220,246 (116,096 vehicles), model 38,372, interior_color 25,524, sale_status 22,825, high_bid 21,685, color 20,871, mileage 15,801, sale_price 14,949, bat_views 14,064, make 14,022, engine_size 13,001, and 24 fields with fewer than 7,000 rows each (counted 17:58Z). Unit: none (field name). Source: the writer (the field it proposed). Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.existing_value IS
'Value stored on the vehicle when the conflict was found, as text, nullable: filled on every field conflict, NULL on record rejections (2026-10-07). It is the value the layer kept; whether the vehicle still holds it is not tracked (the 2026-09-30 audit found many since corrected, most sale_status rows among them). The values include platform handles (bat_seller, bat_buyer), places, prices and VINs; none is quoted here. Unit: none (text, in the units of the vehicles column). Source: the vehicles row the writer read. Grain: one rejected value or record. Clock: as of created_at.';
COMMENT ON COLUMN public.bat_quarantine.proposed_value IS
'Value the extraction proposed and the layer did not write, text, nullable: filled on every field conflict, NULL on record rejections (2026-10-07). It differs from existing_value after trimming and lower-casing, or as a number for the numeric fields (year, mileage, sale_price, high_bid and the BaT counters). The same proposal is filed again on every re-read: the field rows hold 283,164 distinct (vehicle, field, existing, proposed) conflicts and 168,730 repeats (37.3%, counted 17:58Z). Unit: none (text, as extracted). Source: the extractor. Grain: one rejected value or record. Clock: as of created_at.';

-- ── Who rejected it and why ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.bat_quarantine.extraction_version IS
'Writer and version label of the rejected extraction, text, nullable, filled on every row. By label (2026-10-07 17:57Z): observation-writer:1.0.0 337,895 (since 2026-03-31); extract-bat-core 84,772 (extract-bat-core:3.0.0 60,762 from 2026-03-15 to 2026-07-28, 4.0.0 to 4.4.0 24,010 since 2026-09-27); batParser:1.0.0 41,686 (bat-snapshot-parser, 2026-03-15 to 2026-07-02); bat-price-propagation:1.0.0 330 (2026-03-15 to 04-12). The same labels appear in extraction_metadata.scraper_version. Unit: none (text label). Source: the writer constant. Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.quality_score IS
'Score attached to the rejected extraction, numeric(5,4), nullable, filled on every row (2026-10-07). On a field conflict it is the confidence the writer gave the proposed value (0.40 to 0.95; 0.85 on 343,679 rows, 0.80 on 62,549). On a record rejection it is the score of the quality gate (_shared/extractionQualityGate.ts), 0.10 to 0.542 on the identity rejections, or the constant 0.5 that bat-price-propagation passes. Unit: score (0 to 1). Source: the writer or the quality gate. Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.issues IS
'Why the row was quarantined, text[] NOT NULL, default empty; never empty (2026-10-07). A field conflict carries one element: conflict, then the stored and the proposed value in quotes (451,894 rows, 17:58Z). A record rejection carries the quality gate codes no_identity_fields, missing_make, missing_model and missing_year (12,707 rows), on 213 of them with a fifth code (vin_checksum_fail 192, cross_field_conflict 13, polluted_color 6, suspicious_low_high_bid 2), or one price_mismatch element from bat-price-propagation (82 rows). The elements embed the rejected values; none is quoted here. Unit: none (text array of issue codes with values). Source: the writer or the quality gate. Grain: one rejected value or record. Clock: n/a.';

-- ── Resolution (never written) ─────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.bat_quarantine.resolved IS
'Whether the conflict was settled, boolean, nullable, default false. false on all 464,699 rows (2026-10-07): no code or SQL function sets it, and pg_stat_user_tables counts 0 updates since the server start. match_bat_listings_for_propagation skips a vehicle and listing with a row where it is false, so every quarantined pair stays skipped. The creating migration also indexed the open rows (idx_bat_quarantine_open); that index is no longer on prod. Unit: none (boolean). Source: column default (never written). Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.resolution IS
'Intended outcome of a resolution, text, nullable; the creating migration names accepted_new, kept_existing and manual_override. NULL on every row (2026-10-07): no writer exists. Unit: none (text code). Source: none (never written). Grain: one rejected value or record. Clock: n/a.';
COMMENT ON COLUMN public.bat_quarantine.resolved_at IS
'Intended time of the resolution, timestamptz, nullable. NULL on every row (2026-10-07): no writer exists. Unit: timestamptz. Source: none (never written). Grain: one rejected value or record. Clock: n/a (never set).';
COMMENT ON COLUMN public.bat_quarantine.resolved_by IS
'Intended user or agent that resolved the row (creating migration), text, nullable. NULL on every row (2026-10-07): no writer exists. Unit: none (text). Source: none (never written). Grain: one rejected value or record. Clock: n/a.';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.bat_quarantine.created_at IS
'When the row was inserted, timestamptz, nullable, default now() (database clock; writers do not send it), filled on every row. 2026-03-15 17:09Z to now; by month (2026-10-07 17:58Z): 2026-03 54,196, 04 100,887, 07 186,653, 09 91,304, 10 31,650; none in 2026-05, 06 and 08; 5,843 rows in the 24 hours to 17:58Z. Not indexed. Unit: timestamptz. Source: column default. Grain: one rejected value or record. Clock: ingest time (when the conflict was filed).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.bat_quarantine'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'bat_quarantine: every column has a comment';
  ELSE
    RAISE NOTICE 'bat_quarantine columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

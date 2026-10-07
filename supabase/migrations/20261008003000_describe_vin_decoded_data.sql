-- Describe vin_decoded_data: all 23 columns, none had a COMMENT ON COLUMN (0 of 23 described before, catalog count on prod,
-- 2026-10-07), and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 115,872 rows on 2026-10-07 13:23Z by exact count (the
-- atlas estimate of 112,311 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row
-- is from 2026-03-14 05:40Z.
--
-- METHOD (read 2026-10-07 13:22-14:00Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies (with their role lists), grants
--   (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint,
--   pg_indexes, pg_trigger, pg_policy and pg_description; the views that read the table from pg_depend. Fill, minimum and
--   maximum, provider and confidence counts, VIN length and character classes, WMI (first three characters) and first
--   character counts, the creation days and the top values of the categorical columns are exact counts over the whole
--   table (30 MB heap, read only). The raw_response shape and the NHTSA ErrorCode distribution come from a 5% block sample
--   (TABLESAMPLE SYSTEM (5) REPEATABLE (20261007), 5,226 rows), because raw_response is 296 MB of TOAST; the match of the
--   decoded VINs to live vehicles comes from the same sample, and the share of live vehicles with a decode from a 1% block
--   sample of vehicles (9,814 rows). What anon can read comes from a count under SET LOCAL ROLE anon in a read-only
--   transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main e57fb15f2 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history): the creating migration 20251202_vin_as_source_of_truth.sql
--   (table, indexes, the two policies, the table comment); the writers scripts/decode-all-vins.js (2025-12-02, single-VIN
--   endpoint DecodeVinValues) and scripts/mass-vin-decode.ts (batch endpoint DecodeVINValuesBatch); the readers
--   scripts/backfill-from-vin.ts, scripts/backfill-vin-decode.mjs, scripts/build-canonical-models.ts and
--   scripts/enrich-vehicles.mjs; the bodies, read with pg_get_functiondef, of the 9 live functions whose body names the
--   table (none writes it): set_vehicle_canonical_taxonomy() (trigger trg_set_vehicle_canonical_taxonomy on vehicles),
--   ensure_field_evidence(uuid) (last replaced by 20260927180000), backfill_evidence_for_vehicle, compare_vehicle_to_vin,
--   detect_data_anomalies, detect_modification, enrich_all_vehicles_from_nhtsa, enrich_vehicle_from_nhtsa and
--   populate_vehicle_from_vin; their callers in pg_proc, pg_trigger, cron.job and code; cron.job (batch-vin-decode-backfill,
--   jobid 315, inactive, calls the edge function batch-vin-decode, which does not write this table); pg_depend (5 views);
--   write_receipts (no rows); pg_stat_user_tables; pipeline_registry (no row; none is added here).
-- LIMITS:
--   The raw_response facts and the vehicle matches come from block samples and can miss rare cases. The run of
--   2026-03-14 predates the commit of scripts/mass-vin-decode.ts (2026-03-19); its rows match that script (17-character
--   VINs, the same confidence rule), but which copy ran is not recorded. The table holds VINs, readable by anyone: quoted
--   values are WMI codes (manufacturer prefixes), NHTSA codes and texts, categorical values, column and function names
--   and counts only; no VIN.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said "Canonical vehicle data decoded from VINs - source of truth". That stays as the opening; the
--   new comment says it is NHTSA testimony with its own error codes, that nothing has added rows since 2026-03-14, who
--   reads it, and that every role can write it. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vin_decoded_data IS
'Canonical vehicle data decoded from VINs - source of truth: in fact one NHTSA vPIC decode per VIN (grain: one VIN; PRIMARY KEY vin), the factory specification as NHTSA returned it, with NHTSA own error codes in raw_response; a decode is testimony of the VIN, not proof that the vehicle matches it. 115,872 rows on 2026-10-07 (the atlas estimate of 112,311 is a stale reltuples), all provider nhtsa, written in two runs and never updated: 131 rows on 2025-12-02 and 03 by scripts/decode-all-vins.js (one VIN per request, VINs taken from the view vehicles_needing_vin_decode; 52 of them are not 17 characters long) and 115,741 rows on 2026-03-14 03:40Z .. 05:40Z by the batch decoder that scripts/mass-vin-decode.ts holds (50 VINs per request, 17-character VINs only). Nothing has written since: no edge function, cron job or SQL function inserts or updates it (batch-vin-decode, behind the inactive cron job batch-vin-decode-backfill, jobid 315, writes vehicles, not this table), so in a 1% block sample of vehicles 1,092 of 2,015 live vehicles with a 17-character VIN (54.2%) have a decode, and 7 of the 903 created after 2026-03-14. Coverage of the decodes: 716 WMIs (first three characters); the largest WP0 13,974, WDB 9,206, WBA 7,155, 1G1 5,758, WBS 5,092, 1FA 3,568, SAL 3,373, ZFF 2,994; by first character W 43,950, 1 29,187, J 14,832, S 8,830, Z 5,665. In a 5% block sample 5,093 of 5,226 decoded VINs (97.5%) belong to a live vehicle (upper(vin) match) and 4,705 (90.0%) decoded clean (NHTSA ErrorCode 0); the others carry check-digit, corrected-VIN, model-year or no-data codes, and both writers stored them. Readers: the trigger trg_set_vehicle_canonical_taxonomy on vehicles (BEFORE INSERT OR UPDATE OF vin, body_style) runs set_vehicle_canonical_taxonomy(), which looks up body_type and vehicle_type by UPPER(vin) to set vehicles.canonical_body_style and canonical_vehicle_type: the only live reader and the source of the 10,123 index scans since the statistics counters began (the server last started 2026-09-29 09:20Z; read 13:22Z; 0 inserts, updates, deletes and sequential scans). Idle readers: ensure_field_evidence (SECURITY DEFINER; copies nine fields into field_evidence with source_confidence 100 whatever the NHTSA error code), backfill_evidence_for_vehicle, populate_vehicle_from_vin, enrich_vehicle_from_nhtsa and enrich_all_vehicles_from_nhtsa, compare_vehicle_to_vin, detect_data_anomalies (reached from the edge function process-cl-queue, which no cron job calls) and detect_modification; the views data_truth_audit_report, nhtsa_integration_status, vehicle_nhtsa_comparison, vehicles_needing_vin_decode and vin_conflicts_dashboard; and four scripts that copy decoded fields into vehicles. Access: RLS is on, but both policies of the creating migration apply to every role (polroles PUBLIC): Anyone can view decoded VINs (SELECT, USING true) and Service role manages decoded VINs (ALL, USING true, WITH CHECK true; despite its name it names no role), and anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE (has_table_privilege, 2026-10-07). So anyone with the public API key can read all 115,872 rows (counted under SET LOCAL ROLE anon) and can insert, overwrite or delete any row through the REST API, which would change the canonical body style the vehicles trigger derives. No pipeline_registry row and no write receipts. Clocks: decoded_at, created_at and updated_at are the database clock of the insert and equal on every row; nothing records when NHTSA last changed its answer.';

-- ── Key ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.vin IS
'The VIN that was decoded, upper case, text NOT NULL, the PRIMARY KEY. 115,872 values (2026-10-07): 17 characters on 115,820 and 11 to 16 characters on 52 (all from the 2025-12 run; the March run skipped every VIN that is not 17 characters long); 98 contain I, O or Q, which modern VINs exclude, and 14 hold a character other than A-Z and 0-9; none is lower case. Joined to vehicles as vin = UPPER(vehicles.vin) by set_vehicle_canonical_taxonomy and the scripts; 97.5% of a 5% block sample match a live vehicle. Readable by anyone (see the table comment); no VIN is quoted here. Unit: none (text). Source: the VIN sent to NHTSA, upper-cased by the writer. Grain: one VIN. Clock: n/a.';

-- ── Identity of the vehicle (NHTSA) ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.make IS
'Make as NHTSA decodes it (upper case, NHTSA field Make), text, nullable. Filled on 114,702 rows (99.0%, 2026-10-07), 395 distinct values. Unit: none (text). Source: NHTSA vPIC Make. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.model IS
'Model as NHTSA decodes it (NHTSA field Model), text, nullable. Filled on 108,917 rows (94.0%, 2026-10-07), 1,935 distinct values; with make indexed by idx_vin_decoded_make_model. Read by scripts/build-canonical-models.ts as the canonical model name. Unit: none (text). Source: NHTSA vPIC Model. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.year IS
'Model year as NHTSA decodes it (NHTSA field ModelYear), integer, nullable, indexed (idx_vin_decoded_year). Filled on 114,565 rows (98.9%, 2026-10-07), 1980 .. 2028. The year letter in position 10 repeats every 30 years, and 51 rows decode to 2028, later than any model year on sale when they were decoded (2026-03-14), so those are suspect; NHTSA ErrorCode 11 (incorrect model year) marks others in raw_response. Unit: model year. Source: NHTSA vPIC ModelYear. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.trim IS
'Trim as NHTSA decodes it (NHTSA field Trim), text, nullable. Filled on 58,232 rows (50.3%, 2026-10-07); NHTSA leaves it empty for many manufacturers. Unit: none (text). Source: NHTSA vPIC Trim. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.manufacturer IS
'Manufacturer of record as NHTSA names it (NHTSA field Manufacturer, the legal entity of the WMI), text, nullable. Filled on 115,822 rows (2026-10-07), 438 distinct values. Unit: none (text). Source: NHTSA vPIC Manufacturer. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.vehicle_type IS
'NHTSA vehicle type (NHTSA field VehicleType), text, nullable. Filled on 115,822 rows (2026-10-07), 9 values: PASSENGER CAR 83,779, MULTIPURPOSE PASSENGER VEHICLE (MPV) 17,966, TRUCK 9,289, MOTORCYCLE 3,560, INCOMPLETE VEHICLE 834, TRAILER 262, BUS 76 and two rarer ones. Read by set_vehicle_canonical_taxonomy, which maps it through normalize_vehicle_type into vehicles.canonical_vehicle_type and uses it for the body style when body_type is empty. Unit: none (text code). Source: NHTSA vPIC VehicleType. Grain: one VIN. Clock: decoded_at.';

-- ── Body ───────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.body_type IS
'Body class as NHTSA decodes it (NHTSA field BodyClass), text, nullable. Filled on 108,694 rows (93.8%, 2026-10-07), 57 distinct values. Read by set_vehicle_canonical_taxonomy for vehicles.canonical_body_style when the vehicle has no body_style of its own, and by ensure_field_evidence as body_style. Unit: none (text). Source: NHTSA vPIC BodyClass. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.doors IS
'Number of doors as NHTSA decodes it (NHTSA field Doors), integer, nullable. Filled on 97,483 rows (84.1%, 2026-10-07). Unit: doors. Source: NHTSA vPIC Doors. Grain: one VIN. Clock: decoded_at.';

-- ── Powertrain ─────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.engine_size IS
'Mislabelled: not a size. Both writers store the NHTSA field EngineModel here, the engine model or family code (the most common values are codes such as LS1, 2UZ-FE, LS3, plus loose words such as 4BBL or a make name), text, nullable. Filled on 34,469 rows (29.7%, 2026-10-07). The displacement is engine_displacement_liters. ensure_field_evidence copies this value as engine_size into field_evidence, carrying the mislabel on. Unit: none (engine model code). Source: NHTSA vPIC EngineModel. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.engine_cylinders IS
'Number of cylinders as NHTSA decodes it (NHTSA field EngineCylinders), integer, nullable. Filled on 97,221 rows (83.9%, 2026-10-07). Counts toward confidence. Unit: cylinders. Source: NHTSA vPIC EngineCylinders. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.engine_displacement_liters IS
'Engine displacement as NHTSA decodes it (NHTSA field DisplacementL), stored as text. Filled on 100,319 rows (86.6%, 2026-10-07), every value numeric; the same displacement appears in more than one spelling (3 and 3.0, 5 and 5.0), so compare it as a number. Most common 5.7, 3.6 and 5.0. Unit: liters. Source: NHTSA vPIC DisplacementL. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.fuel_type IS
'Primary fuel as NHTSA decodes it (NHTSA field FuelTypePrimary), text, nullable. Filled on 94,804 rows (81.8%, 2026-10-07): Gasoline 89,152, Diesel 3,127, Electric 1,794, Flexible Fuel Vehicle (FFV) 444, Not Applicable 262 (the trailers), Ethanol (E85) 19, and rarer values. Unit: none (text). Source: NHTSA vPIC FuelTypePrimary. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.transmission IS
'Transmission style as NHTSA decodes it (NHTSA field TransmissionStyle), text, nullable. Filled on 20,705 rows (17.9%, 2026-10-07): Automatic 12,951, Manual/Standard 6,667, Automated Manual Transmission (AMT) 328, Dual-Clutch Transmission (DCT) 296, Not Applicable 262, Continuously Variable Transmission (CVT) 91, and rarer values; NHTSA rarely knows it from the VIN. Counts toward confidence. Unit: none (text). Source: NHTSA vPIC TransmissionStyle. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.drivetrain IS
'Drive type, from the NHTSA field DriveType mapped by the writer (mapDrivetrain): text containing 4x4, 4wd or four wheel becomes 4WD, awd or all wheel AWD, rwd or rear wheel RWD, fwd or front wheel FWD, 2wd or two wheel 2WD, anything else is kept as NHTSA wrote it. Filled on 34,057 rows (29.4%, 2026-10-07), 10 values: 4WD 15,412, 4x2 7,272 (NHTSA spelling, not mapped to 2WD), AWD 6,577, RWD 3,887, FWD 621, Not Applicable 262, 6x4 20, and rarer ones. Counts toward confidence. Unit: none (text code). Source: NHTSA vPIC DriveType through mapDrivetrain. Grain: one VIN. Clock: decoded_at.';

-- ── Manufacture ────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.plant_city IS
'City of the assembly plant as NHTSA decodes it from the plant character (NHTSA field PlantCity), text, nullable. Filled on 111,247 rows (96.0%, 2026-10-07). A factory location, not a location of the vehicle. Unit: none (text). Source: NHTSA vPIC PlantCity. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.plant_country IS
'Country of the assembly plant as NHTSA decodes it (NHTSA field PlantCountry), text, nullable. Filled on 112,618 rows (97.2%, 2026-10-07), 40 distinct values. Unit: none (text). Source: NHTSA vPIC PlantCountry. Grain: one VIN. Clock: decoded_at.';

-- ── Provenance and quality ─────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.provider IS
'Decoder that produced the row, text NOT NULL, default nhtsa. nhtsa on all 115,872 rows (2026-10-07), the NHTSA vPIC API. Unit: none (text code). Source: the writer constant. Grain: one VIN. Clock: n/a.';
COMMENT ON COLUMN public.vin_decoded_data.confidence IS
'Field-presence score computed by the writer, not a measure of decode accuracy: 20 for each of Make, Model and ModelYear present in the NHTSA answer plus 10 for each of BodyClass, DriveType, EngineCylinders and TransmissionStyle, capped at 100 (calculateConfidence in both scripts). numeric, nullable, default 100 (never used: the writers always send a value). Values (2026-10-07): 80 on 58,049 rows, 90 on 35,766, 70 on 7,407, 100 on 7,036, 40 on 4,391, 20 on 1,842, 60 on 955, 50 on 222, 30 on 154, 0 on 50. It ignores the NHTSA error code: in a 5% block sample 88 of 521 decodes that NHTSA did not mark clean score 80 or more. ensure_field_evidence ignores it and writes source_confidence 100. Unit: score points, 0 .. 100. Source: calculateConfidence in scripts/decode-all-vins.js and scripts/mass-vin-decode.ts. Grain: one VIN. Clock: decoded_at.';
COMMENT ON COLUMN public.vin_decoded_data.raw_response IS
'The NHTSA answer for the VIN as received, one flat object of the DecodeVinValues or DecodeVINValuesBatch endpoint, jsonb, filled on every row (2026-10-07). About 154 keys and 2.2 KB per row (5% block sample), 296 MB of TOAST in all; it repeats the VIN. ErrorCode and ErrorText give NHTSA own verdict: 0 (VIN decoded clean, check digit correct) on 4,705 of 5,226 sampled rows (90.0%); the rest combine codes such as 1 (check digit does not calculate), 2 (VIN corrected, error in one position), 5 (errors in a few positions), 8 (no detailed data available), 11 (incorrect model year) and 14 (some characters not decodable). scripts/decode-all-vins.js refused any ErrorCode string containing 1, 3, 4, 5 or 11 (a substring test); scripts/mass-vin-decode.ts refused only the exact single codes 3, 4, 5 and 11, so check-digit failures and combined codes such as 1,5,14 were stored. Unit: none (jsonb). Source: NHTSA vPIC API. Grain: one VIN. Clock: decoded_at.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vin_decoded_data.decoded_at IS
'When the decode was stored: default now(), the database clock of the insert (the writers do not send it), equal to created_at and updated_at on every row (2026-10-07). 2025-12-02 23:55Z .. 2025-12-03 (131 rows) and 2026-03-14 03:40Z .. 05:40Z (115,741 rows). Read by ensure_field_evidence as extracted_at of the field_evidence rows it writes. Unit: timestamptz. Source: column default. Grain: one VIN. Clock: ingest time of the decode.';
COMMENT ON COLUMN public.vin_decoded_data.created_at IS
'When the row was inserted: default now(), equal to decoded_at on all 115,872 rows (2026-10-07). Unit: timestamptz. Source: column default. Grain: one VIN. Clock: ingest time.';
COMMENT ON COLUMN public.vin_decoded_data.updated_at IS
'When the row was last written, default now(), no update trigger. Equal to created_at on all 115,872 rows (2026-10-07): no row was ever updated. Unit: timestamptz. Source: column default. Grain: one VIN. Clock: ingest time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vin_decoded_data'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vin_decoded_data: every column has a comment';
  ELSE
    RAISE NOTICE 'vin_decoded_data columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

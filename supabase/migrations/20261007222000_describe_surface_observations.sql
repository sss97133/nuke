-- Describe surface_observations: all 28 columns (5 of 28 had a COMMENT ON COLUMN before: severity, lifecycle_state,
-- descriptor_id, region_detail, pass_number; catalog count on prod, 2026-10-07) and a table comment, which it had not.
-- Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 378,032 rows on 2026-10-07 11:45Z by exact count (equal to
-- the atlas estimate), no write since the statistics counters began; the newest row is from 2026-05-01 15:33Z.
--
-- METHOD (read 2026-10-07 11:44-12:15Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy,
--   information_schema and pg_description. Fill, values, groups by writer, confidence, the key sets and JSON types of
--   metadata and evidence, zones against the keys of vehicle_surface_templates.zone_bounds and the date windows are exact
--   counts over the whole table (158 MB heap, read only). Rows whose vehicle no longer exists come from an exact anti-join;
--   rows whose image no longer exists, and the comparison with the image zone fields, come from a 1% block sample
--   (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 3,129 rows; the exact anti-join to vehicle_images exceeded the 10 s
--   timeout). What anon can read comes from a count and a view select under SET LOCAL ROLE anon in read-only transactions.
--   "Filled" means non-NULL.
--   Writers and readers from code at origin/main 795e38e0f (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps, docs, yono) and from git history: yono/modal_batch.py (_write_results; the Modal
--   app yono-batch with a 15-minute modal.Cron), yono/condition_spectrometer.py (write_surface_observation,
--   bridge_yono_output), scripts/seed-surface-templates.py (the u, v and h axes), the readers
--   supabase/functions/nlq-sql (called by nuke_frontend/src/pages/admin/NLQueryConsole.tsx; probed: deployed, HTTP 405 on
--   GET) and yono/training_sampler.py; the prod migration log supabase_migrations.schema_migrations, which holds the three
--   logged migrations that name the table (20260314011932 create_surface_mapping_schema, 20260314020917
--   expand_surface_observations_spectral, 20260314053702 backfill_spatial_coords_from_templates), none of them in the repo;
--   the live function body of backfill_surface_coords(integer) and its ACL (pg_get_functiondef, pg_proc.proacl); the view
--   vehicle_surface_coverage (pg_depend); 20260927170000 (the RPC write-door migration, which does not list that function);
--   cron.job (no command names the table or the function); write_receipts (no rows); pg_stat_user_tables;
--   pipeline_registry (no row; none is added here). The Modal app list of the configured Modal profile was read once.
-- LIMITS:
--   The 150,725-row seed of 2026-03-14 and the metadata marks of 2026-05-01 have no code in the repo and no logged
--   migration; they are described by their content (the seed matches the image zone on 1,126 of 1,140 sampled rows).
--   Which template a row got is not stored, so the template-match rule comes from the code. The Modal profile read may not
--   be the workspace that ran yono-batch. The 1% sample can miss rare cases. Quoted values are categorical codes, labels,
--   column and function names and counts only; the table holds no personal data.
-- CHANGED EXISTING COMMENTS:
--   Five column comments from 20260314020917 are kept word for word at the start of the new ones, each followed by what the
--   data shows: severity ("Continuous 0-1 spectrum. 0=trace, 1=complete. ..."; filled on 228 rows from a per-image score),
--   lifecycle_state ("fresh|worn|weathered|restored|palimpsest|ghost|archaeological — which era of existence"; only worn,
--   ghost and weathered occur, mapped from a 1 .. 5 condition score), descriptor_id ("FK to condition_taxonomy — bridges to
--   spectral scoring system"; filled on 228 rows), region_detail ("Finer than zone: ..."; never written) and pass_number
--   ("Spectrometer pass: 0=5W metadata, 1=broad vision, 2=contextual (Y/M/M), 3=sequence"; only 1 occurs). There was no
--   table comment.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.surface_observations IS
'Spatial layer of the YONO image vision passes: one row per finding about one image (a zone classification, a damage flag or a modification flag), anchored to the vehicle zone the image was classified into and, where a surface template matched, to that zone box in inches on the vehicle envelope (grain: one finding of one image by one pass; append-only, no unique key). 378,032 rows on 2026-10-07 for 323,450 images (median 1, at most 6 rows per image) of 4,946 vehicles, written 2026-03-14 01:20Z .. 2026-05-01 15:33Z. Created by the logged migration 20260314011932 create_surface_mapping_schema and extended by 20260314020917 expand_surface_observations_spectral; both are in the prod migration log, not in the repo. Writers, by content (exact, 2026-10-07): (1) yono/modal_batch.py, the Modal app yono-batch (a 15-minute modal.Cron in the code), wrote 225,229 rows with model_version finetuned_v2 and pass_number 1 from 2026-03-14 03:10Z to 2026-05-01 15:33Z: one zone_classify row per image (178,342), one condition row per damage flag (46,738) and one modification row per modification flag (149); the configured Modal profile lists no yono-batch app on 2026-10-07. (2) A seed with no code in the repo and no logged migration inserted 150,725 zone_classify rows on 2026-03-14 01:20Z .. 01:21Z, copied from the vehicle_images zone fields (model_version backfill_appraiser 106,918, finetuned_v2 38,689, yono_v2_florence2_finetuned 5,118; pass_number NULL, no bounding box). (3) yono/condition_spectrometer.py (bridge_yono_output, run by hand) wrote 2,078 rows with model_version yono_v1 on 2026-03-14 21:03Z .. 21:51Z, the only rows with severity and descriptor_id. backfill_surface_coords(integer), a SECURITY DEFINER function from the logged migration 20260314053702, later filled inch coordinates on rows that had none. What the rows can say: zone classifies the whole image (every bounding box is the full frame 0, 0, 1, 1 and resolution_level is 0 on every row), condition and modification rows repeat the zone of their image, and the inch coordinates are the box of that zone on a template of the vehicle make and year (102 templates for 30 makes; the two main writers do not compare the model), not a measured location: 73,929 rows (zones detail_badge, detail_damage and other) carry the whole vehicle envelope, and 8 zone codes the classifier emits are not template keys (11,595 rows never get coordinates). The vision output is weak: median confidence 0.16. On 2026-05-01 a writer not in the repo marked 254,928 rows (67.4%, every row with confidence below 0.30) metadata.data_status superseded_by_l1_gap_2026-05-01 (reason: florence2 zero-shot whole-frame; L1 vehicle bbox detection skipped) and 1,609 rows (confidence 0.50 or more) salvaged; all were kept. lifecycle_state and severity are mappings of the per-image condition score, not judgments of the surface. Readers: the edge function nlq-sql (deployed; called by the admin page NLQueryConsole; service role; read-only SQL over an allowlist that includes this table and its view), the view vehicle_surface_coverage (a per vehicle and zone rollup) and yono/training_sampler.py (run by hand); none filters on metadata.data_status. Liveness: pg_stat_user_tables shows 0 inserts, updates and deletes, 0 sequential and 2 index scans since its counters began (read 11:44Z, before this work scanned the table). Integrity: the foreign keys to vehicles, vehicle_images and condition_taxonomy have no ON DELETE action and are validated; 0 rows point at a deleted vehicle, and in a 1% block sample 2 of 3,129 point at a deleted image. Access: RLS is on with no policy, so anon and authenticated read nothing (0 rows under SET LOCAL ROLE anon, 2026-10-07; no grant on the view) although they hold the default table grants. backfill_surface_coords is SECURITY DEFINER and executable by PUBLIC, anon and authenticated (it fills coordinate columns from templates and touches nothing else); 20260927170000, which closed the anon RPC write door, does not list it. No pipeline_registry row, no write receipts. Clocks: created_at is the insert time; no column records when the photo was taken or when the model ran.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.surface_observations.id IS
'Surrogate key of the observation, uuid, gen_random_uuid() default, the PRIMARY KEY; nothing references it. 378,032 rows (2026-10-07). Unit: none (uuid). Source: column default. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.vehicle_image_id IS
'Image observed: a vehicle_images.id, NOT NULL, foreign key with no ON DELETE action (validated), indexed (idx_surface_obs_image). 323,450 distinct images (2026-10-07): median 1 row per image, at most 6; 7,423 images hold more than one zone_classify row (the seed and a later pass), always with the same zone. In a 1% block sample 2 of 3,129 rows (both from the 2026-03-14 seed) point at an image no longer in vehicle_images although the foreign key is validated; the delete that bypassed it is not recorded. Unit: none (uuid). Source: the writer (the image it analyzed or copied). Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.vehicle_id IS
'Vehicle of the image at write time: a vehicles.id, NOT NULL, foreign key with no ON DELETE action (validated), indexed (idx_surface_obs_vehicle). 4,946 distinct vehicles (2026-10-07), at most 4,624 rows for one vehicle; 0 rows point at a deleted vehicle, and it equals the current vehicle of the image on every sampled row whose image still exists. The writers use its make and year to pick the surface template. Unit: none (uuid). Source: the writer (vehicle_images.vehicle_id). Grain: one finding of one image by one pass. Clock: n/a.';

-- ── Zone and location on the vehicle ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.surface_observations.zone IS
'Vehicle zone the whole image was classified into, a code of the zone classifier, NOT NULL, no CHECK and no foreign key, indexed (idx_surface_obs_zone). 29 values (2026-10-07): detail_badge 78,167, int_dashboard 47,524, ext_front_driver 40,441, ext_undercarriage 32,438, mech_engine_bay 31,535, mech_suspension 28,897, ext_driver_side 28,524, other 20,094, int_front_seats 13,357, ext_rear_passenger 9,580, detail_damage 9,269 and 18 smaller codes. Condition and modification rows repeat the zone of their image, so a rust row says the image was classified, for example, as ext_front_driver, not that rust was found there. 8 codes (int_door_panel_fl, panel_door_fl, panel_hood, detail_vin, detail_odometer, int_cabin, panel_trunk, doc_title; 11,595 rows) are not keys of vehicle_surface_templates.zone_bounds, which uses other names (int_door_panel_driver and so on), so those rows never get inch coordinates. Seed rows copy vehicle_images.vehicle_zone (equal on 1,126 of 1,140 sampled seed rows today). Unit: none (text code). Source: the zone head of the Florence-2 vision pass, the YONO classifier, or the seed copy. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.u_min_inches IS
'Front edge of the zone box along the vehicle, in inches from the front bumper (0) toward the rear (the template length), per scripts/seed-surface-templates.py: the zone ratio in vehicle_surface_templates.zone_bounds times the template length. Filled on 248,499 rows (65.7%, 2026-10-07; the six u, v and h columns are filled together); NULL where no template of the make and year exists or the zone is not a template key. A template box for the zone, not a measured location: modal_batch.py and backfill_surface_coords take the first template of the vehicle make whose year range covers the vehicle year without comparing the model (condition_spectrometer.py compares it), and 73,929 rows (zones detail_badge, detail_damage, other) carry the whole envelope. Written at insert by the Python writers, or later by backfill_surface_coords(integer) for rows that had none. Indexed with the other u and v columns (idx_surface_obs_coords, partial). Range of the u columns 0 .. 233. Unit: inches. Source: vehicle_surface_templates.zone_bounds. Grain: one finding of one image by one pass. Clock: as of created_at (the template at write time).';
COMMENT ON COLUMN public.surface_observations.u_max_inches IS
'Rear edge of the zone box along the vehicle, in inches from the front bumper; same rows (248,499, 65.7%, 2026-10-07), writers and limits as u_min_inches; never below u_min_inches; at most 233. Unit: inches. Source: vehicle_surface_templates.zone_bounds. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.v_min_inches IS
'Driver-side edge of the zone box across the vehicle, in inches from the driver side (0) toward the passenger side (the template width); same rows (248,499, 65.7%, 2026-10-07), writers and limits as u_min_inches; range of the v columns 0 .. 80. Unit: inches. Source: vehicle_surface_templates.zone_bounds. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.v_max_inches IS
'Passenger-side edge of the zone box across the vehicle, in inches from the driver side; same rows, writers and limits as u_min_inches; never below v_min_inches. Unit: inches. Source: vehicle_surface_templates.zone_bounds. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.h_min_inches IS
'Lower edge of the zone box, in inches above the ground (0) toward the roof (the template height); same rows (248,499, 65.7%, 2026-10-07), writers and limits as u_min_inches; range of the h columns 0 .. 80; not indexed. Unit: inches. Source: vehicle_surface_templates.zone_bounds. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.h_max_inches IS
'Upper edge of the zone box, in inches above the ground; same rows, writers and limits as u_min_inches; never below h_min_inches. Unit: inches. Source: vehicle_surface_templates.zone_bounds. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.resolution_level IS
'Intended spatial resolution of the finding: 0 zone, 1 a 6x6 cell, 2 a 2x2 cell, 3 a 1x1 cell (the nlq-sql prompt); smallint, default 0. 0 on all 378,032 rows (2026-10-07): every finding is zone-level and no writer subdivides a zone, so the max_resolution of vehicle_surface_coverage is always 0. Unit: level code, 0 .. 3. Source: writer constant or column default. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.region_detail IS
'Finer than zone: rocker_panel_lower, cowl_seam, a_pillar_base (creating comment). NULL on all 378,032 rows (100%, 2026-10-07): write_surface_observation in condition_spectrometer.py accepts it but no caller passes it, and modal_batch.py does not write it. Unit: none (text). Source: none. Grain: one finding of one image by one pass. Clock: n/a.';

-- ── Region in the image ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.surface_observations.bbox_x IS
'Left edge of the image region the finding covers, as a fraction of image width. Filled on 227,307 rows (60.1%, 2026-10-07), and every filled box is 0, 0, 1, 1, the whole frame: both Python writers default to the full image and no caller passes a region; NULL on the 150,725 seed rows. No finding is localized inside its image. Unit: fraction of image width, 0 .. 1. Source: writer default. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.bbox_y IS
'Top edge of the image region, as a fraction of image height. Filled on the same 227,307 rows as bbox_x (60.1%, 2026-10-07) and 0 on each (whole frame). Unit: fraction of image height, 0 .. 1. Source: writer default. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.bbox_w IS
'Width of the image region, as a fraction of image width. Filled on the same 227,307 rows as bbox_x (60.1%, 2026-10-07) and 1 on each (whole frame). Unit: fraction of image width, 0 .. 1. Source: writer default. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.bbox_h IS
'Height of the image region, as a fraction of image height. Filled on the same 227,307 rows as bbox_x (60.1%, 2026-10-07) and 1 on each (whole frame). Unit: fraction of image height, 0 .. 1. Source: writer default. Grain: one finding of one image by one pass. Clock: n/a.';

-- ── Finding ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.surface_observations.observation_type IS
'Kind of finding, text NOT NULL with no CHECK, indexed with label (idx_surface_obs_type_label). 3 values (2026-10-07): zone_classify 330,917 (one per image and pass; label repeats the zone), condition 46,966 (one per damage flag) and modification 149 (one per modification flag). The types part, damage, color and label that the nlq-sql prompt lists occur on no row. Unit: none (text). Source: writer constant. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.label IS
'What was found, text, filled on every row (2026-10-07). On zone_classify rows it repeats zone; on condition rows it is the raw damage flag of the vision pass (rust 39,416, paint_fade 7,550); on modification rows the modification flag (aftermarket_wheels 148, roll_cage 1). The flags are outputs for the whole image placed at the image zone. Unit: none (text). Source: vision pass flags or the zone. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.confidence IS
'Confidence of the zone classification, real, 0 .. 1. Filled on 375,954 rows (99.5%, 2026-10-07); NULL on the 2,078 yono_v1 rows. modal_batch.py writes the zone confidence of the image on every row of that image, so on condition and modification rows it scores the zone, not the flag. Median 0.16; 254,928 rows below 0.30 and 1,609 at 0.50 or more, the two thresholds of the 2026-05-01 metadata marks; the 106,918 backfill_appraiser seed rows hold the constant 0.3. Seed rows copied the image zone confidence of that time. Unit: score, 0 .. 1. Source: zone classifier output (modal_batch.py) or the seed copy. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.severity IS
'Continuous 0-1 spectrum. 0=trace, 1=complete. "Slightly oxidized rocker" vs "perforated floor pan" (creating comment). Filled on 228 rows (0.06%, 2026-10-07), the yono_v1 condition rows of condition_spectrometer.py, with three values: 0.3 on 11, 0.5 on 15, 0.7 on 202. The writer derives it from the per-image condition score (score 5 gives 0.1, 4 gives 0.3, 3 gives 0.5, 2 gives 0.7, 1 gives 0.9), so it grades the whole image, not the flagged surface. NULL on the 46,738 condition rows of modal_batch.py. Partial index idx_surface_obs_severity. Unit: score, 0 .. 1. Source: condition_spectrometer.py _severity_from_score. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.lifecycle_state IS
'fresh|worn|weathered|restored|palimpsest|ghost|archaeological — which era of existence (creating comment). Filled on 270,858 rows (71.7%, 2026-10-07): worn 146,893, ghost 88,321, weathered 35,644; fresh, restored, palimpsest and archaeological occur on no row; NULL on the 106,918 backfill_appraiser seed rows and 256 yono_v1 rows. Both Python writers map the per-image condition score (1 .. 5) to it: 5 fresh, 4 worn, 3 weathered, 2 ghost, 1 archaeological; so ghost here means condition score 2, not the lifecycle meaning above, restored and palimpsest cannot be produced, and the seed rows carry the same three values. An nlq-sql example query asks for archaeological, which no row holds. Partial index idx_surface_obs_lifecycle. Unit: none (text). Source: mapping of the image condition score. Grain: one finding of one image by one pass. Clock: as of created_at.';
COMMENT ON COLUMN public.surface_observations.descriptor_id IS
'FK to condition_taxonomy — bridges to spectral scoring system (creating comment). Foreign key to condition_taxonomy(descriptor_id) with no ON DELETE action (validated), partial index idx_surface_obs_descriptor. Filled on 228 rows (0.06%, 2026-10-07), the yono_v1 condition rows: exterior.metal.oxidation for rust (211) and exterior.paint.fading for paint_fade (17), resolved by condition_spectrometer.py from the flag through the taxonomy aliases. NULL on the 46,738 condition rows of modal_batch.py, which does not resolve flags. Unit: none (uuid). Source: condition_spectrometer.py _resolve_flag. Grain: one finding of one image by one pass. Clock: n/a.';

-- ── Provenance ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.surface_observations.model_version IS
'Producer stamp of the row, text, filled on every row (2026-10-07): finetuned_v2 on 263,918 (225,229 from modal_batch.py, which writes the vision_model_version of its run, and 38,689 seed rows), backfill_appraiser on 106,918 (seed rows copied from images whose zone came from the appraiser backfill, vehicle_images.zone_source backfill_from_appraiser), yono_v2_florence2_finetuned on 5,118 (seed) and yono_v1 on 2,078 (condition_spectrometer.py, its source name). Read it with pass_number to tell the seed (pass_number NULL) from the passes. Unit: none (text). Source: the writer. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.pass_name IS
'Sub-pass that wrote the row, text, filled on every row (2026-10-07): zone_classify 330,917, damage_scan 46,966, mod_scan 149; it maps one to one onto observation_type. Unit: none (text). Source: writer constant. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.pass_number IS
'Spectrometer pass: 0=5W metadata, 1=broad vision, 2=contextual (Y/M/M), 3=sequence (creating comment). 1 on 227,307 rows (60.1%, 2026-10-07), every row of modal_batch.py and condition_spectrometer.py; NULL on the 150,725 seed rows; 0, 2 and 3 occur on no row. The creating migration also made a partial index on it (idx_surface_obs_pass), which is absent on prod. Unit: pass code, 0 .. 3. Source: writer constant. Grain: one finding of one image by one pass. Clock: n/a.';
COMMENT ON COLUMN public.surface_observations.metadata IS
'Annotations on the row, a JSON object, default {}, never NULL; {} on 121,495 rows (2026-10-07). On 2026-05-01 a writer with no code in the repo and no logged migration marked 256,537 rows by confidence: data_status superseded_by_l1_gap_2026-05-01 with reason florence2 zero-shot whole-frame; L1 vehicle bbox detection skipped and superseded_at 2026-05-01 on 254,928 rows (67.4%, every row with confidence below 0.30), and data_status salvaged with a reason saying the output is usable at confidence 0.50 or more pending a re-extraction on L1 vehicle crops, and noted_at 2026-05-01, on 1,609 rows (every row at 0.50 or more). The marked rows were kept. nlq-sql, vehicle_surface_coverage and training_sampler.py do not filter on it. Unit: none (jsonb). Source: the 2026-05-01 marking. Grain: one finding of one image by one pass. Clock: superseded_at and noted_at are the date of the marking.';
COMMENT ON COLUMN public.surface_observations.evidence IS
'Raw writer output, jsonb, no default. Filled on 47,115 rows (12.5%, 2026-10-07), the condition and modification rows; NULL on every zone_classify row. On the 228 yono_v1 rows it is an object with the key raw_flag; on the 46,887 rows of modal_batch.py it is a JSON string that holds that object as text, because the writer passed json.dumps output through the REST client, so evidence ->> raw_flag is NULL there and the string must be parsed first. The flag equals label on every such row. Unit: none (jsonb). Source: the writer. Grain: one finding of one image by one pass. Clock: as of created_at.';

-- ── Row clock ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.surface_observations.created_at IS
'When the row was inserted: default now(), nullable but filled on every row (2026-10-07); the coordinate backfill and the 2026-05-01 metadata marks did not move it. Range 2026-03-14 01:20Z .. 2026-05-01 15:33Z; by month 2026-03 374,185 (the seed 150,725 at 01:20Z .. 01:21Z on 03-14, yono_v1 2,078 on 03-14, modal_batch.py the rest), 2026-04 1,206, 2026-05 2,641 (all on 05-01). It is our write time, not when the photo was taken or the model ran. Unit: timestamptz. Source: column default. Grain: one finding of one image by one pass. Clock: ingest time.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.surface_observations'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'surface_observations: every column has a comment';
  ELSE
    RAISE NOTICE 'surface_observations columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;

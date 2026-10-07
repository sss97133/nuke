-- Correct one sentence of the surface_observations table comment after the write-door fix. Comments only: the table
-- comment is replaced with the text 20261007222000_describe_surface_observations.sql set, except the sentence about who
-- may execute backfill_surface_coords(integer); no column comment changes (28 of 28 columns stay described).
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-07 12:05-12:10Z UTC):
--   The live table comment from pg_description (obj_description), compared with the text of
--   20261007222000_describe_surface_observations.sql at origin/main 946514da0: identical, 4,164 characters. The ACL of
--   public.backfill_surface_coords(integer) from pg_proc.proacl and has_function_privilege on prod at 12:08Z:
--   {postgres=X/postgres,service_role=X/postgres}; anon false, authenticated false, service_role true; prosecdef true.
--   The change that produced it: 20261007230000_close_backfill_surface_coords_door.sql (PR #797; REVOKE from PUBLIC,
--   anon and authenticated, GRANT to service_role). The new comment is built by replacing that one sentence in the live
--   text; every other character is kept.
-- LIMITS:
--   The rest of the comment keeps its 2026-10-07 counts and its read times (11:44Z) as they were; nothing was re-measured.
-- CHANGED EXISTING COMMENTS:
--   Table comment only. It said: "backfill_surface_coords is SECURITY DEFINER and executable by PUBLIC, anon and
--   authenticated (it fills coordinate columns from templates and touches nothing else); 20260927170000, which closed the
--   anon RPC write door, does not list it." That was true when 20261007222000 was written and stopped being true when
--   20261007230000 revoked the grants. It now says the function is executable by service_role only since 2026-10-07 and
--   why anon could run it before. Column comments are unchanged.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.surface_observations IS
'Spatial layer of the YONO image vision passes: one row per finding about one image (a zone classification, a damage flag or a modification flag), anchored to the vehicle zone the image was classified into and, where a surface template matched, to that zone box in inches on the vehicle envelope (grain: one finding of one image by one pass; append-only, no unique key). 378,032 rows on 2026-10-07 for 323,450 images (median 1, at most 6 rows per image) of 4,946 vehicles, written 2026-03-14 01:20Z .. 2026-05-01 15:33Z. Created by the logged migration 20260314011932 create_surface_mapping_schema and extended by 20260314020917 expand_surface_observations_spectral; both are in the prod migration log, not in the repo. Writers, by content (exact, 2026-10-07): (1) yono/modal_batch.py, the Modal app yono-batch (a 15-minute modal.Cron in the code), wrote 225,229 rows with model_version finetuned_v2 and pass_number 1 from 2026-03-14 03:10Z to 2026-05-01 15:33Z: one zone_classify row per image (178,342), one condition row per damage flag (46,738) and one modification row per modification flag (149); the configured Modal profile lists no yono-batch app on 2026-10-07. (2) A seed with no code in the repo and no logged migration inserted 150,725 zone_classify rows on 2026-03-14 01:20Z .. 01:21Z, copied from the vehicle_images zone fields (model_version backfill_appraiser 106,918, finetuned_v2 38,689, yono_v2_florence2_finetuned 5,118; pass_number NULL, no bounding box). (3) yono/condition_spectrometer.py (bridge_yono_output, run by hand) wrote 2,078 rows with model_version yono_v1 on 2026-03-14 21:03Z .. 21:51Z, the only rows with severity and descriptor_id. backfill_surface_coords(integer), a SECURITY DEFINER function from the logged migration 20260314053702, later filled inch coordinates on rows that had none. What the rows can say: zone classifies the whole image (every bounding box is the full frame 0, 0, 1, 1 and resolution_level is 0 on every row), condition and modification rows repeat the zone of their image, and the inch coordinates are the box of that zone on a template of the vehicle make and year (102 templates for 30 makes; the two main writers do not compare the model), not a measured location: 73,929 rows (zones detail_badge, detail_damage and other) carry the whole vehicle envelope, and 8 zone codes the classifier emits are not template keys (11,595 rows never get coordinates). The vision output is weak: median confidence 0.16. On 2026-05-01 a writer not in the repo marked 254,928 rows (67.4%, every row with confidence below 0.30) metadata.data_status superseded_by_l1_gap_2026-05-01 (reason: florence2 zero-shot whole-frame; L1 vehicle bbox detection skipped) and 1,609 rows (confidence 0.50 or more) salvaged; all were kept. lifecycle_state and severity are mappings of the per-image condition score, not judgments of the surface. Readers: the edge function nlq-sql (deployed; called by the admin page NLQueryConsole; service role; read-only SQL over an allowlist that includes this table and its view), the view vehicle_surface_coverage (a per vehicle and zone rollup) and yono/training_sampler.py (run by hand); none filters on metadata.data_status. Liveness: pg_stat_user_tables shows 0 inserts, updates and deletes, 0 sequential and 2 index scans since its counters began (read 11:44Z, before this work scanned the table). Integrity: the foreign keys to vehicles, vehicle_images and condition_taxonomy have no ON DELETE action and are validated; 0 rows point at a deleted vehicle, and in a 1% block sample 2 of 3,129 point at a deleted image. Access: RLS is on with no policy, so anon and authenticated read nothing (0 rows under SET LOCAL ROLE anon, 2026-10-07; no grant on the view) although they hold the default table grants. backfill_surface_coords is SECURITY DEFINER (it fills coordinate columns from templates and touches nothing else) and executable by service_role only since 2026-10-07 (20261007230000); PUBLIC, anon and authenticated could run it before, because the 2026-09-27 RPC write-door pass 20260927170000 did not list it. No pipeline_registry row, no write receipts. Clocks: created_at is the insert time; no column records when the photo was taken or when the model ran.';

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

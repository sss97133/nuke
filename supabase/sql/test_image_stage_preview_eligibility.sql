-- Contract for 20261124214000_image_stage_preview_eligibility.sql, on a fresh disposable database: the owner's own cached
-- Photos preview (is_external because the reviewed intake, 20261115182056, cannot claim the original) enters the reading
-- stages once it is filed, like any filed photo; a truly external photo and an unfiled preview still queue nothing; the
-- classifier stage does not re-read a preview whose classification exists.
-- The predecessors' contracts build the fixture and prove 20261120130000 and 20261124210000 (the second ends reverted, so
-- both are applied again).
\set ON_ERROR_STOP on
\ir test_image_stage_event_lane.sql
\ir ../migrations/20261120130000_photo_deep_reading_keyed_values_stages.sql
\ir ../migrations/20261124210000_image_stage_event_lane.sql

-- production's column (text, default 'user_upload'); the earlier fixtures did not read it
ALTER TABLE vehicle_images ADD COLUMN source text DEFAULT 'user_upload';

-- production's settings on 2026-11-24
UPDATE platform_config SET config_value = jsonb_build_object('enabled', true, 'max_open', 5, 'user_ids', jsonb_build_array(pg_temp.u1()),
  'exclude_vehicle_ids', jsonb_build_array(pg_temp.vx())) WHERE config_key = 'image_stage_deep_reading';
UPDATE platform_config SET config_value = jsonb_build_object('enabled', true, 'max_open', 300, 'user_ids', jsonb_build_array(pg_temp.u1()),
  'live_days', 2, 'live_due_days', 14, 'refill_below', 100, 'scan_per_lane', 200, 'backfill_share', 0.5, 'min_age_minutes', 15,
  'first_read_at_landing', true)
 WHERE config_key = 'image_stage_reconciler';
UPDATE image_pipeline_stages SET backfill_daily_cap = 0 WHERE stage = 'deep_reading';
DELETE FROM image_stage_work; DELETE FROM image_stage_receipts;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL;

-- (pg_temp.clear_work and pg_temp.lane_of come from the event lane contract)
CREATE FUNCTION pg_temp.open_any(n int) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.image_stage_work WHERE image_id = pg_temp.img(n) AND status IN ('queued', 'claimed') $$;
CREATE FUNCTION pg_temp.md5_of(fn text) RETURNS text LANGUAGE sql AS
  $$ SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(fn) $$;
-- custody as the intake writes it: is_external, source and the rendition contract (exif_data.source_rendition.contract)
CREATE FUNCTION pg_temp.custody(n int, src text, contract text, usr_null boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  UPDATE public.vehicle_images
     SET is_external = true, source = src,
         exif_data = CASE WHEN contract IS NULL THEN '{}'::jsonb
                          ELSE jsonb_build_object('source_rendition', jsonb_build_object('contract', contract, 'rendition_kind', 'cached_preview')) END,
         user_id = CASE WHEN usr_null THEN NULL ELSE user_id END
   WHERE id = pg_temp.img(n) $$;

-- the photos (the custody update touches no column the landing triggers watch)
SELECT pg_temp.mk(601, age => interval '9 days');                                       -- filed, approved, first-read preview (the 14)
SELECT pg_temp.custody(601, 'iphoto', 'photos_cached_preview_v1');
SELECT pg_temp.mk(602, age => interval '9 days', unfiled => true, gate => 'pending', status => 'skipped',
  meta => '{"processing_policy":{"mode":"subscription_review","state":"awaiting_supplied_classification","deferred":true}}');
SELECT pg_temp.custody(602, 'iphoto', 'photos_cached_preview_v1');                       -- unfiled preview as it lands: no first read
SELECT pg_temp.mk(603, age => interval '9 days', unfiled => true, gate => 'pending');   -- unfiled preview, classified (the 7)
SELECT pg_temp.custody(603, 'iphoto', 'photos_cached_preview_v1');
SELECT pg_temp.mk(604, age => interval '9 days');                                       -- truly external: another source, no rendition
SELECT pg_temp.custody(604, 'user_upload', NULL);
SELECT pg_temp.mk(605, age => interval '9 days');                                       -- external iphoto row with no rendition contract
SELECT pg_temp.custody(605, 'iphoto', NULL);
SELECT pg_temp.mk(606, age => interval '9 days');                                       -- a rendition contract the helper does not name
SELECT pg_temp.custody(606, 'iphoto', 'photos_original_v1');
SELECT pg_temp.mk(607, age => interval '9 days');                                       -- a preview with no owner
SELECT pg_temp.custody(607, 'iphoto', 'photos_cached_preview_v1', usr_null => true);
SELECT pg_temp.mk(608, age => interval '9 days', unfiled => true, gate => 'pending');   -- a classified preview, filed below
SELECT pg_temp.custody(608, 'iphoto', 'photos_cached_preview_v1');
SELECT pg_temp.mk(609, age => interval '9 days', meta => pg_temp.reading(609));         -- a filed preview that holds a reading
SELECT pg_temp.custody(609, 'iphoto', 'photos_cached_preview_v1');
SELECT pg_temp.parent(609);

-- ===== before the change: the defect
SELECT pg_temp.ok(NOT pg_temp.has_gap(601, 'deep_reading'), 'before: a filed, approved, first-read preview has no deep reading gap');
SELECT pg_temp.ok(NOT pg_temp.has_gap(609, 'keyed_values'), 'before: a preview holding a reading has no keyed values gap');
SELECT pg_temp.ok(NOT pg_temp.has_gap(601, 'classifier') AND NOT pg_temp.has_gap(603, 'classifier'),
  'before: a classified preview has no classifier gap');
SELECT pg_temp.ok((SELECT block FROM image_stage_photo_levels(pg_temp.u1(), pg_temp.v1()) WHERE image_id = pg_temp.img(601)) = 'external',
  'before: the levels name the filed preview external');
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE image_id IN (SELECT pg_temp.img(k) FROM generate_series(601, 609) k)) = 0,
  'before: the reconciler queues nothing for any of them');
UPDATE vehicle_images SET vehicle_id = pg_temp.v1(), vision_gate_status = 'approved' WHERE id = pg_temp.img(608);
SELECT pg_temp.ok(pg_temp.open_any(608) = 0, 'before: filing a preview queues nothing');
UPDATE vehicle_images SET vehicle_id = NULL, vision_gate_status = 'pending' WHERE id = pg_temp.img(608);
SELECT pg_temp.clear_work();

\ir ../migrations/20261124214000_image_stage_preview_eligibility.sql

SELECT pg_temp.ok(pg_temp.md5_of('public.image_stage_photo_block(uuid,text,boolean,boolean,text,boolean,boolean,boolean,boolean,text,text)')
  = 'e4c179f2a0551904d7f7f2449e5bc4ce', 'image_stage_photo_block is unchanged');
-- the helper, case by case
SELECT pg_temp.ok(image_stage_custody_external(false, pg_temp.u1(), 'iphoto', '{}') IS FALSE
  AND image_stage_custody_external(NULL, pg_temp.u1(), 'iphoto', NULL) IS FALSE
  AND image_stage_custody_external(true, pg_temp.u1(), 'iphoto', '{"source_rendition":{"contract":"photos_cached_preview_v1"}}') IS FALSE
  AND image_stage_custody_external(true, pg_temp.u1(), 'iphoto', NULL) IS TRUE
  AND image_stage_custody_external(true, pg_temp.u1(), 'iphoto', '{}') IS TRUE
  AND image_stage_custody_external(true, pg_temp.u1(), 'iphoto', '{"source_rendition":{"contract":"photos_original_v1"}}') IS TRUE
  AND image_stage_custody_external(true, pg_temp.u1(), NULL, '{"source_rendition":{"contract":"photos_cached_preview_v1"}}') IS TRUE
  AND image_stage_custody_external(true, pg_temp.u1(), 'user_upload', '{"source_rendition":{"contract":"photos_cached_preview_v1"}}') IS TRUE
  AND image_stage_custody_external(true, NULL, 'iphoto', '{"source_rendition":{"contract":"photos_cached_preview_v1"}}') IS TRUE,
  'helper: false only for a non-external photo or the owner''s own cached preview');

-- ===== 1. gaps and levels
SELECT pg_temp.ok((SELECT reason FROM image_stage_gaps(ARRAY[pg_temp.img(601)]) WHERE stage = 'deep_reading') = 'missing',
  'after: the filed preview is a deep reading gap (missing)');
SELECT pg_temp.ok(pg_temp.has_gap(609, 'keyed_values') AND NOT pg_temp.has_gap(609, 'deep_reading'),
  'after: a preview holding a reading is a keyed values gap, not a deep reading one');
SELECT pg_temp.ok(NOT pg_temp.has_gap(601, 'classifier') AND NOT pg_temp.has_gap(603, 'classifier') AND NOT pg_temp.has_gap(609, 'classifier'),
  'after: a preview whose classification exists is not re-read by the classifier');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY[pg_temp.img(604), pg_temp.img(605), pg_temp.img(606), pg_temp.img(607)])
                                WHERE stage IN ('deep_reading', 'keyed_values')),
  'after: no reading gap for a truly external photo, an unnamed contract or an ownerless preview');
SELECT pg_temp.ok(NOT pg_temp.has_gap(603, 'deep_reading'), 'after: an unfiled preview is no reading gap');
SELECT pg_temp.ok((SELECT block FROM image_stage_photo_levels(pg_temp.u1(), pg_temp.v1()) WHERE image_id = pg_temp.img(601)) IS NULL
  AND (SELECT block FROM image_stage_photo_levels(pg_temp.u1(), pg_temp.v1()) WHERE image_id = pg_temp.img(604)) = 'external'
  AND (SELECT block FROM image_stage_photo_levels(pg_temp.u1(), NULL) WHERE image_id = pg_temp.img(603)) = 'unfiled',
  'after: the levels block the filed preview on nothing, keep external for the true external, and name the unfiled preview unfiled');

-- ===== 2. the reconciler's live due scan queues the filed preview
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok(pg_temp.lane_of(601, 'deep_reading') = 'live', 'reconciler: the filed preview is queued for deep reading in the live lane');
SELECT pg_temp.ok(pg_temp.lane_of(609, 'keyed_values') = 'live', 'reconciler: the preview holding a reading is queued for keyed values');
SELECT pg_temp.ok(pg_temp.open_any(601) = 1 AND pg_temp.open_any(609) = 1, 'reconciler: one stage each, no classifier item');
SELECT pg_temp.ok(pg_temp.open_any(602) + pg_temp.open_any(603) = 0,
  'reconciler: an unfiled preview queues nothing in any stage (as landed with no first read, or classified)');
SELECT pg_temp.ok(pg_temp.open_any(604) + pg_temp.open_any(605) + pg_temp.open_any(606) + pg_temp.open_any(607) = 0,
  'reconciler: a truly external photo, an unnamed contract and an ownerless preview queue nothing');

-- ===== 3. replay is idempotent: the migration passes its own guard and a second tick adds nothing
CREATE TEMP TABLE work_before AS SELECT image_id, stage, lane, status FROM image_stage_work;
\ir ../migrations/20261124214000_image_stage_preview_eligibility.sql
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work) = (SELECT count(*) FROM work_before)
  AND NOT EXISTS (SELECT image_id, stage, lane, status FROM image_stage_work EXCEPT SELECT * FROM work_before)
  AND (SELECT count(*) FROM image_stage_work WHERE image_id IN (SELECT pg_temp.img(k) FROM generate_series(601, 609) k)) = 2,
  'replay: the same open items after the replay and a second tick, two of them the previews''');

-- ===== 4. the claim hands the queued preview to the reader and still drops a queued true external
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, not_before)
VALUES (pg_temp.img(604), 'deep_reading', 1, 'missing', 'live', now());
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('deep_reading', 8, 300, pg_temp.u1()) c WHERE c.image_id = pg_temp.img(601)) = 1,
  'claim: the filed preview is claimed for deep reading');
SELECT pg_temp.ok((SELECT status FROM image_stage_work WHERE image_id = pg_temp.img(604)) = 'dropped', 'claim: a queued true external is dropped');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('keyed_values', 8, 300, pg_temp.u1()) c WHERE c.image_id = pg_temp.img(609)) = 1,
  'claim: the preview holding a reading is claimed for keyed values');
SELECT pg_temp.clear_work();

-- ===== 5. a filing event queues the preview at once, in the live lane
UPDATE vehicle_images SET vehicle_id = pg_temp.v1(), vision_gate_status = 'approved' WHERE id = pg_temp.img(608);
SELECT pg_temp.ok(pg_temp.lane_of(608, 'deep_reading') = 'live' AND pg_temp.open_any(608) = 1,
  'filing event: a preview filed now is queued for deep reading in the live lane, and for nothing else');
SELECT pg_temp.ok(enqueue_image_stage_work(ARRAY[pg_temp.img(604), pg_temp.img(605), pg_temp.img(606), pg_temp.img(607), pg_temp.img(603)], 'live') = 0,
  'event enqueue: nothing for a true external, an unnamed contract, an ownerless or an unfiled preview');
SELECT pg_temp.clear_work();

-- ===== 6. the revert restores production's bodies and removes the helper
\ir revert_20261124214000_image_stage_preview_eligibility.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.image_stage_gaps(uuid[])') = '2603ca428eceb41a6f08513326f57008'
  AND pg_temp.md5_of('public.image_stage_photo_levels(uuid,uuid)') = 'a690d620d07b414631049417588f468e'
  AND pg_temp.md5_of('public.reconcile_image_stages(integer)') = '7699c4293e008456fb731a9251d4633e'
  AND pg_temp.md5_of('public.enqueue_image_stage_work(uuid[],text)') = '700e76f34436e437369193a692bd216b'
  AND pg_temp.md5_of('public.claim_image_stage_work(text,integer,integer,uuid)') = 'f0f94d7e84a2907789c89099eb33a2e7'
  AND to_regprocedure('public.image_stage_custody_external(boolean,uuid,text,jsonb)') IS NULL,
  'revert: the five bodies are the ones production held and the helper is gone');
SELECT pg_temp.ok(NOT pg_temp.has_gap(601, 'deep_reading'), 'revert: the filed preview is out again');
\echo 'image stage preview eligibility contract passed'

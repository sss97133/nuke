-- Contract for 20261124210000_image_stage_event_lane.sql, on a fresh disposable database: a photo that becomes due for
-- deep reading after its live window (filed days after it landed, or due when the scope widened) is queued in the live
-- lane by the filing event or by the reconciler's live scan, not left to the backfill cursor and its daily cap; a
-- classification landing on an older photo still follows the upload-date rule; the stage room still holds.
-- The predecessor's own contract builds the fixture and proves 20261120130000 (it ends reverted, so it is applied again).
\set ON_ERROR_STOP on
\ir test_image_stage_keyed_values.sql
\ir ../migrations/20261120130000_photo_deep_reading_keyed_values_stages.sql

-- production's settings on 2026-11-24: the owner-filed scope (20261123220000) and the reconciler row
UPDATE platform_config SET config_value = jsonb_build_object('enabled', true, 'max_open', 5, 'user_ids', jsonb_build_array(pg_temp.u1()),
  'exclude_vehicle_ids', jsonb_build_array(pg_temp.vx())) WHERE config_key = 'image_stage_deep_reading';
UPDATE platform_config SET config_value = jsonb_build_object('enabled', true, 'max_open', 300, 'user_ids', jsonb_build_array(pg_temp.u1()),
  'live_days', 2, 'refill_below', 100, 'scan_per_lane', 200, 'backfill_share', 0.5, 'min_age_minutes', 15)
 WHERE config_key = 'image_stage_reconciler';
-- the day's deep reading backfill cap is used up (the state the measured photo met): only the live lane can queue it
UPDATE image_pipeline_stages SET backfill_daily_cap = 0 WHERE stage = 'deep_reading';
DELETE FROM image_stage_work; DELETE FROM image_stage_receipts;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL;

CREATE FUNCTION pg_temp.lane_of(n int, st text) RETURNS text LANGUAGE sql AS
  $$ SELECT string_agg(lane, ',') FROM public.image_stage_work WHERE image_id = pg_temp.img(n) AND stage = st AND status IN ('queued', 'claimed') $$;
CREATE FUNCTION pg_temp.clear_work() RETURNS void LANGUAGE sql AS $$ DELETE FROM public.image_stage_work $$;

-- the photos
SELECT pg_temp.mk(401, age => interval '3 days');                                                 -- filed, read first, three days old: due
SELECT pg_temp.mk(402, age => interval '5 days', unfiled => true);                                 -- five days old, filed later below
SELECT pg_temp.mk(403, age => interval '30 days');                                                 -- thirty days old, re-classified below
SELECT pg_temp.mk(404, age => interval '20 days');                                                 -- filed, outside live_due_days
SELECT pg_temp.mk(406, age => interval '3 days', ext => true);                                     -- custody external: never due
SELECT pg_temp.mk(407, age => interval '3 days', gate => 'pending');                               -- filed, gate not approved
SELECT pg_temp.ok(pg_temp.has_gap(401, 'deep_reading') AND pg_temp.has_gap(403, 'deep_reading') AND pg_temp.has_gap(404, 'deep_reading'),
  'precondition: 401, 403, 404 are deep reading gaps');
SELECT pg_temp.ok(NOT pg_temp.has_gap(406, 'deep_reading') AND NOT pg_temp.has_gap(407, 'deep_reading'), 'precondition: 406 and 407 are not');

-- ===== before the change: the defect
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok(pg_temp.open_items(401, 'deep_reading') = 0, 'before: a due photo three days old is not queued by the reconciler');
UPDATE vehicle_images SET vehicle_id = pg_temp.v1(), vision_gate_status = 'approved' WHERE id = pg_temp.img(402);
SELECT pg_temp.ok(pg_temp.has_gap(402, 'deep_reading') AND pg_temp.open_items(402, 'deep_reading') = 0,
  'before: a photo filed five days after it landed is due and its filing queues nothing');
SELECT pg_temp.clear_work();

\ir ../migrations/20261124210000_image_stage_event_lane.sql

SELECT pg_temp.ok((SELECT (config_value ->> 'live_due_days')::int = 14 AND (config_value ->> 'live_days')::int = 2 AND (config_value ->> 'max_open')::int = 300
                     AND (config_value ->> 'scan_per_lane')::int = 200 FROM platform_config WHERE config_key = 'image_stage_reconciler'),
  'setting: live_due_days 14 added, the other keys unchanged');
SELECT pg_temp.ok((SELECT backfill_daily_cap FROM image_pipeline_stages WHERE stage = 'deep_reading') = 0
  AND (SELECT config_value ->> 'max_open' FROM platform_config WHERE config_key = 'image_stage_deep_reading') = '5', 'cap and room untouched');

-- ===== 1. the reconciler's live lane reaches a due photo landed within live_due_days
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok(pg_temp.lane_of(401, 'deep_reading') = 'live', 'after: the three-day-old due photo is queued in the live lane');
SELECT pg_temp.ok(pg_temp.open_items(404, 'deep_reading') = 0, 'after: a photo outside live_due_days is still the backfill''s');
SELECT pg_temp.ok(pg_temp.open_items(406, 'deep_reading') = 0 AND pg_temp.open_items(407, 'deep_reading') = 0,
  'after: external custody and an unapproved gate still queue nothing');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE lane = 'backfill') = 0, 'after: nothing reached the capped backfill');
SELECT pg_temp.clear_work();

-- ===== 2. a filing event queues in the live lane whatever the upload date
SELECT pg_temp.mk(408, age => interval '5 days', unfiled => true);
UPDATE vehicle_images SET vehicle_id = pg_temp.v1(), vision_gate_status = 'approved' WHERE id = pg_temp.img(408);
SELECT pg_temp.ok(pg_temp.lane_of(408, 'deep_reading') = 'live', 'filing event: a photo filed five days after it landed is queued live at once');
SELECT pg_temp.mk(409, age => interval '60 days', unfiled => true);
UPDATE vehicle_images SET vehicle_id = pg_temp.v1(), vision_gate_status = 'approved' WHERE id = pg_temp.img(409);
SELECT pg_temp.ok(pg_temp.lane_of(409, 'deep_reading') = 'live', 'filing event: an old photo filed now is news too');
SELECT pg_temp.clear_work();

-- ===== 3. control: a classification landing on an old filed photo keeps the upload-date rule (backfill, capped)
UPDATE vehicle_images SET ai_scan_metadata = jsonb_set(ai_scan_metadata, '{classification,confidence}', '0.95') WHERE id = pg_temp.img(403);
SELECT pg_temp.ok(pg_temp.open_items(403, 'deep_reading') = 0, 'control: re-classifying a 30-day-old photo queues nothing while the backfill cap is used up');
UPDATE image_pipeline_stages SET backfill_daily_cap = 150 WHERE stage = 'deep_reading';
UPDATE vehicle_images SET ai_scan_metadata = jsonb_set(ai_scan_metadata, '{classification,confidence}', '0.96') WHERE id = pg_temp.img(403);
SELECT pg_temp.ok(pg_temp.lane_of(403, 'deep_reading') = 'backfill', 'control: with cap left it is queued in the backfill lane, not live');
UPDATE image_pipeline_stages SET backfill_daily_cap = 0 WHERE stage = 'deep_reading';
SELECT pg_temp.clear_work();

-- ===== 4. the room still holds: six due photos in the window, five slots
SELECT pg_temp.mk(410 + k, age => interval '4 days') FROM generate_series(0, 5) k;
SELECT reconcile_image_stages(100);
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND status = 'queued') = 5,
  'room: the live lane fills the five deep reading slots and no more');
SELECT pg_temp.clear_work();

-- ===== 5. a photo at the end of the chain is not rescanned: a closing keyed_values receipt takes it out of the due scan
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome)
SELECT pg_temp.img(410 + k), 'keyed_values', 'ingest-observation-batch', 1, 'succeeded' FROM generate_series(0, 5) k;
SELECT pg_temp.ok((SELECT count(*) FROM vehicle_images c WHERE c.vehicle_id IS NOT NULL AND c.created_at >= now() - interval '14 days'
   AND NOT EXISTS (SELECT 1 FROM image_stage_receipts r WHERE r.image_id = c.id AND r.stage = 'keyed_values' AND r.outcome IN ('succeeded', 'policy_skip'))
   AND c.id IN (SELECT pg_temp.img(410 + k) FROM generate_series(0, 5) k)) = 0, 'due scan: closed photos are left out');
DELETE FROM image_stage_receipts;

-- ===== 6. replay passes its own guard; the revert restores production's bodies
\ir ../migrations/20261124210000_image_stage_event_lane.sql
SELECT pg_temp.ok((SELECT count(*) FROM platform_config WHERE config_key = 'image_stage_reconciler' AND config_value ? 'live_due_days') = 1, 'replay: one setting');
\ir revert_20261124210000_image_stage_event_lane.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.photo_land_trigger()'::regprocedure) = 'bdb3b709bfdee1138fe76e68457a8650'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.reconcile_image_stages(integer)'::regprocedure) = '056eed5153c3886e44414b2cc0327502'
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'image_stage_reconciler' AND config_value ? 'live_due_days'),
  'revert: both bodies are the ones production held and the setting is gone');
\echo 'image stage event lane contract passed'

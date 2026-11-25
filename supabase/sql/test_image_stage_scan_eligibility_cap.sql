-- Contract for 20261125070000_image_stage_scan_eligibility_cap.sql, on a fresh disposable database:
--   (1) 201 filed photos that can never close (custody external) no longer crowd a three-day-old due photo out of the live
--       due scan; each ineligible filed photo is closed once per reason with a visible keyed_values policy_skip; a photo
--       that becomes eligible again reopens, including one that already held a reading when it was skipped;
--   (2) a stage's live_daily_cap is counted at the claim: overflow stays queued with not_before at the next midnight PT,
--       the backfill is still claimed, the flow watch names the cap and not a stall, and an uncapped stage is unchanged.
-- The predecessors' contracts build the fixture and prove 20261120130000, 20261124210000 and 20261124214000 (the last ends
-- reverted, so it is applied again).
\set ON_ERROR_STOP on
\ir test_image_stage_preview_eligibility.sql
\ir ../migrations/20261124214000_image_stage_preview_eligibility.sql

-- production's settings on 2026-11-25
UPDATE platform_config SET config_value = jsonb_build_object('enabled', true, 'max_open', 5, 'user_ids', jsonb_build_array(pg_temp.u1()),
  'exclude_vehicle_ids', jsonb_build_array(pg_temp.vx())) WHERE config_key = 'image_stage_deep_reading';
UPDATE platform_config SET config_value = jsonb_build_object('enabled', true, 'max_open', 300, 'user_ids', jsonb_build_array(pg_temp.u1()),
  'live_days', 2, 'live_due_days', 14, 'refill_below', 100, 'scan_per_lane', 200, 'backfill_share', 0.5, 'min_age_minutes', 15,
  'first_read_at_landing', true)
 WHERE config_key = 'image_stage_reconciler';
-- the day's deep reading backfill cap is used up: only the live lane can queue a deep reading
UPDATE image_pipeline_stages SET backfill_daily_cap = 0 WHERE stage = 'deep_reading';
DELETE FROM image_stage_work; DELETE FROM image_stage_receipts; DELETE FROM vehicle_images;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL;

CREATE FUNCTION pg_temp.skips(n int) RETURNS text LANGUAGE sql AS
  $$ SELECT string_agg(detail ->> 'skipped', ',' ORDER BY id) FROM public.image_stage_receipts
      WHERE image_id = pg_temp.img(n) AND stage = 'keyed_values' AND outcome = 'policy_skip' AND error_class = 'stage_eligibility' $$;
CREATE FUNCTION pg_temp.skip_total() RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.image_stage_receipts WHERE error_class = 'stage_eligibility' $$;
CREATE FUNCTION pg_temp.tick() RETURNS jsonb LANGUAGE sql AS $$ SELECT public.reconcile_image_stages(100) $$;

-- the photos
SELECT pg_temp.mk(701, age => interval '3 days');                                                  -- filed, first-read, three days old: due
SELECT pg_temp.mk(1000 + k, age => interval '2 days 12 hours' - make_interval(secs => k), ext => true)
  FROM generate_series(0, 200) k;                                                                  -- 201 filed, custody external, newer
SELECT pg_temp.mk(702, age => interval '4 days', meta => pg_temp.reading(702));                     -- holds a reading, external below
SELECT pg_temp.parent(702);
SELECT pg_temp.ok(pg_temp.has_gap(701, 'deep_reading') AND pg_temp.has_gap(702, 'keyed_values'), 'precondition: 701 and 702 are reading gaps');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM image_stage_gaps(ARRAY(SELECT pg_temp.img(1000 + k) FROM generate_series(0, 200) k))
                               WHERE stage IN ('deep_reading', 'keyed_values')), 'precondition: the 201 externals are no reading gap');

-- ===== before the change: the defects
SELECT pg_temp.tick();
SELECT pg_temp.ok(pg_temp.open_items(701, 'deep_reading') = 0, 'before: 201 filed externals crowd the three-day-old due photo out of the live scan');
-- a reconciler-style skip on a photo that already holds a reading, then custody ruled the owner's preview: it never reopens
SELECT pg_temp.custody(702, 'user_upload', NULL);
SELECT record_image_stage_receipt(pg_temp.img(702), 'keyed_values', 1, 'policy_skip', 'stage_eligibility', NULL, NULL, NULL,
  '{"skipped": "external", "by": "reconcile_image_stages"}');
SELECT pg_temp.custody(702, 'iphoto', 'photos_cached_preview_v1');
SELECT pg_temp.ok(NOT pg_temp.has_gap(702, 'keyed_values'), 'before: a skipped photo holding a reading is not keyed when it becomes eligible');
SELECT pg_temp.clear_work();

\ir ../migrations/20261125070000_image_stage_scan_eligibility_cap.sql

SELECT pg_temp.ok(pg_temp.md5_of('public.reconcile_image_stages(integer)') = '070d74c6fccb695623f57317ced7900d'
  AND pg_temp.md5_of('public.claim_image_stage_work(text,integer,integer,uuid)') = '9413d19eb78423b1969934f9a930244d'
  AND pg_temp.md5_of('public.image_stage_gaps(uuid[])') = '5ee011592525127e50e4defbbdb77bd1'
  AND pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = '9451a1281ddaa876dc0ba980aeeaba6d', 'the four bodies are the migration''s');
SELECT pg_temp.ok((SELECT live_daily_cap FROM image_pipeline_stages WHERE stage = 'deep_reading') = 150
  AND (SELECT count(*) FROM image_pipeline_stages WHERE live_daily_cap IS NOT NULL) = 1
  AND (SELECT backfill_daily_cap FROM image_pipeline_stages WHERE stage = 'deep_reading') = 0,
  'cap: deep_reading 150 beside its backfill cap, every other stage uncapped');
SELECT pg_temp.ok((SELECT (config_value ->> 'eligibility_skips_per_tick')::int = 50 AND (config_value ->> 'scan_per_lane')::int = 200
                     FROM platform_config WHERE config_key = 'image_stage_reconciler'), 'setting: eligibility_skips_per_tick 50, the rest unchanged');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.image_stage_live_cap_left(text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_live_cap_left(text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.image_stage_live_claimed_today(text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_next_day_start()', 'execute')
  AND has_function_privilege('service_role', 'public.claim_image_stage_work(text,integer,integer,uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.claim_image_stage_work(text,integer,integer,uuid)', 'execute'),
  'grants: the helpers and the claim are service-role only');

-- ===== 1. the due scan reaches the due photo past 201 ineligible ones
SELECT pg_temp.ok(pg_temp.has_gap(702, 'keyed_values'), 'reopen: the photo that held a reading is a keyed values gap once eligible');
SELECT pg_temp.tick() AS t1 \gset
SELECT pg_temp.ok(pg_temp.lane_of(701, 'deep_reading') = 'live', 'scan: the three-day-old due photo is queued live past 201 filed externals');
SELECT pg_temp.ok(pg_temp.lane_of(702, 'keyed_values') = 'live', 'scan: the reopened photo is queued for keyed values despite its eligibility skip');
SELECT pg_temp.ok((:'t1')::jsonb -> 'live' ->> 'skipped_ineligible' = '50' AND pg_temp.skip_total() = 50 + 1,
  'skip: the first tick closes 50 (eligibility_skips_per_tick), visibly');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_receipts WHERE error_class = 'stage_eligibility' AND detail ->> 'skipped' = 'external'
                     AND detail ->> 'by' = 'reconcile_image_stages' AND detail ->> 'rule' = 'image_stage_photo_block' AND outcome = 'policy_skip'
                     AND stage = 'keyed_values' AND producer = 'ingest-observation-batch') = 50, 'skip: keyed_values policy_skip, reason external, named rule');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE image_id IN (SELECT pg_temp.img(1000 + k) FROM generate_series(0, 200) k)) = 0,
  'skip: an ineligible photo is never queued');
\timing on
SELECT pg_temp.tick();
\timing off
SELECT pg_temp.tick(); SELECT pg_temp.tick(); SELECT pg_temp.tick();
SELECT pg_temp.ok(pg_temp.skip_total() = 201 + 1, 'skip: five ticks close all 201');
SELECT pg_temp.tick() AS t6 \gset
SELECT pg_temp.ok((:'t6')::jsonb -> 'live' ->> 'skipped_ineligible' = '0' AND pg_temp.skip_total() = 202, 'skip: once; the sixth tick writes nothing');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND status IN ('queued', 'claimed')) = 1,
  'skip: no tick queued the due photo twice');

-- ===== 2. every reason the reading stages refuse, named; waiting photos are not refused
SELECT pg_temp.mk(711, age => interval '1 day', dup => true);
SELECT pg_temp.mk(712, age => interval '1 day'); UPDATE vehicle_images SET image_url = NULL WHERE id = pg_temp.img(712);
SELECT pg_temp.mk(713, age => interval '1 day', sens => true);
SELECT pg_temp.mk(714, age => interval '1 day'); UPDATE vehicle_images SET is_superseded = true WHERE id = pg_temp.img(714);
SELECT pg_temp.mk(715, age => interval '1 day', doc => true);
SELECT pg_temp.mk(716, age => interval '1 day', match => 'mismatch');
SELECT pg_temp.mk(717, age => interval '1 day', veh => pg_temp.vx());
SELECT pg_temp.mk(718, age => interval '1 day', status => 'pending');
SELECT pg_temp.mk(719, age => interval '1 day', unfiled => true);
SELECT pg_temp.mk(720, age => interval '1 day', gate => 'pending');
SELECT pg_temp.tick();
SELECT pg_temp.ok(pg_temp.skips(711) = 'duplicate' AND pg_temp.skips(712) = 'no_pixels' AND pg_temp.skips(713) = 'sensitive'
  AND pg_temp.skips(714) = 'superseded' AND pg_temp.skips(715) = 'document' AND pg_temp.skips(716) = 'match_status'
  AND pg_temp.skips(717) = 'out_of_scope', 'reasons: duplicate, no_pixels, sensitive, superseded, document, match_status, out_of_scope');
SELECT pg_temp.ok((SELECT detail ->> 'rule' FROM image_stage_receipts WHERE image_id = pg_temp.img(717) AND error_class = 'stage_eligibility') = 'image_stage_scope_ok',
  'reasons: a vehicle out of the reading scope names the scope rule');
SELECT pg_temp.ok(pg_temp.skips(718) IS NULL AND pg_temp.skips(719) IS NULL AND pg_temp.skips(720) IS NULL,
  'reasons: no first read yet, unfiled and an unapproved gate are not skipped');

-- ===== 3. a later change reopens; a new reason is written once
SELECT pg_temp.custody(1000, 'iphoto', 'photos_cached_preview_v1');   -- custody ruled: the owner's own cached preview
SELECT pg_temp.ok(pg_temp.has_gap(1000, 'deep_reading'), 'reopen: a skipped photo ruled the owner''s is a deep reading gap');
SELECT pg_temp.tick();
SELECT pg_temp.ok(pg_temp.lane_of(1000, 'deep_reading') = 'live', 'reopen: the due scan queues it live, its skip receipt notwithstanding');
UPDATE vehicle_images SET is_external = false WHERE id = pg_temp.img(717);   -- (no effect: scope is the block)
UPDATE platform_config SET config_value = config_value - 'exclude_vehicle_ids' WHERE config_key = 'image_stage_deep_reading';
SELECT pg_temp.ok(pg_temp.has_gap(717, 'deep_reading'), 'reopen: a scope widened makes an out_of_scope photo a gap');
UPDATE platform_config SET config_value = config_value || jsonb_build_object('exclude_vehicle_ids', jsonb_build_array(pg_temp.vx()))
 WHERE config_key = 'image_stage_deep_reading';
UPDATE vehicle_images SET is_duplicate = true WHERE id = pg_temp.img(1001);
SELECT pg_temp.tick(); SELECT pg_temp.tick();
SELECT pg_temp.ok(pg_temp.skips(1001) = 'external,duplicate', 'once per reason: a new block adds one receipt, a second tick none');

-- the flow watch does not read eligibility skips as the stage moving
SELECT assay_photo_reading_flow(false) AS a0 \gset
SELECT pg_temp.ok((:'a0')::jsonb ->> 'method' = 'assay_photo_reading_flow v4'
  AND ((:'a0')::jsonb #>> '{stage_queue,stages,keyed_values,skipped_ineligible_6h}')::int = 210
  AND ((:'a0')::jsonb #>> '{stage_queue,stages,keyed_values,succeeded_or_closed_6h}')::int = 0,
  'assay: 210 eligibility skips shown apart, none counted as closing');
SELECT pg_temp.clear_work();

-- ===== 4. the live daily cap, at the claim
UPDATE image_pipeline_stages SET live_daily_cap = 3 WHERE stage = 'deep_reading';
SELECT pg_temp.mk(730 + k, age => interval '1 day' - make_interval(mins => k)) FROM generate_series(1, 5) k;
SELECT pg_temp.tick();
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND lane = 'live' AND status = 'queued') = 5,
  'cap: five due photos fill the room, live');
BEGIN;
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('deep_reading', 8, 300, pg_temp.u1())) = 3, 'cap: a claim of 8 hands out 3');
SELECT pg_temp.ok((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()) >= 1, 'cap: the claim holds the stage''s advisory lock');
COMMIT;
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE status = 'claimed' AND claimed_at IS NOT NULL) = 3
  AND image_stage_live_claimed_today('deep_reading') = 3 AND image_stage_live_cap_left('deep_reading') = 0, 'cap: claimed_at stamped, 3 used, 0 left');
-- (the room takes the oldest gaps first, so one of the five newest is still unqueued: it becomes a backfill item)
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, not_before)
SELECT pg_temp.img(n), 'deep_reading', 1, 'missing', 'backfill', now() FROM generate_series(731, 735) n
 WHERE pg_temp.open_items(n, 'deep_reading') = 0 AND pg_temp.has_gap(n, 'deep_reading') ORDER BY n LIMIT 1;
SELECT pg_temp.ok((SELECT string_agg(c.lane, ',') FROM claim_image_stage_work('deep_reading', 8, 300, pg_temp.u1()) c) = 'backfill',
  'cap: with the live cap used, the claim still hands out the backfill item, and no live one');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND lane = 'live' AND status = 'queued'
                     AND not_before = image_stage_next_day_start() AND not_before > now()) = 2
  AND NOT EXISTS (SELECT 1 FROM image_stage_work WHERE status = 'dropped'),
  'cap: the two over the cap carry to the next midnight PT, queued, none dropped');
SELECT pg_temp.ok(image_stage_next_day_start() = (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') + interval '1 day') AT TIME ZONE 'America/Los_Angeles'
  AND image_stage_next_day_start() > now() AND image_stage_next_day_start() <= now() + interval '25 hours', 'cap: the day boundary is midnight PT');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('deep_reading', 8, 300, pg_temp.u1())) = 0, 'cap: a further claim hands out nothing');
-- the flow watch names the cap, not a stall, even with the queue old
UPDATE image_stage_work SET created_at = now() - interval '8 hours' WHERE stage = 'deep_reading';
DELETE FROM image_stage_receipts WHERE stage = 'deep_reading';
SELECT assay_photo_reading_flow(false) AS a1 \gset
SELECT pg_temp.ok(((:'a1')::jsonb #>> '{stage_queue,stages,deep_reading,live_daily_cap}')::int = 3
  AND ((:'a1')::jsonb #>> '{stage_queue,stages,deep_reading,live_claimed_today}')::int = 3
  AND ((:'a1')::jsonb #>> '{stage_queue,stages,deep_reading,live_carried_to_next_day}')::int = 2
  AND ((:'a1')::jsonb #>> '{stage_queue,stages,deep_reading,due_now}')::int = 0
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text((:'a1')::jsonb -> 'reasons') r WHERE r LIKE 'deep_reading_live_cap_reached: 3 of 3 live claims used today (America/Los_Angeles), 2 photos carried to % PT')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text((:'a1')::jsonb -> 'reasons') r WHERE r LIKE 'deep_reading_stalled%'),
  'assay: the cap reached and 2 carried, named; not a stall');
SELECT pg_temp.raises($$SELECT assay_photo_reading_flow()$$, 'assay: the raising form raises, so v_job_health shows the cap');
-- the reconciler does not read the carried items as ready, and queues nothing past the room
SELECT pg_temp.tick();
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND status = 'queued') = 2, 'cap: no tick adds to a held room');
-- the next day: yesterday's claims no longer count and the carried items are due
UPDATE image_stage_work SET claimed_at = claimed_at - interval '1 day' WHERE claimed_at IS NOT NULL;
UPDATE image_stage_work SET not_before = now() WHERE not_before > now();
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('deep_reading', 8, 300, pg_temp.u1()) c WHERE c.lane = 'live') = 2,
  'cap: the next day the carried two are claimed');
SELECT pg_temp.ok(image_stage_live_claimed_today('deep_reading') = 2 AND image_stage_live_cap_left('deep_reading') = 1, 'cap: the next day counts from zero: 2 used, 1 left');
-- an uncapped stage takes no lock and is claimed as before
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, not_before) VALUES (pg_temp.img(702), 'keyed_values', 1, 'outdated', 'live', now())
  ON CONFLICT (image_id, stage) WHERE status IN ('queued', 'claimed') DO NOTHING;
BEGIN;
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('keyed_values', 8, 300, pg_temp.u1())) = 1, 'uncapped: keyed values is claimed');
SELECT pg_temp.ok((SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()) = 0, 'uncapped: no advisory lock');
COMMIT;
UPDATE image_pipeline_stages SET live_daily_cap = NULL WHERE stage = 'deep_reading';
SELECT pg_temp.ok(image_stage_live_cap_left('deep_reading') IS NULL, 'uncapped: a null cap leaves nothing to count');
SELECT pg_temp.clear_work();

-- ===== 5. replay passes its own guard; the revert restores production's bodies
\ir ../migrations/20261125070000_image_stage_scan_eligibility_cap.sql
SELECT pg_temp.ok((SELECT count(*) FROM pg_constraint WHERE conname = 'image_pipeline_stages_live_daily_cap_check') = 1
  AND (SELECT live_daily_cap FROM image_pipeline_stages WHERE stage = 'deep_reading') = 150, 'replay: one constraint, the cap set again where it was null');
\ir revert_20261125070000_image_stage_scan_eligibility_cap.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.reconcile_image_stages(integer)') = '3b467cd151aa073bab955c604deffcd8'
  AND pg_temp.md5_of('public.claim_image_stage_work(text,integer,integer,uuid)') = '1bff5de34a128ea6092e13fcaceb2dfd'
  AND pg_temp.md5_of('public.image_stage_gaps(uuid[])') = 'a3f55af9690bdfdb56795c3838eeead0'
  AND pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = 'e4a01af0fa8f3a93d002d86e431101ae'
  AND to_regprocedure('public.image_stage_live_cap_left(text)') IS NULL AND to_regprocedure('public.image_stage_next_day_start()') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE (table_name, column_name) IN (('image_pipeline_stages', 'live_daily_cap'), ('image_stage_work', 'claimed_at')))
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'image_stage_reconciler' AND config_value ? 'eligibility_skips_per_tick'),
  'revert: the four bodies production held, no helper, no column, no setting');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('classifier', 8, 300, pg_temp.u1())) >= 0, 'revert: the claim runs');
\echo 'image stage scan eligibility and live cap contract passed'

-- Contract for 20261126091500_image_stage_one_daily_cap.sql, on a fresh disposable database:
--   (1) one cap per stage covers both lanes: the day's claims in all never pass daily_cap, two concurrent sessions included,
--       and every hand-out counts (a claim again after a lease ran out adds one);
--   (2) the lane split holds: the backfill never takes the live lane's unused reserve, the live lane may take every slot left,
--       and the backfill enqueue queues nothing it could not claim today, so a photo landed after the backfill's share is used
--       is still queued and claimed the same day;
--   (3) overflow carries to the next midnight PT, queued, never dropped;
--   (4) a deep reading receipt that answers no claimed work item is refused; a lease that ran out, a retry after a lost
--       answer and an uncapped stage are not; the receipt says which lane paid;
--   (5) the old columns stay readable and cannot be written; the flow watch still runs; replay is idempotent; the revert
--       restores production's bodies.
-- The predecessors' contracts build the fixture and prove 20261120130000 .. 20261125070000 (the last ends reverted, so it is
-- applied again).
\set ON_ERROR_STOP on
\ir test_image_stage_scan_eligibility_cap.sql
\ir ../migrations/20261125070000_image_stage_scan_eligibility_cap.sql

-- production's numbers on 2026-11-26
UPDATE image_pipeline_stages SET backfill_daily_cap = 150, live_daily_cap = 150 WHERE stage = 'deep_reading';
UPDATE platform_config SET config_value = config_value || jsonb_build_object('max_open', 5) WHERE config_key = 'image_stage_deep_reading';
DELETE FROM image_stage_work; DELETE FROM image_stage_receipts; DELETE FROM vehicle_images;
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL;

-- photos 801..830: filed, approved, first-read, a day old: each a deep_reading gap
SELECT pg_temp.mk(800 + k, age => interval '1 day' - make_interval(mins => k)) FROM generate_series(1, 30) k;
SELECT pg_temp.clear_work();
CREATE FUNCTION pg_temp.q(n int, ln text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
     VALUES (pg_temp.img(n), 'deep_reading', 1, 'missing', ln, now()) $$;
CREATE FUNCTION pg_temp.claim(n int DEFAULT 8) RETURNS TABLE(lane text, image_id uuid) LANGUAGE sql AS
  $$ SELECT c.lane, c.image_id FROM public.claim_image_stage_work('deep_reading', n, 300, pg_temp.u1()) c $$;
CREATE FUNCTION pg_temp.claimed(ln text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.image_stage_work WHERE stage = 'deep_reading' AND status = 'claimed' AND (ln IS NULL OR lane = ln) $$;
CREATE FUNCTION pg_temp.carried(ln text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.image_stage_work WHERE stage = 'deep_reading' AND status = 'queued' AND not_before = public.image_stage_next_day_start()
       AND not_before > now() AND (ln IS NULL OR lane = ln) $$;
-- the next day, as the clock would make it: yesterday's claims stop counting, carried items fall due
CREATE FUNCTION pg_temp.next_day() RETURNS void LANGUAGE sql AS $$
  UPDATE public.image_stage_work SET claimed_at = claimed_at - interval '1 day' WHERE claimed_at IS NOT NULL;
  UPDATE public.image_stage_work SET not_before = now() WHERE not_before > now() $$;
-- a lease that ran out, handed back the way production does it
CREATE FUNCTION pg_temp.lapse(n int) RETURNS int LANGUAGE sql AS $$
  UPDATE public.image_stage_work SET lease_until = now() - interval '1 second' WHERE image_id = pg_temp.img(n) AND status = 'claimed';
  SELECT public.release_expired_image_stage_work() $$;
CREATE FUNCTION pg_temp.receipt(n int, st text DEFAULT 'deep_reading') RETURNS bigint LANGUAGE sql AS
  $$ SELECT public.record_image_stage_receipt(pg_temp.img(n), st, 1, 'succeeded', NULL, NULL, NULL, NULL, '{"reader": "test"}') $$;

-- ===== before the change: the defects
UPDATE image_pipeline_stages SET live_daily_cap = 2 WHERE stage = 'deep_reading';
SELECT pg_temp.q(801, 'live'); SELECT pg_temp.q(802, 'live'); SELECT pg_temp.q(803, 'backfill'); SELECT pg_temp.q(804, 'backfill');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 4, 'before: a live cap of 2 hands out 4 in a day (2 live + 2 backfill): the backfill is not counted at the claim');
SELECT pg_temp.clear_work();
SELECT pg_temp.q(805, 'live');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'before: claimed once');
SELECT pg_temp.ok(pg_temp.lapse(805) = 1, 'before: its lease ran out and it was handed back');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'before: claimed again');
SELECT pg_temp.ok(image_stage_live_claimed_today('deep_reading') = 1, 'before: two hand-outs count as one');
SELECT pg_temp.ok(pg_temp.receipt(830) > 0, 'before: a deep reading receipt for a photo nobody claimed is written');
SELECT pg_temp.clear_work(); DELETE FROM image_stage_receipts;
UPDATE image_pipeline_stages SET live_daily_cap = 150 WHERE stage = 'deep_reading';

\ir ../migrations/20261126091500_image_stage_one_daily_cap.sql

SELECT pg_temp.ok(pg_temp.md5_of('public.claim_image_stage_work(text,integer,integer,uuid)') = '7c8f56b6722a6e456aa77037f3afd01a'
  AND pg_temp.md5_of('public.image_stage_live_cap_left(text)') = '5fd7f72da5c21f441644e7a12040eefc'
  AND pg_temp.md5_of('public.image_stage_live_claimed_today(text)') = '6056e6af3734eb3067721e9cf09f75a1'
  AND pg_temp.md5_of('public.image_stage_backfill_cap_left(text)') = '25993cd30333bbc2803a8947d2bd5cec'
  AND pg_temp.md5_of('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)') = '0327e91f8595817c927e09f9b70c4900'
  AND pg_temp.md5_of('public.image_stage_day_start()') = 'e64e4a66792aa124a7b01621cd092fa5'
  AND pg_temp.md5_of('public.image_stage_claimed_today(text,text)') = '6b45bb4f69eb743551deeac536e8cdb2'
  AND pg_temp.md5_of('public.image_stage_cap_left(text,text)') = 'c5b52aace401ceeb6a7f5882bf221611'
  AND pg_temp.md5_of('public.assay_photo_reading_flow(boolean)') = '9451a1281ddaa876dc0ba980aeeaba6d'
  AND pg_temp.md5_of('public.reconcile_image_stages(integer)') = '070d74c6fccb695623f57317ced7900d', 'bodies: the eight are the migration''s; the flow watch and the reconciler are untouched');
SELECT pg_temp.ok((SELECT daily_cap = 150 AND live_min_reserved = 30 AND live_daily_cap = 150 AND backfill_daily_cap = 120
                     FROM image_pipeline_stages WHERE stage = 'deep_reading')
  AND (SELECT count(*) FROM image_pipeline_stages WHERE daily_cap IS NOT NULL OR live_daily_cap IS NOT NULL OR backfill_daily_cap IS NOT NULL OR live_min_reserved <> 0) = 1,
  'cap: deep_reading 150 a day in all, 30 kept for the live lane; the old names read 150 and 120; every other stage uncapped');
SELECT pg_temp.raises($$UPDATE image_pipeline_stages SET live_daily_cap = 300 WHERE stage = 'deep_reading'$$, 'old names: live_daily_cap cannot be written');
SELECT pg_temp.raises($$UPDATE image_pipeline_stages SET backfill_daily_cap = 150 WHERE stage = 'deep_reading'$$, 'old names: backfill_daily_cap cannot be written');
SELECT pg_temp.raises($$UPDATE image_pipeline_stages SET live_min_reserved = 151 WHERE stage = 'deep_reading'$$, 'split: the reserve cannot exceed the cap');
SELECT pg_temp.raises($$UPDATE image_pipeline_stages SET daily_cap = -1 WHERE stage = 'deep_reading'$$, 'cap: not negative');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.image_stage_cap_left(text,text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_cap_left(text,text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.image_stage_claimed_today(text,text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.image_stage_day_start()', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.claim_image_stage_work(text,integer,integer,uuid)', 'execute')
  AND NOT has_function_privilege('anon', 'public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)', 'execute'),
  'grants: the helpers, the claim and the receipt writer are service-role only');

-- ===== 1. one cap across both lanes
UPDATE image_pipeline_stages SET daily_cap = 4, live_min_reserved = 1 WHERE stage = 'deep_reading';
SELECT pg_temp.ok((SELECT live_daily_cap = 4 AND backfill_daily_cap = 3 FROM image_pipeline_stages WHERE stage = 'deep_reading'), 'old names follow the one cap');
SELECT pg_temp.q(800 + k, CASE WHEN k <= 4 THEN 'live' ELSE 'backfill' END) FROM generate_series(1, 8) k;
SELECT pg_temp.ok((SELECT string_agg(lane, ',' ORDER BY lane) FROM pg_temp.claim(8)) = 'backfill,backfill,live,live',
  'total: a claim of 8 hands out 4 (the cap), interleaved, two from each lane');
SELECT pg_temp.ok(image_stage_claimed_today('deep_reading') = 4 AND image_stage_cap_left('deep_reading', 'live') = 0
  AND image_stage_cap_left('deep_reading', 'backfill') = 0, 'total: 4 used, nothing left in either lane');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 0, 'total: a further claim hands out nothing');
SELECT pg_temp.ok(pg_temp.carried('live') = 2 AND pg_temp.carried('backfill') = 2
  AND NOT EXISTS (SELECT 1 FROM image_stage_work WHERE status = 'dropped'),
  'overflow: both lanes'' four carry to the next midnight PT, queued, none dropped');
SELECT pg_temp.ok(image_stage_next_day_start() = (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') + interval '1 day') AT TIME ZONE 'America/Los_Angeles',
  'overflow: the boundary is midnight PT');
-- the next day the carried four are due, and the count starts again
SELECT pg_temp.next_day();
SELECT pg_temp.ok(image_stage_claimed_today('deep_reading') = 0, 'next day: yesterday''s claims no longer count');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 4, 'next day: the carried four are claimed');
SELECT pg_temp.clear_work();

-- every hand-out counts: a claim again after a lease ran out adds one
SELECT pg_temp.next_day();
SELECT pg_temp.q(809, 'live');
-- (one step a statement: a scalar subquery runs before the rest of its statement)
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'reclaim: claimed');
SELECT pg_temp.ok(pg_temp.lapse(809) = 1, 'reclaim: its lease ran out');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'reclaim: claimed again');
SELECT pg_temp.ok(image_stage_claimed_today('deep_reading') = 2 AND (SELECT day_claims FROM image_stage_work WHERE image_id = pg_temp.img(809)) = 2,
  'reclaim: two hand-outs count as two');
-- a row claimed yesterday and again today counts once today
UPDATE image_stage_work SET claimed_at = claimed_at - interval '1 day' WHERE image_id = pg_temp.img(809);
SELECT pg_temp.ok(pg_temp.lapse(809) = 1, 'reclaim: handed back again');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'reclaim: claimed on the new day');
SELECT pg_temp.ok((SELECT day_claims FROM image_stage_work WHERE image_id = pg_temp.img(809)) = 1 AND image_stage_claimed_today('deep_reading') = 1,
  'reclaim: a claim on a new day starts the row''s count at 1');
SELECT pg_temp.clear_work();

-- ===== 2. the lane split
-- the backfill never takes the live lane's unused reserve
UPDATE image_pipeline_stages SET daily_cap = 4, live_min_reserved = 2 WHERE stage = 'deep_reading';
SELECT pg_temp.q(810 + k, 'backfill') FROM generate_series(1, 6) k;
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8) WHERE lane = 'backfill') = 2, 'split: with only backfill due, the backfill takes 4 - 2 = 2');
SELECT pg_temp.ok(pg_temp.carried('backfill') = 4 AND image_stage_cap_left('deep_reading', 'live') = 2 AND image_stage_cap_left('deep_reading', 'backfill') = 0,
  'split: the backfill''s other four carry to tomorrow; the live lane still has its 2');
SELECT pg_temp.q(821, 'live'); SELECT pg_temp.q(822, 'live'); SELECT pg_temp.q(823, 'live');
SELECT pg_temp.ok((SELECT string_agg(lane, ',') FROM pg_temp.claim(8)) = 'live,live', 'split: the reserve is the live lane''s: 2 live claimed');
SELECT pg_temp.ok(image_stage_claimed_today('deep_reading') = 4 AND pg_temp.carried('live') = 1, 'split: 4 in all; the third live photo carries');
SELECT pg_temp.clear_work();
-- the live lane may take every slot left, and then the backfill gets none
SELECT pg_temp.next_day();
SELECT pg_temp.q(810 + k, 'live') FROM generate_series(1, 6) k;
SELECT pg_temp.q(825, 'backfill');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8) WHERE lane = 'live') = 3 AND pg_temp.claimed('backfill') = 1,
  'split: interleaved, the live lane takes 3 and the backfill its 1 (4 - max(2 - live, 0))');
SELECT pg_temp.clear_work(); SELECT pg_temp.next_day();
SELECT pg_temp.q(810 + k, 'live') FROM generate_series(1, 6) k;
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 4, 'split: with only live due, the live lane takes the whole cap');
SELECT pg_temp.q(826, 'backfill');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 0 AND pg_temp.carried('backfill') = 1, 'split: then the backfill gets none and carries');
SELECT pg_temp.clear_work();

-- the backfill enqueue queues nothing it could not claim today: the room (max_open 5) stays open for the live lane
SELECT pg_temp.next_day();
DELETE FROM vehicle_images WHERE id NOT IN (SELECT pg_temp.img(800 + k) FROM generate_series(1, 30) k);
UPDATE vehicle_images SET created_at = now() - interval '20 days' - make_interval(mins => (right(id::text, 3))::int);   -- past live_due_days: backfill only
UPDATE image_pipeline_stages SET daily_cap = 6, live_min_reserved = 3 WHERE stage = 'deep_reading';
UPDATE image_stage_reconciler_state SET cursor_created_at = NULL, cursor_id = NULL;
SELECT pg_temp.ok(image_stage_backfill_cap_left('deep_reading') = 3, 'pace: the backfill may queue 6 - 3 = 3 today');
SELECT pg_temp.tick();
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND lane = 'backfill' AND status = 'queued') = 3
  AND image_stage_backfill_cap_left('deep_reading') = 0, 'pace: one tick queues the backfill''s 3, and its pace is then 0');
SELECT pg_temp.tick();
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND lane = 'backfill') = 3, 'pace: a second tick queues no more');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 3, 'pace: the backfill''s share is claimed');
SELECT pg_temp.tick();
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_work WHERE stage = 'deep_reading' AND lane = 'backfill' AND status = 'queued') = 0,
  'pace: with its share used, the backfill queues nothing');
SELECT pg_temp.mk(850, age => interval '1 hour');   -- a photo landed today
SELECT pg_temp.tick();
SELECT pg_temp.ok(pg_temp.lane_of(850, 'deep_reading') = 'live', 'end to end: the new photo is queued live; the room is not held by unclaimable backfill');
SELECT pg_temp.ok((SELECT string_agg(lane || ':' || (image_id = pg_temp.img(850))::text, ',') FROM pg_temp.claim(8)) = 'live:true',
  'end to end: and claimed the same day from the live reserve');
SELECT pg_temp.ok(image_stage_claimed_today('deep_reading') = 4, 'end to end: 4 of 6 used');
SELECT pg_temp.clear_work();

-- ===== 3. two sessions at once (the Mac and the workflow) cannot pass the cap
SELECT pg_temp.next_day();
UPDATE image_pipeline_stages SET daily_cap = 3, live_min_reserved = 0 WHERE stage = 'deep_reading';
SELECT pg_temp.q(800 + k, 'live') FROM generate_series(1, 8) k;
SELECT pg_temp.u1() AS u1 \gset
CREATE EXTENSION IF NOT EXISTS dblink;
SELECT dblink_connect('cap_a', format('dbname=%s host=%s port=%s user=%s', current_database(), split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_user));
SELECT dblink_connect('cap_b', format('dbname=%s host=%s port=%s user=%s', current_database(), split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_user));
-- A claims and holds its transaction open; B's claim waits on the stage's lock and, once A commits, sees A's claims
SELECT dblink_exec('cap_a', 'BEGIN');
SELECT n AS a_got FROM dblink('cap_a', format($q$SELECT count(*) FROM public.claim_image_stage_work('deep_reading', 8, 300, %L)$q$, :'u1')) AS t(n bigint) \gset
SELECT dblink_send_query('cap_b', format($q$SELECT count(*) FROM public.claim_image_stage_work('deep_reading', 8, 300, %L)$q$, :'u1'));
SELECT pg_sleep(0.5);
SELECT pg_temp.ok(dblink_is_busy('cap_b') = 1, 'two hosts: the second claim waits on the stage''s lock');
SELECT dblink_exec('cap_a', 'COMMIT');
SELECT n AS b_got FROM dblink_get_result('cap_b') AS t(n bigint) \gset
SELECT pg_temp.ok(:a_got = 3 AND :b_got = 0 AND image_stage_claimed_today('deep_reading') = 3, 'two hosts: 3 + 0, the cap held');
SELECT dblink_disconnect('cap_a'), dblink_disconnect('cap_b');
-- both at once, neither holding: still at most the cap
SELECT pg_temp.clear_work(); SELECT pg_temp.next_day();
SELECT dblink_connect('cap_a', format('dbname=%s host=%s port=%s user=%s', current_database(), split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_user));
SELECT dblink_connect('cap_b', format('dbname=%s host=%s port=%s user=%s', current_database(), split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port'), current_user));
SELECT pg_temp.q(800 + k, 'live') FROM generate_series(1, 8) k;
SELECT dblink_send_query('cap_a', format($q$SELECT count(*), pg_sleep(0.2) FROM public.claim_image_stage_work('deep_reading', 8, 300, %L)$q$, :'u1'));
SELECT dblink_send_query('cap_b', format($q$SELECT count(*), pg_sleep(0.2) FROM public.claim_image_stage_work('deep_reading', 8, 300, %L)$q$, :'u1'));
SELECT n AS a2 FROM dblink_get_result('cap_a') AS t(n bigint, s text) \gset
SELECT n AS b2 FROM dblink_get_result('cap_b') AS t(n bigint, s text) \gset
SELECT pg_temp.ok(:a2 + :b2 = 3 AND image_stage_claimed_today('deep_reading') = 3 AND pg_temp.claimed() = 3, 'two hosts at once: 3 in all');
SELECT dblink_disconnect('cap_a'), dblink_disconnect('cap_b');
SELECT pg_temp.clear_work();

-- ===== 4. the receipt writer
SELECT pg_temp.next_day();
UPDATE image_pipeline_stages SET daily_cap = 150, live_min_reserved = 30 WHERE stage = 'deep_reading';
DELETE FROM image_stage_receipts;
SELECT pg_temp.raises($$SELECT pg_temp.receipt(801)$$, 'receipt: a deep reading of a photo with no work item is refused');
SELECT pg_temp.q(801, 'live');
SELECT pg_temp.raises($$SELECT pg_temp.receipt(801)$$, 'receipt: a queued item nobody claimed is refused');
SELECT pg_temp.ok(pg_temp.open_items(801, 'deep_reading') = 1 AND NOT EXISTS (SELECT 1 FROM image_stage_receipts), 'receipt: a refusal writes nothing and leaves the item open');
DO $$ BEGIN PERFORM pg_temp.receipt(801); EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE 'stage_receipt_unclaimed:%' THEN RAISE; END IF; END $$;
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'receipt: claimed');
SELECT pg_temp.ok(pg_temp.receipt(801) > 0, 'receipt: a claimed item''s receipt is written');
SELECT pg_temp.ok((SELECT detail #>> '{claim,lane}' = 'live' AND detail #>> '{claim,status}' = 'claimed' AND detail ->> 'reader' = 'test'
                          AND (detail #>> '{claim,work_id}')::bigint = (SELECT id FROM image_stage_work WHERE image_id = pg_temp.img(801))
                     FROM image_stage_receipts WHERE image_id = pg_temp.img(801)) AND pg_temp.open_items(801, 'deep_reading') = 0,
  'receipt: it says which lane paid (detail.claim), keeps the caller''s detail and closes the item');
SELECT pg_temp.ok(pg_temp.receipt(801) > 0, 'receipt: the retry is written');
SELECT pg_temp.ok((SELECT count(*) FROM image_stage_receipts WHERE image_id = pg_temp.img(801)) = 2,
  'receipt: a retry after a lost answer (the item just finished) is written');
UPDATE image_stage_work SET finished_at = now() - interval '16 minutes' WHERE image_id = pg_temp.img(801);
SELECT pg_temp.raises($$SELECT pg_temp.receipt(801)$$, 'receipt: an item finished 16 minutes ago answers no new receipt');
SELECT pg_temp.q(802, 'backfill');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'receipt: claimed');
SELECT pg_temp.ok(pg_temp.lapse(802) = 1, 'receipt: then its lease ran out');
SELECT pg_temp.ok(pg_temp.receipt(802) > 0, 'receipt: the lapsed item''s receipt is written');
SELECT pg_temp.ok((SELECT detail #>> '{claim,lane}' = 'backfill' AND detail #>> '{claim,status}' = 'queued'
                                                   FROM image_stage_receipts WHERE image_id = pg_temp.img(802)),
  'receipt: a reading whose lease ran out is still written, and says so');
-- handed back on an earlier day: that hand-out is not counted today
SELECT pg_temp.q(829, 'backfill');
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'receipt: claimed (829)');
SELECT pg_temp.ok(pg_temp.lapse(829) = 1, 'receipt: 829 handed back');
UPDATE image_stage_work SET claimed_at = claimed_at - interval '1 day' WHERE image_id = pg_temp.img(829);
SELECT pg_temp.raises($$SELECT pg_temp.receipt(829)$$, 'receipt: an item handed back yesterday answers no receipt today');
-- carried to tomorrow by the cap: not due, not counted
UPDATE image_stage_work SET claimed_at = now(), not_before = public.image_stage_next_day_start() WHERE image_id = pg_temp.img(829);
SELECT pg_temp.raises($$SELECT pg_temp.receipt(829)$$, 'receipt: an item the cap carried to tomorrow answers no receipt');
-- still claimed across midnight: it was counted when it was handed out
UPDATE image_stage_work SET not_before = now() WHERE image_id = pg_temp.img(829);
SELECT pg_temp.ok((SELECT count(*) FROM pg_temp.claim(8)) = 1, 'receipt: 829 claimed again');
UPDATE image_stage_work SET claimed_at = claimed_at - interval '1 day' WHERE image_id = pg_temp.img(829);
SELECT pg_temp.ok(pg_temp.receipt(829) > 0, 'receipt: an item still under its lease is written though claimed before midnight');
SELECT pg_temp.ok(pg_temp.receipt(803, 'keyed_values') > 0, 'receipt: keyed values written');
SELECT pg_temp.ok((SELECT NOT (detail ? 'claim') FROM image_stage_receipts WHERE image_id = pg_temp.img(803)),
  'receipt: an uncapped stage (keyed_values, the reconciler''s skips) needs no claim and is not stamped');
SELECT pg_temp.clear_work();

-- ===== 5. the flow watch still runs over the old names
SELECT assay_photo_reading_flow(false) AS a1 \gset
SELECT pg_temp.ok(((:'a1')::jsonb #>> '{stage_queue,stages,deep_reading,live_daily_cap}')::int = 150, 'assay: runs and reads the one cap through live_daily_cap');

-- ===== 6. replay passes its own guard and changes nothing; the revert restores production's bodies
UPDATE image_pipeline_stages SET daily_cap = 140 WHERE stage = 'deep_reading';
SELECT pg_temp.q(804, 'live'); SELECT count(*) FROM pg_temp.claim(1);
\ir ../migrations/20261126091500_image_stage_one_daily_cap.sql
SELECT pg_temp.ok((SELECT daily_cap = 140 AND live_min_reserved = 30 AND live_daily_cap = 140 FROM image_pipeline_stages WHERE stage = 'deep_reading')
  AND (SELECT count(*) FROM pg_constraint WHERE conname IN ('image_pipeline_stages_daily_cap_check', 'image_pipeline_stages_live_min_reserved_check')) = 2
  AND (SELECT day_claims FROM image_stage_work WHERE image_id = pg_temp.img(804)) = 1
  AND pg_temp.md5_of('public.claim_image_stage_work(text,integer,integer,uuid)') = '7c8f56b6722a6e456aa77037f3afd01a',
  'replay: idempotent (the cap a person set, the constraints, the day''s counts and the bodies are unchanged)');
SELECT pg_temp.clear_work();
\ir revert_20261126091500_image_stage_one_daily_cap.sql
SELECT pg_temp.ok(pg_temp.md5_of('public.claim_image_stage_work(text,integer,integer,uuid)') = '9413d19eb78423b1969934f9a930244d'
  AND pg_temp.md5_of('public.image_stage_live_cap_left(text)') = 'c2d2ecc234608a31b703ad680d915dc8'
  AND pg_temp.md5_of('public.image_stage_live_claimed_today(text)') = 'c4d524ae98b14934595337d9a66307d8'
  AND pg_temp.md5_of('public.image_stage_backfill_cap_left(text)') = '70cc2ecb0b9608f650f03178c4d3d1d2'
  AND pg_temp.md5_of('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)') = 'c0c1e66fd6a9b41c126c8b3c4807c719'
  AND to_regprocedure('public.image_stage_cap_left(text,text)') IS NULL AND to_regprocedure('public.image_stage_claimed_today(text,text)') IS NULL
  AND to_regprocedure('public.image_stage_day_start()') IS NULL
  AND (SELECT live_daily_cap = 150 AND backfill_daily_cap = 150 FROM image_pipeline_stages WHERE stage = 'deep_reading')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'image_pipeline_stages' AND column_name IN ('live_daily_cap', 'backfill_daily_cap') AND is_generated <> 'NEVER')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE (table_name, column_name) IN (('image_pipeline_stages', 'daily_cap'), ('image_pipeline_stages', 'live_min_reserved'), ('image_stage_work', 'day_claims'))),
  'revert: the five bodies production held, the two plain columns at 150, no new column or helper');
SELECT pg_temp.ok((SELECT count(*) FROM claim_image_stage_work('deep_reading', 8, 300, pg_temp.u1())) >= 0 AND pg_temp.receipt(805, 'keyed_values') > 0,
  'revert: the claim and the receipt writer run');
SELECT pg_temp.ok((SELECT count(*) FROM pg_constraint WHERE conname IN ('image_pipeline_stages_live_daily_cap_check', 'image_pipeline_stages_backfill_daily_cap_check')) = 2,
  'revert: the old columns'' constraints are back');
\echo 'image stage one daily cap contract passed'

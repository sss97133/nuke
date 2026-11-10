-- Contract for 20261113170000_photo_reading_status.sql, on a fresh disposable database (run from the repo root): the
-- signed-in caller gets one object about their own photos and nobody else's; the state is decided on the server
-- (moving, each of the four stalls with its reason, idle, off); the position of the date-order pass follows the
-- backfill lane and is withheld when the backfill does not walk by capture time; sentences with nothing to say are
-- left out; an unknown time zone falls back; anon reaches nothing and signed-in users cannot name a user id; a replay
-- changes nothing; the revert removes both functions.
-- The pass is driven by the real reconciler, claim and receipt writer, and the heartbeat by the real heartbeat writer.
-- 20261113160000 (capture order) is applied when the checkout has it; without it the same contract runs, with the
-- order marker set by hand where the position rules are exercised.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN RAISE EXCEPTION 'needs an empty disposable database'; END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
SET timezone = 'UTC';
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job, sched, cmd) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = j RETURNING true $$;
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);
-- job_assay_readings as 20261014090000 defines it
CREATE TABLE public.job_assay_readings (jobname text PRIMARY KEY, reading jsonb, assayed_at timestamptz, elapsed_ms integer,
  attempted_at timestamptz, attempt_error text, refresh_every interval NOT NULL, fresh_for interval NOT NULL,
  CHECK (refresh_every > interval '0' AND fresh_for > refresh_every), CHECK ((assayed_at IS NULL) = (elapsed_ms IS NULL) AND elapsed_ms >= 0));
-- vehicle_images with the columns the stage ledger reads, and the capture ledger index as 20261111190000 builds it
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, image_url text, created_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean, is_sensitive boolean, is_external boolean, is_superseded boolean, vision_gate_status text,
  ai_processing_status text, ai_processing_started_at timestamptz, ai_scan_metadata jsonb, exif_data jsonb, taken_at timestamptz);
CREATE INDEX idx_vehicle_images_capture_ledger
  ON public.vehicle_images (user_id, (COALESCE(taken_at, created_at)), (exif_data->>'uuid'))
  INCLUDE (id, taken_at, created_at, vehicle_id, vision_gate_status)
  WHERE user_id IS NOT NULL;

CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE FUNCTION pg_temp.eq(got jsonb, want jsonb, msg text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION E'FAILED: %\n   got: %\n  want: %', msg, got, want; END IF; END $$;
CREATE FUNCTION pg_temp.raises(sql text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN EXECUTE sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.img(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- a day as the sentences say it: "Nov 10", with the year when it is not this year
CREATE FUNCTION pg_temp.day(ts timestamptz, tz text DEFAULT 'UTC') RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT to_char(ts AT TIME ZONE tz, 'Mon FMDD') || CASE WHEN to_char(ts AT TIME ZONE tz, 'YYYY') <> to_char(now() AT TIME ZONE tz, 'YYYY') THEN to_char(ts AT TIME ZONE tz, ', YYYY') ELSE '' END $$;
-- the public reader, called as a signed-in user
CREATE FUNCTION pg_temp.st(p_uid uuid, p_tz text DEFAULT 'UTC') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_uid)::text, false);
  RETURN public.photo_reading_status(p_tz);
END $$;
-- the frame reader's heartbeat, through its writer (service role)
CREATE FUNCTION pg_temp.hb(p_reading jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  PERFORM public.record_reader_heartbeat('subscription-frame-classifier', p_reading, 41000);
END $$;
-- a healthy fire; by_type carries what the reader read off pages and must never reach a caller
\set healthy '{"frames": 10, "read": 4, "accepted": 4, "errors": 1, "source": "stage-queue", "error_classes": {"image_http_error": 1}, "by_type": {"words_read_off_a_photographed_page": 3}}'

-- four made-up people: A and B are served by the reconciler, C is not, D has no photos
\set ua '00000000-0000-4000-8000-0000000000aa'
\set ub '00000000-0000-4000-8000-0000000000bb'
\set uc '00000000-0000-4000-8000-0000000000cc'
\set ud '00000000-0000-4000-8000-0000000000dd'

\set has_capture_order `test -f supabase/migrations/20261113160000_image_stage_capture_order.sql && echo true || echo false`
\i supabase/migrations/20261112120000_subscription_reader_heartbeat.sql
\i supabase/migrations/20261113100000_photo_reading_flow_assay.sql
\i supabase/migrations/20261113110000_image_stage_receipts_reconciler.sql
\i supabase/migrations/20261113120000_photo_reading_flow_assay_v2.sql
\i supabase/migrations/20261113130000_image_stage_reconciler_first_pass.sql
\i supabase/migrations/20261113140000_image_stage_reconciler_refill.sql
\if :has_capture_order
\i supabase/migrations/20261113160000_image_stage_capture_order.sql
\endif

-- ===== 0. the migration adds two functions and touches nothing else
SELECT count(*) AS rel_before FROM pg_class WHERE relnamespace = 'public'::regnamespace \gset
SELECT count(*) AS cron_before FROM cron.job \gset
SELECT md5(config_value::text) AS cfg_before FROM platform_config WHERE config_key = 'image_stage_reconciler' \gset
SELECT count(*) AS fn_count_before,
       md5(string_agg(p.oid::text || md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, ''), ',' ORDER BY p.oid)) AS fn_before
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace \gset
\i supabase/migrations/20261113170000_photo_reading_status.sql
SELECT pg_temp.ok((SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace) = :rel_before
  AND (SELECT count(*) FROM cron.job) = :cron_before
  AND (SELECT md5(config_value::text) FROM platform_config WHERE config_key = 'image_stage_reconciler') = :'cfg_before',
  'no table, index, view or cron job is added, and the reconciler''s settings are untouched');
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) = :fn_count_before + 2
  AND (SELECT md5(string_agg(p.oid::text || md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, ''), ',' ORDER BY p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname NOT IN ('photo_reading_status', 'photo_reading_status_for')) = :'fn_before',
  'two functions are added; every other function keeps its body, grants and settings');

-- grants, as recorded and as enforced
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.photo_reading_status(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.photo_reading_status_for(uuid, text)', 'EXECUTE'), 'anon can execute neither reader');
SELECT pg_temp.ok(has_function_privilege('authenticated', 'public.photo_reading_status(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.photo_reading_status_for(uuid, text)', 'EXECUTE'), 'signed-in users can execute the public reader only');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.photo_reading_status_for(uuid, text)', 'EXECUTE'), 'the service role can execute the internal reader');
SELECT pg_temp.ok((SELECT bool_and(p.prosecdef AND p.provolatile = 's' AND p.proconfig::text LIKE '%statement_timeout=5s%' AND p.proconfig::text LIKE '%search_path=%')
                     FROM pg_proc p WHERE p.oid IN ('public.photo_reading_status(text)'::regprocedure, 'public.photo_reading_status_for(uuid, text)'::regprocedure)),
  'both are stable definer functions with their own search_path and a 5 s statement budget');
-- what the body may read of the photo table: one reference, and none of the wide or private columns
SELECT pg_temp.ok((SELECT (length(prosrc) - length(replace(prosrc, 'public.vehicle_images', ''))) / length('public.vehicle_images') FROM pg_proc WHERE oid = 'public.photo_reading_status_for(uuid, text)'::regprocedure) = 1
  AND (SELECT prosrc !~ '\m(ai_scan_metadata|image_url|thumbnail_url|exif_data|input_fingerprint|cursor_id|cursor_created_at|by_type|detail)\M' FROM pg_proc WHERE oid = 'public.photo_reading_status_for(uuid, text)'::regprocedure),
  'the body reads the photo table in one place and names no wide column, receipt detail, fingerprint, cursor or by_type');

-- ===== 1. nobody signed in
SELECT set_config('request.jwt.claims', '', false);
SELECT pg_temp.ok(public.photo_reading_status('UTC') IS NULL, 'signed out: null');
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);
SELECT pg_temp.ok(public.photo_reading_status() IS NULL, 'a token that names no user: null');
SELECT pg_temp.ok(public.photo_reading_status_for(NULL) IS NULL, 'the internal reader answers null for no user');

-- ===== 2. the libraries (synthetic rows in a disposable database)
-- ALLOW_RAW_TESTIMONY_WRITE
-- A: 40 photos taken a month apart from June 2019, uploaded in that order 30 days ago; photo 41 carries no capture time
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
SELECT pg_temp.img(g), :'ua', 'https://example.test/a' || g || '.jpg', now() - interval '30 days' + g * interval '1 second',
       timestamptz '2019-06-15 12:00+00' + (g - 1) * interval '1 month', 'completed'
  FROM generate_series(1, 40) g;
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
VALUES (pg_temp.img(41), :'ua', 'https://example.test/a41.jpg', now() - interval '29 days', NULL, 'completed');
-- B: 10 photos taken a month apart from January 2015, each at 02:00 UTC on the 1st (the evening before in Los Angeles)
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
SELECT pg_temp.img(100 + g), :'ub', 'https://example.test/b' || g || '.jpg', now() - interval '40 days' + g * interval '1 second',
       timestamptz '2015-01-01 02:00+00' + (g - 1) * interval '1 month', 'completed'
  FROM generate_series(1, 10) g;
-- C: 5 photos from March 2010; the reconciler does not serve C
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
SELECT pg_temp.img(200 + g), :'uc', 'https://example.test/c' || g || '.jpg', now() - interval '35 days' + g * interval '1 second',
       timestamptz '2010-03-15 12:00+00' + (g - 1) * interval '1 month', 'completed'
  FROM generate_series(1, 5) g;
-- photos that belong to nobody (listing photos)
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
SELECT pg_temp.img(300 + g), NULL, 'https://example.test/x' || g || '.jpg', now() - interval '50 days', timestamptz '2001-01-01', 'completed'
  FROM generate_series(1, 3) g;
UPDATE platform_config
   SET config_value = config_value || jsonb_build_object('user_ids', jsonb_build_array(:'ua', :'ub'), 'max_open', 20)
 WHERE config_key = 'image_stage_reconciler';

-- ===== 3. the pass, as the real functions run it
-- room for 20: B's ten (the earliest taken and the first uploaded) and A's first ten
SELECT reconcile_image_stages(100) AS r1 \gset
SELECT pg_temp.ok((:'r1')::jsonb ->> 'enqueued' = '20'
  AND (SELECT array_agg(right(image_id::text, 3)::int ORDER BY image_id) FROM image_stage_work) = (SELECT array_agg(g ORDER BY g) FROM (SELECT generate_series(1, 10) g UNION ALL SELECT generate_series(101, 110)) x),
  'the first 20 queued are B''s ten and A''s first ten');
-- A's reader takes A's ten, reads four, cannot open the fifth and stops
CREATE TEMP TABLE claim_a AS SELECT * FROM claim_image_stage_work('classifier', 10, 900, :'ua');
SELECT pg_temp.ok((SELECT count(*) = 10 AND bool_and(user_id = :'ua') FROM claim_a), 'A''s reader claims A''s ten');
SELECT record_image_stage_receipt(pg_temp.img(1), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(2), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(3), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(4), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(5), 'classifier', 1, 'blocked_input', 'image_http_error', 404, NULL, md5('https://example.test/a5.jpg'));
-- B's reader takes B's ten, reads two and runs out of usage on the third
CREATE TEMP TABLE claim_b AS SELECT * FROM claim_image_stage_work('classifier', 10, 900, :'ub');
SELECT pg_temp.ok((SELECT count(*) = 10 AND bool_and(user_id = :'ub') FROM claim_b), 'B''s reader claims B''s ten');
SELECT record_image_stage_receipt(pg_temp.img(101), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(102), 'classifier', 1, 'succeeded');
SELECT record_image_stage_receipt(pg_temp.img(103), 'classifier', 1, 'rate_limited', 'reader_usage_limit', 429, 3600);
-- the leases run out and the twelve unread photos go back to the queue
UPDATE image_stage_work SET lease_until = now() - interval '1 minute' WHERE status = 'claimed';
SELECT pg_temp.ok(release_expired_image_stage_work() = 12, 'twelve unread photos return to the queue');
-- A shoots a photo today: the live lane queues it and it is read before the backlog
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
VALUES (pg_temp.img(900), :'ua', 'https://example.test/a900.jpg', now() - interval '1 hour', now() - interval '70 minutes', 'pending');
SELECT reconcile_image_stages(100) AS r2 \gset
SELECT pg_temp.ok((SELECT lane FROM image_stage_work WHERE image_id = pg_temp.img(900)) = 'live'
  AND (SELECT count(*) FROM image_stage_work w JOIN vehicle_images v ON v.id = w.image_id WHERE v.user_id = :'ua' AND w.status = 'queued') = 13,
  'the new photo is queued by the live lane; 13 of A''s are open (5 returned, 7 more from the backlog, the new one)');
CREATE TEMP TABLE claim_live AS SELECT * FROM claim_image_stage_work('classifier', 1, 900, :'ua');
SELECT pg_temp.ok((SELECT image_id FROM claim_live) = pg_temp.img(900), 'the new photo is handed out first');
SELECT record_image_stage_receipt(pg_temp.img(900), 'classifier', 1, 'succeeded');
-- two workers on photo 1: a later attempt that failed must not turn a read photo back into work
SELECT record_image_stage_receipt(pg_temp.img(1), 'classifier', 1, 'unavailable', 'reader_timeout', NULL, 1800);
SELECT pg_temp.ok((SELECT outcome FROM image_stage_current WHERE image_id = pg_temp.img(1) AND stage = 'classifier') = 'succeeded'
  AND (SELECT count(*) FROM image_stage_receipts WHERE image_id = pg_temp.img(1)) = 2, 'the view keeps photo 1 as read');
SELECT pg_temp.hb(:'healthy');
\if :has_capture_order
SELECT pg_temp.ok((SELECT config_value ->> 'order' FROM platform_config WHERE config_key = 'image_stage_reconciler') = 'capture_time', 'the capture order migration set its marker');
\else
-- This checkout has no 20261113160000, so the backfill above walked by upload time and no marker is set.
SELECT pg_temp.ok(NOT ((SELECT config_value FROM platform_config WHERE config_key = 'image_stage_reconciler') ? 'order'), 'no capture order marker without its migration');
\endif

-- ===== 4. the position of the pass is given only while the backfill walks by capture time
UPDATE platform_config SET config_value = config_value - 'order' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.st(:'ua') AS a0 \gset
SELECT pg_temp.ok((:'a0')::jsonb ->> 'state' = 'moving' AND (:'a0')::jsonb -> 'reading_from' = 'null'::jsonb AND (:'a0')::jsonb -> 'worked_through' = 'null'::jsonb
  AND (:'a0')::jsonb ->> 'summary' = '5 read in the last hour'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text((:'a0')::jsonb -> 'lines') l WHERE l ~ '(Now on|has reached|Worked through)'),
  'without the marker: no position, no progress, the rest as usual');
-- with it (set here by hand when this checkout has no 20261113160000: the rule under test is this reader's)
UPDATE platform_config SET config_value = config_value || '{"order": "capture_time"}' WHERE config_key = 'image_stage_reconciler';

-- ===== 5. moving: A sees A's photos
SELECT pg_temp.st(:'ua') AS a \gset
SELECT pg_temp.eq((SELECT to_jsonb(array_agg(k ORDER BY k)) FROM jsonb_object_keys((:'a')::jsonb) k),
  to_jsonb(ARRAY['as_of', 'could_not_read', 'counting_since', 'headline', 'last_attempt_at', 'last_read_at', 'library_from', 'library_to', 'library_walked_at',
                 'lines', 'photos_total', 'read_1h', 'read_24h', 'read_since_start', 'reader_checked_in_at', 'reading_from', 'reasons', 'retrying',
                 'skipped', 'state', 'summary', 'with_reader', 'worked_through']), 'every key of the contract, and no other');
SELECT pg_temp.eq((:'a')::jsonb - ARRAY['as_of', 'lines', 'counting_since', 'last_read_at', 'last_attempt_at', 'library_to', 'reader_checked_in_at'],
  jsonb_build_object('state', 'moving', 'headline', 'Reading your photos', 'summary', '5 read in the last hour · on photos from September 2019',
    'reasons', '[]'::jsonb, 'photos_total', 42, 'worked_through', 4, 'read_since_start', 5, 'could_not_read', 1, 'skipped', 0, 'retrying', 0,
    'with_reader', 12, 'read_1h', 5, 'read_24h', 5, 'reading_from', timestamptz '2019-09-15 12:00+00', 'library_from', timestamptz '2019-06-15 12:00+00',
    'library_walked_at', NULL), 'A: moving, with A''s own counts');
SELECT pg_temp.ok(((:'a')::jsonb ->> 'as_of')::timestamptz > now() - interval '1 minute'
  AND ((:'a')::jsonb ->> 'counting_since')::timestamptz = (SELECT min(r.observed_at) FROM image_stage_receipts r JOIN vehicle_images v ON v.id = r.image_id WHERE v.user_id = :'ua')
  AND ((:'a')::jsonb ->> 'last_read_at')::timestamptz = (SELECT observed_at FROM image_stage_receipts WHERE image_id = pg_temp.img(900))
  AND ((:'a')::jsonb ->> 'last_attempt_at')::timestamptz = (SELECT max(observed_at) FROM image_stage_receipts WHERE image_id = pg_temp.img(1))
  AND ((:'a')::jsonb ->> 'library_to')::timestamptz = (SELECT taken_at FROM vehicle_images WHERE id = pg_temp.img(900))
  AND ((:'a')::jsonb ->> 'reader_checked_in_at')::timestamptz = (SELECT assayed_at FROM job_assay_readings WHERE jobname = 'subscription-frame-classifier'),
  'A: the clocks are A''s first receipt, last reading, last attempt, latest photo, and the reader''s check-in');
-- the position is photo 4 (the last one the date-order pass read), not the photo shot today that the live lane read
-- after it; "worked through" counts A's photos up to that one
SELECT pg_temp.ok((SELECT observed_at FROM image_stage_receipts WHERE image_id = pg_temp.img(900)) > (SELECT observed_at FROM image_stage_receipts WHERE image_id = pg_temp.img(4) AND outcome = 'succeeded'),
  'the photo shot today was read after photo 4');
SELECT pg_temp.eq((:'a')::jsonb -> 'lines', jsonb_build_array(
  '5 read in the last hour.',
  'Now on photos taken in September 2019. Your photos run from June 2019 to ' || to_char(((:'a')::jsonb ->> 'library_to')::timestamptz AT TIME ZONE 'UTC', 'FMMonth YYYY') || '.',
  'Worked through 4 of 42 photos in date order.',
  '5 photos read since ' || pg_temp.day(((:'a')::jsonb ->> 'counting_since')::timestamptz) || '. Readings made before then are not counted here.',
  '12 are with the reader now.',
  '1 could not be opened.'), 'A: the sentences, in order; nothing about retries or skips, of which A has none');
-- the counts agree with the ledger's own view of the current receipt, for A's photos
SELECT pg_temp.ok(((:'a')::jsonb ->> 'read_since_start')::int = (SELECT count(*) FROM image_stage_current c JOIN vehicle_images v ON v.id = c.image_id WHERE v.user_id = :'ua' AND c.stage = 'classifier' AND c.outcome = 'succeeded')
  AND ((:'a')::jsonb ->> 'could_not_read')::int = (SELECT count(*) FROM image_stage_current c JOIN vehicle_images v ON v.id = c.image_id WHERE v.user_id = :'ua' AND c.stage = 'classifier' AND c.outcome = 'blocked_input')
  AND ((:'a')::jsonb ->> 'retrying')::int = (SELECT count(*) FROM image_stage_current c JOIN vehicle_images v ON v.id = c.image_id WHERE v.user_id = :'ua' AND c.stage = 'classifier' AND c.outcome IN ('unavailable', 'rate_limited')),
  'A: the same answer as image_stage_current, photo 1 included');

-- ===== 6. B sees B's photos: different numbers, a different place in a different library
SELECT pg_temp.st(:'ub') AS b \gset
SELECT pg_temp.eq((:'b')::jsonb - ARRAY['as_of', 'lines', 'counting_since', 'last_read_at', 'last_attempt_at', 'reader_checked_in_at'],
  jsonb_build_object('state', 'moving', 'headline', 'Reading your photos', 'summary', '2 read in the last hour · on photos from February 2015',
    'reasons', '[]'::jsonb, 'photos_total', 10, 'worked_through', 2, 'read_since_start', 2, 'could_not_read', 0, 'skipped', 0, 'retrying', 1,
    'with_reader', 7, 'read_1h', 2, 'read_24h', 2, 'reading_from', timestamptz '2015-02-01 02:00+00', 'library_from', timestamptz '2015-01-01 02:00+00',
    'library_to', timestamptz '2015-10-01 02:00+00', 'library_walked_at', NULL), 'B: moving, with B''s own counts');
SELECT pg_temp.eq((:'b')::jsonb -> 'lines', jsonb_build_array(
  '2 read in the last hour.',
  'Now on photos taken in February 2015. Your photos run from January 2015 to October 2015.',
  'Worked through 2 of 10 photos in date order.',
  '2 photos read since ' || pg_temp.day(((:'b')::jsonb ->> 'counting_since')::timestamptz) || '. Readings made before then are not counted here.',
  '7 are with the reader now.',
  '1 did not go through and will be tried again.'), 'B: the sentences; nothing about photos that could not be opened, of which B has none');
-- nothing of the other person, of the reconciler's settings or of the reader's own words is in either answer
SELECT pg_temp.ok((:'a') !~ '(00bb|by_type|words_read_off|cursor|user_ids|example\.test|fingerprint|image_http_error|stage-queue)'
  AND (:'b') !~ '(00aa|by_type|words_read_off|cursor|user_ids|example\.test|fingerprint|reader_usage_limit|stage-queue)', 'no id, URL, cursor, setting, error name or by_type leaks');

-- ===== 7. dates are said in the caller's time zone; one the server does not know falls back and does not raise
SELECT pg_temp.st(:'ub', 'America/Los_Angeles') AS b_la \gset
SELECT pg_temp.ok((:'b_la')::jsonb -> 'lines' ->> 1 = 'Now on photos taken in January 2015. Your photos run from December 2014 to September 2015.'
  AND (:'b_la')::jsonb ->> 'summary' = '2 read in the last hour · on photos from January 2015', 'Los Angeles: 02:00 UTC on the 1st is the month before');
SELECT pg_temp.ok(pg_temp.st(:'ub', 'Mars/Olympus_Mons') -> 'lines' = (:'b_la')::jsonb -> 'lines'
  AND pg_temp.st(:'ub', '') -> 'lines' = (:'b_la')::jsonb -> 'lines'
  AND pg_temp.st(:'ub', NULL) -> 'lines' = (:'b_la')::jsonb -> 'lines'
  AND pg_temp.st(:'ub', '''; select 1; --') -> 'lines' = (:'b_la')::jsonb -> 'lines', 'an unknown, empty, null or hostile time zone reads as America/Los_Angeles');
SELECT pg_temp.ok((SELECT public.photo_reading_status() -> 'lines') = (:'b_la')::jsonb -> 'lines', 'the default time zone is America/Los_Angeles');
SET timezone = 'Asia/Tokyo';
SELECT pg_temp.ok(pg_temp.st(:'ub') -> 'lines' = (:'b')::jsonb -> 'lines', 'the session''s own time zone changes nothing');
SET timezone = 'UTC';

-- ===== 8. off: a person the reconciler does not serve gets their own photo count and nothing about the reader
UPDATE image_stage_reconciler_state SET wrapped_at = now() - interval '1 day' WHERE lane = 'backfill';
SELECT pg_temp.st(:'uc') AS c \gset
SELECT pg_temp.eq((:'c')::jsonb - 'as_of',
  jsonb_build_object('state', 'off', 'headline', 'Photo reading is not switched on for this account', 'summary', NULL, 'reasons', '[]'::jsonb,
    'lines', jsonb_build_array('Your photos run from March 2010 to July 2010.'),
    'photos_total', 5, 'worked_through', NULL, 'read_since_start', 0, 'counting_since', NULL, 'could_not_read', 0, 'skipped', 0, 'retrying', 0,
    'with_reader', 0, 'read_1h', 0, 'read_24h', 0, 'last_read_at', NULL, 'last_attempt_at', NULL, 'reading_from', NULL,
    'library_from', timestamptz '2010-03-15 12:00+00', 'library_to', timestamptz '2010-07-15 12:00+00',
    'library_walked_at', NULL, 'reader_checked_in_at', NULL), 'C: off, five photos, no reader fields');
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'library_walked_at' IS NOT NULL, 'A, who is served, does see when the library was walked');
UPDATE image_stage_reconciler_state SET wrapped_at = NULL WHERE lane = 'backfill';
-- switched off for everyone: A is off too, keeps A's own count with its clock, and loses the reader fields
UPDATE platform_config SET config_value = config_value || '{"enabled": false}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.st(:'ua') AS a_off \gset
SELECT pg_temp.ok((:'a_off')::jsonb ->> 'state' = 'off' AND (:'a_off')::jsonb -> 'reader_checked_in_at' = 'null'::jsonb AND (:'a_off')::jsonb -> 'reasons' = '[]'::jsonb
  AND (:'a_off')::jsonb ->> 'read_since_start' = '5' AND jsonb_array_length((:'a_off')::jsonb -> 'lines') = 2
  AND (:'a_off')::jsonb -> 'lines' ->> 0 LIKE 'Your photos run from June 2019 to %' AND (:'a_off')::jsonb -> 'lines' ->> 1 LIKE '5 photos read since %',
  'switched off: A is off, with A''s own count and nothing about the reader');
-- settings a hand could leave behind do not raise: a switch that is not true is off; a list with junk in it still names A
UPDATE platform_config SET config_value = config_value || '{"enabled": "maybe"}' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'off', 'a switch that is not true is off');
UPDATE platform_config SET config_value = config_value || jsonb_build_object('enabled', true, 'user_ids', jsonb_build_array('not-a-uuid', 7, NULL, upper(:'ua')))
 WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'moving' AND pg_temp.st(:'ub') ->> 'state' = 'off', 'a list with junk in it still names A, and no longer B');
-- no list at all means everyone: C is served (nothing of C's is queued, so C waits), and D, who has no photos, is told so
UPDATE platform_config SET config_value = config_value - 'user_ids' WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.st(:'uc') AS c_on \gset
SELECT pg_temp.ok((:'c_on')::jsonb ->> 'state' = 'idle' AND (:'c_on')::jsonb ->> 'summary' = 'Nothing waiting right now'
  AND (:'c_on')::jsonb -> 'lines' = jsonb_build_array('Your photos run from March 2010 to July 2010.') AND (:'c_on')::jsonb ->> 'reader_checked_in_at' IS NOT NULL,
  'no list: C is served; with nothing read there is no sentence about readings');
SELECT pg_temp.st(:'ud') AS d \gset
SELECT pg_temp.ok((:'d')::jsonb ->> 'state' = 'idle' AND (:'d')::jsonb ->> 'headline' = 'Photo reading is waiting' AND (:'d')::jsonb ->> 'summary' = 'No photos here yet'
  AND (:'d')::jsonb -> 'lines' = '[]'::jsonb AND (:'d')::jsonb ->> 'photos_total' = '0' AND (:'d')::jsonb -> 'library_from' = 'null'::jsonb, 'D: no photos, no sentences');
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
SELECT pg_temp.ok(pg_temp.st(:'ud') ->> 'state' = 'idle' AND pg_temp.st(:'uc') ->> 'state' = 'stalled', 'a stopped job is C''s business and not D''s, who has nothing to read');
UPDATE image_stage_reconciler_state SET last_run_at = now();
UPDATE platform_config SET config_value = config_value || jsonb_build_object('user_ids', jsonb_build_array(:'ua', :'ub')) WHERE config_key = 'image_stage_reconciler';
SELECT pg_temp.ok(pg_temp.st(:'ua') -> 'lines' = (:'a')::jsonb -> 'lines' AND pg_temp.st(:'ub') -> 'lines' = (:'b')::jsonb -> 'lines', 'settings restored: A and B read as before');

-- ===== 9. stalled, rule by rule. Each starts from the moving state above and is put back afterwards.
-- (a) photos are due and the reader has not checked in
UPDATE job_assay_readings SET assayed_at = now() - interval '3 hours' WHERE jobname = 'subscription-frame-classifier';
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.eq(jsonb_build_object('state', (:'s')::jsonb -> 'state', 'headline', (:'s')::jsonb -> 'headline', 'reasons', (:'s')::jsonb -> 'reasons', 'summary', (:'s')::jsonb -> 'summary'),
  jsonb_build_object('state', 'stalled', 'headline', 'Photo reading has stalled',
    'reasons', jsonb_build_array('The reader on the Mac has not checked in for about 3 hours. It runs only while the Mac is awake and signed in.'),
    'summary', 'The reader on the Mac has not checked in for about 3 hours. It runs only while the Mac is awake and signed in.'), 'stalled (a): the reader is silent while photos are due');
SELECT pg_temp.ok((:'s')::jsonb -> 'lines' ->> 1 LIKE 'Reading has reached photos taken in September 2019. %', 'stalled: the position is where reading stopped, not "now on"');
UPDATE job_assay_readings SET assayed_at = now() - interval '39 minutes' WHERE jobname = 'subscription-frame-classifier';
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'moving', 'a check-in 39 minutes ago is still a check-in');
DELETE FROM job_assay_readings WHERE jobname = 'subscription-frame-classifier';
SELECT pg_temp.eq(pg_temp.st(:'ua') -> 'reasons', jsonb_build_array('The reader on the Mac has not checked in yet. It runs only while the Mac is awake and signed in.'), 'stalled (a): no check-in at all');
SELECT pg_temp.hb(:'healthy');

-- (b) the reader checks in, takes photos and reads none, three runs in a row
SELECT pg_temp.hb('{"frames": 20, "read": 0, "accepted": 0, "errors": 1, "stopped": "reader_usage_limit", "error_classes": {"reader_usage_limit": 1}, "zero_read_since": "2026-11-10T08:00:00.000Z", "zero_read_fires": 3}');
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.eq(jsonb_build_object('state', (:'s')::jsonb -> 'state', 'reasons', (:'s')::jsonb -> 'reasons', 'summary', (:'s')::jsonb -> 'summary'),
  jsonb_build_object('state', 'stalled', 'reasons', jsonb_build_array('The reading subscription is out of usage for now; reading resumes when it resets.'),
    'summary', 'The reading subscription is out of usage for now; reading resumes when it resets.'), 'stalled (b): out of usage, in those words');
SELECT pg_temp.ok(pg_temp.st(:'ub') ->> 'state' = 'stalled' AND pg_temp.st(:'uc') ->> 'state' = 'off', 'B, served by the same reader, is told too; C is not');
SELECT pg_temp.hb('{"frames": 20, "read": 0, "errors": 20, "error_classes": {"image_http_error": 19, "reader_timeout": 1}, "zero_read_since": "2026-11-10T08:00:00.000Z", "zero_read_fires": 4}');
SELECT pg_temp.eq(pg_temp.st(:'ua') -> 'reasons', jsonb_build_array('The reader could not open the photos it was given.'), 'stalled (b): the most frequent failure names the cause');
SELECT pg_temp.hb('{"frames": 20, "read": 0, "errors": 20, "error_classes": {"some_new_fault": 20}, "zero_read_since": "2026-11-10T08:00:00.000Z", "zero_read_fires": 1234}');
SELECT pg_temp.eq(pg_temp.st(:'ua') -> 'reasons', jsonb_build_array('The reader has taken photos and read none of them, 1,234 runs in a row.'), 'stalled (b): a cause with no sentence is counted, never quoted');
SELECT pg_temp.hb('{"frames": 20, "read": 0, "errors": 20, "error_classes": {"reader_usage_limit": 1}, "stopped": "reader_usage_limit", "zero_read_fires": 2}');
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'moving', 'two runs are not yet a stall');
SELECT pg_temp.hb('{"frames": 20, "read": 3, "errors": 17, "error_classes": {"image_http_error": 17}, "zero_read_fires": 9}');
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'moving', 'a run that read something is not a stall');
SELECT pg_temp.hb('{"frames": "many", "read": [0], "zero_read_fires": "lots", "error_classes": "none", "stopped": 7}');
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'moving', 'a heartbeat with the wrong shapes in it does not raise');
SELECT pg_temp.hb(:'healthy');

-- (c) A's photos have been due for two hours and nothing of A's has been tried in that time; B is untouched
UPDATE image_stage_work SET not_before = now() - interval '2 hours' WHERE status = 'queued' AND image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ua');
UPDATE image_stage_receipts SET observed_at = observed_at - interval '2 hours' WHERE image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ua');
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.eq(jsonb_build_object('state', (:'s')::jsonb -> 'state', 'reasons', (:'s')::jsonb -> 'reasons', 'read_1h', (:'s')::jsonb -> 'read_1h', 'read_24h', (:'s')::jsonb -> 'read_24h', 'line', (:'s')::jsonb -> 'lines' -> 0),
  jsonb_build_object('state', 'stalled', 'reasons', jsonb_build_array('Photos have been waiting to be read for about 2 hours, and none has been tried for at least an hour.'),
    'read_1h', 0, 'read_24h', 5, 'line', '5 read in the last day, the last one about 2 hours ago.'), 'stalled (c): due for two hours, nothing tried in the last hour');
SELECT pg_temp.ok(pg_temp.st(:'ub') ->> 'state' = 'moving', 'B, whose photos were read minutes ago, is still moving');
-- an attempt of any outcome within the hour means the queue is being worked: A is waiting between runs, not stalled
SELECT record_image_stage_receipt(pg_temp.img(6), 'classifier', 1, 'blocked_input', 'image_unreadable');
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.eq(jsonb_build_object('state', (:'s')::jsonb -> 'state', 'headline', (:'s')::jsonb -> 'headline', 'summary', (:'s')::jsonb -> 'summary', 'reasons', (:'s')::jsonb -> 'reasons',
                                     'could_not_read', (:'s')::jsonb -> 'could_not_read', 'with_reader', (:'s')::jsonb -> 'with_reader'),
  jsonb_build_object('state', 'idle', 'headline', 'Photo reading is waiting', 'summary', 'Waiting for the reader''s next run', 'reasons', '[]'::jsonb,
                     'could_not_read', 2, 'with_reader', 11), 'idle: photos are due, something was tried within the hour, nothing was read in the last half hour');
UPDATE image_stage_receipts SET observed_at = observed_at + interval '2 hours'
 WHERE image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ua') AND image_id <> pg_temp.img(6);
UPDATE image_stage_work SET not_before = now() WHERE status = 'queued';
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'moving', 'clocks restored: moving');

-- (d) the job that lines photos up has stopped
UPDATE image_stage_reconciler_state SET last_run_at = now() - interval '3 hours';
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.eq(jsonb_build_object('state', (:'s')::jsonb -> 'state', 'reasons', (:'s')::jsonb -> 'reasons'),
  jsonb_build_object('state', 'stalled', 'reasons', jsonb_build_array('The job that lines photos up for the reader last ran about 3 hours ago.')), 'stalled (d): the job last ran three hours ago');
UPDATE image_stage_reconciler_state SET last_run_at = NULL;
SELECT pg_temp.eq(pg_temp.st(:'ua') -> 'reasons', jsonb_build_array('The job that lines photos up for the reader has not run yet.'), 'stalled (d): the job never ran');
-- two rules at once: both reasons, in order, and the summary is the first
UPDATE job_assay_readings SET assayed_at = now() - interval '50 minutes' WHERE jobname = 'subscription-frame-classifier';
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.ok(jsonb_array_length((:'s')::jsonb -> 'reasons') = 2 AND (:'s')::jsonb -> 'reasons' ->> 0 LIKE 'The reader on the Mac has not checked in for about 50 minutes.%'
  AND (:'s')::jsonb -> 'reasons' ->> 1 LIKE 'The job that lines photos up%' AND (:'s')::jsonb ->> 'summary' = (:'s')::jsonb -> 'reasons' ->> 0, 'two stalls: two reasons, the first is the summary');
UPDATE image_stage_reconciler_state SET last_run_at = now();
SELECT pg_temp.hb(:'healthy');

-- ===== 10. idle
-- B's queue empties (the items are closed without a read) and B's readings are two hours old: one photo waits for its retry
UPDATE image_stage_work SET status = 'dropped', finished_at = now(), lease_until = NULL
 WHERE status IN ('queued', 'claimed') AND image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ub');
UPDATE image_stage_receipts SET observed_at = observed_at - interval '2 hours' WHERE image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ub');
SELECT pg_temp.st(:'ub') AS s \gset
SELECT pg_temp.eq((:'s')::jsonb - ARRAY['as_of', 'counting_since', 'last_read_at', 'last_attempt_at', 'reader_checked_in_at', 'library_from', 'library_to', 'reading_from', 'photos_total'],
  jsonb_build_object('state', 'idle', 'headline', 'Photo reading is waiting', 'summary', '1 waiting to be tried again', 'reasons', '[]'::jsonb,
    'lines', jsonb_build_array(
      '2 read in the last day, the last one about 2 hours ago.',
      'Reading has reached photos taken in February 2015. Your photos run from January 2015 to October 2015.',
      'Worked through 2 of 10 photos in date order.',
      '2 photos read since ' || pg_temp.day(((:'s')::jsonb ->> 'counting_since')::timestamptz) || '. Readings made before then are not counted here.',
      '1 did not go through and will be tried again.'),
    'worked_through', 2, 'read_since_start', 2, 'could_not_read', 0, 'skipped', 0, 'retrying', 1, 'with_reader', 0, 'read_1h', 0, 'read_24h', 2,
    'library_walked_at', NULL), 'idle: nothing with the reader (so no sentence about it), one waiting to be tried again');
-- a silent reader is not B's stall while nothing of B's is due or handed out; it is A's, whose photos are due
UPDATE job_assay_readings SET assayed_at = now() - interval '3 hours' WHERE jobname = 'subscription-frame-classifier';
SELECT pg_temp.ok(pg_temp.st(:'ub') ->> 'state' = 'idle' AND pg_temp.st(:'ua') ->> 'state' = 'stalled', 'a silent reader stalls only those with photos due');
SELECT pg_temp.hb(:'healthy');
-- A's queue empties too, A's readings age, and the pass has been over the whole library
UPDATE image_stage_work SET status = 'dropped', finished_at = now(), lease_until = NULL
 WHERE status IN ('queued', 'claimed') AND image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ua');
UPDATE image_stage_receipts SET observed_at = observed_at - interval '3 days' WHERE image_id IN (SELECT id FROM vehicle_images WHERE user_id = :'ua');
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.ok((:'s')::jsonb ->> 'state' = 'idle' AND (:'s')::jsonb ->> 'summary' = 'Nothing waiting right now'
  AND (:'s')::jsonb -> 'lines' ->> 0 = 'The last photo was read about 3 days ago.' AND (:'s')::jsonb ->> 'read_24h' = '0' AND (:'s')::jsonb ->> 'with_reader' = '0',
  'idle: nothing waiting; the last reading is said by its age');
UPDATE image_stage_reconciler_state SET wrapped_at = now() - interval '1 day' WHERE lane = 'backfill';
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.day((SELECT wrapped_at FROM image_stage_reconciler_state WHERE lane = 'backfill')) AS walked_day \gset
SELECT pg_temp.eq(jsonb_build_object('state', (:'s')::jsonb -> 'state', 'summary', (:'s')::jsonb -> 'summary', 'lines', (:'s')::jsonb -> 'lines',
                                     'walked', ((:'s')::jsonb ->> 'library_walked_at')::timestamptz = (SELECT wrapped_at FROM image_stage_reconciler_state WHERE lane = 'backfill'),
                                     'worked_through', (:'s')::jsonb -> 'worked_through'),
  jsonb_build_object('state', 'idle', 'summary', 'The whole library has been looked at once, as of ' || :'walked_day',
    'lines', jsonb_build_array(
      'The last photo was read about 3 days ago.',
      'Your photos run from June 2019 to ' || to_char(((:'s')::jsonb ->> 'library_to')::timestamptz AT TIME ZONE 'UTC', 'FMMonth YYYY') || '.',
      '5 photos read since ' || pg_temp.day(((:'s')::jsonb ->> 'counting_since')::timestamptz) || '. Readings made before then are not counted here.',
      '2 could not be opened.',
      'The whole library has been looked at once, as of ' || :'walked_day' || '.'),
    'walked', true, 'worked_through', 4), 'idle after a whole pass: said once, with its date, in place of a position; the raw position is still returned');
SELECT pg_temp.ok(pg_temp.st(:'ub') ->> 'summary' = '1 waiting to be tried again', 'B still has a retry waiting, which is said first');
UPDATE image_stage_reconciler_state SET wrapped_at = NULL WHERE lane = 'backfill';
-- a count that started in an earlier year carries its year
UPDATE image_stage_receipts SET observed_at = now() - interval '400 days' WHERE image_id = pg_temp.img(2);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements_text(pg_temp.st(:'ua') -> 'lines') l
  WHERE l = '5 photos read since ' || to_char((SELECT observed_at FROM image_stage_receipts WHERE image_id = pg_temp.img(2)) AT TIME ZONE 'UTC', 'Mon FMDD, YYYY') || '. Readings made before then are not counted here.'),
  'a start date in an earlier year is said with its year');

-- ===== 11. moving again: photos handed out under a fresh check-in count as moving before the first is read
UPDATE image_stage_work SET status = 'claimed', lease_until = now() + interval '10 minutes', finished_at = NULL WHERE image_id = pg_temp.img(7);
SELECT pg_temp.st(:'ua') AS s \gset
SELECT pg_temp.ok((:'s')::jsonb ->> 'state' = 'moving' AND (:'s')::jsonb ->> 'summary' = 'Reading now · on photos from September 2019' AND (:'s')::jsonb ->> 'with_reader' = '1'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text((:'s')::jsonb -> 'lines') l WHERE l = '1 is with the reader now.'), 'handed out under a fresh check-in: moving');
UPDATE image_stage_work SET lease_until = now() - interval '1 minute' WHERE image_id = pg_temp.img(7);
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'state' = 'idle' AND pg_temp.st(:'ua') ->> 'summary' = 'Waiting for the reader''s next run', 'a hand-out whose lease ran out is not moving');
-- no sentence anywhere above printed a zero
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(pg_temp.st(:'ua') -> 'lines' || pg_temp.st(:'ub') -> 'lines' || pg_temp.st(:'uc') -> 'lines') l WHERE l ~ '(^|[^0-9,])0 '),
  'no sentence prints a zero');

-- ===== 12. size: a poll over a 12,000-photo library answers well inside its budget
-- The sets the reader builds (the caller's photos, their receipts, their work) must never be joined to one another:
-- the planner cannot size them and loops. A version that did took 17 s on a 32,000-photo library on PostgreSQL 16 and
-- is cancelled here; the reader as written answers in a few hundredths of a second.
\set ue '00000000-0000-4000-8000-0000000000ee'
INSERT INTO vehicle_images (id, user_id, image_url, created_at, taken_at, ai_processing_status)
SELECT pg_temp.img(100000 + g), :'ue', 'https://example.test/e' || g || '.jpg', now() - interval '20 days' + g * interval '1 second',
       timestamptz '2012-01-01 12:00+00' + g * interval '3 hours', 'completed'
  FROM generate_series(1, 12000) g;
INSERT INTO image_stage_work (image_id, stage, target_version, reason, lane, status, not_before, finished_at)
SELECT pg_temp.img(100000 + g), 'classifier', 1, 'missing', 'backfill', 'done', now() - interval '2 days', now() - interval '1 day' FROM generate_series(1, 12000) g;
INSERT INTO image_stage_receipts (image_id, stage, producer, producer_version, outcome, observed_at)
SELECT pg_temp.img(100000 + g), 'classifier', 'photo-pipeline-orchestrator', 1, 'succeeded', now() - interval '2 days' + g * interval '1 second' FROM generate_series(1, 12000) g;
UPDATE platform_config SET config_value = config_value || jsonb_build_object('user_ids', jsonb_build_array(:'ua', :'ub', :'ue')) WHERE config_key = 'image_stage_reconciler';
ANALYZE vehicle_images;
ANALYZE image_stage_work;
ANALYZE image_stage_receipts;
SET statement_timeout = '3s';
SELECT pg_temp.st(:'ue') AS e \gset
SET statement_timeout = '60s';
SELECT pg_temp.ok((:'e')::jsonb ->> 'state' = 'idle' AND (:'e')::jsonb ->> 'photos_total' = '12000' AND (:'e')::jsonb ->> 'read_since_start' = '12000' AND (:'e')::jsonb ->> 'worked_through' = '12000'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text((:'e')::jsonb -> 'lines') l WHERE l = 'Worked through 12,000 of 12,000 photos in date order.')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text((:'e')::jsonb -> 'lines') l WHERE l LIKE '12,000 photos read since %'),
  'a 12,000-photo library is answered inside 3 s, with its numbers grouped in thousands');
SELECT pg_temp.ok(pg_temp.st(:'ua') ->> 'photos_total' = '42' AND pg_temp.st(:'ub') ->> 'read_since_start' = '2', 'and the large library next door changes nothing for A or B');
UPDATE platform_config SET config_value = config_value || jsonb_build_object('user_ids', jsonb_build_array(:'ua', :'ub')) WHERE config_key = 'image_stage_reconciler';

-- ===== 13. the grants, enforced: anon is refused both; a signed-in user reads their own and cannot name a user
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000aa"}', false);
SET ROLE anon;
SELECT pg_temp.raises('SELECT public.photo_reading_status()') AS anon_public, pg_temp.raises($q$SELECT public.photo_reading_status_for('00000000-0000-4000-8000-0000000000aa')$q$) AS anon_internal \gset
RESET ROLE;
SET ROLE authenticated;
SELECT public.photo_reading_status('UTC') ->> 'photos_total' AS auth_total, pg_temp.raises($q$SELECT public.photo_reading_status_for('00000000-0000-4000-8000-0000000000bb')$q$) AS auth_internal \gset
RESET ROLE;
SET ROLE service_role;
SELECT public.photo_reading_status_for('00000000-0000-4000-8000-0000000000bb', 'UTC') ->> 'photos_total' AS service_total \gset
RESET ROLE;
SELECT pg_temp.ok(:'anon_public' LIKE 'permission denied for function photo_reading_status%' AND :'anon_internal' LIKE 'permission denied for function photo_reading_status_for%', 'anon is refused both readers');
SELECT pg_temp.ok(:'auth_total' = '42' AND :'auth_internal' LIKE 'permission denied for function photo_reading_status_for%', 'a signed-in user reads their own 42 photos and is refused the reader that takes a user id');
SELECT pg_temp.ok(:'service_total' = '10', 'the service role reads the internal reader for a named user');

-- ===== 14. replay changes nothing
SELECT md5(string_agg(md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, '') || coalesce(obj_description(p.oid, 'pg_proc'), ''), ',' ORDER BY p.proname)) AS own_before
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('photo_reading_status', 'photo_reading_status_for') \gset
SELECT pg_temp.st(:'ua') - 'as_of' AS before_replay \gset
\i supabase/migrations/20261113170000_photo_reading_status.sql
SELECT pg_temp.ok((SELECT md5(string_agg(md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, '') || coalesce(obj_description(p.oid, 'pg_proc'), ''), ',' ORDER BY p.proname))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('photo_reading_status', 'photo_reading_status_for')) = :'own_before'
  AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) = :fn_count_before + 2
  AND (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace) = :rel_before AND (SELECT count(*) FROM cron.job) = :cron_before
  AND pg_temp.st(:'ua') - 'as_of' = (:'before_replay')::jsonb, 'replay: the same two functions, grants, settings, comments and answer; nothing else added');

-- ===== 15. the revert removes both functions and nothing else; without the index the migration refuses
\i supabase/sql/revert_20261113170000_photo_reading_status.sql
SELECT pg_temp.ok(to_regprocedure('public.photo_reading_status(text)') IS NULL AND to_regprocedure('public.photo_reading_status_for(uuid, text)') IS NULL
  AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) = :fn_count_before
  AND (SELECT md5(string_agg(p.oid::text || md5(p.prosrc) || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, ''), ',' ORDER BY p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) = :'fn_before'
  AND (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace) = :rel_before
  AND (SELECT count(*) FROM image_stage_receipts) > 0, 'revert: both functions gone, every other function and table as it was, receipts kept');
\i supabase/sql/revert_20261113170000_photo_reading_status.sql
DROP INDEX public.idx_vehicle_images_capture_ledger;
\echo the errors that follow are the refusal under test
\set ON_ERROR_STOP off
\i supabase/migrations/20261113170000_photo_reading_status.sql
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.ok(to_regprocedure('public.photo_reading_status(text)') IS NULL AND to_regprocedure('public.photo_reading_status_for(uuid, text)') IS NULL,
  'without the capture ledger index the migration refuses and leaves nothing behind');
\echo photo_reading_status contract: ok (capture order migration applied: :has_capture_order)

-- nothing_left_unfiled (20261115234000) must use the #3318 still-unfiled
-- definition: is_duplicate / is_superseded do not exempt an unfiled photo.
-- A review whose remaining photos are all flagged but still unfiled stays
-- open. A review whose photos are all actually filed / linked / paged still
-- resolves. Coverage and re-arm are unchanged. Cron is untouched.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_review_sweep_nothing_left_unfiled%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_review_sweep_nothing_left_unfiled* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz,
  is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], to_vehicle_id uuid, confidence numeric, basis text, evidence jsonb DEFAULT '{}', reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')), created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, set_key));
CREATE TABLE public.capture_set_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, image_id uuid, vehicle_id uuid,
  set_key text, created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.filing_run_gate(run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_rescore_queue(user_id uuid, day date, requested_at timestamptz, not_before date, reasons jsonb,
  done_run_id uuid, done_at timestamptz, PRIMARY KEY (user_id, day));
CREATE FUNCTION public.capture_sets_enqueue(p_user uuid, p_day date, p_reason jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, requested_at, not_before, reasons)
  VALUES (p_user, p_day, now(), current_date, jsonb_build_array(p_reason))
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = least(q.not_before, current_date), done_at = NULL, done_run_id = NULL,
        reasons = q.reasons || jsonb_build_array(p_reason) $$;
CREATE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS $$
  DELETE FROM cron.job WHERE jobid = p_id RETURNING true $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/sql/helpers/capture_set_review_sweep_live_parent_20261115234000.sql

SELECT pg_temp.assert_true(md5(p.prosrc) = '2e3bb92f11c82feea8b91687d58e4748', 'parent sweep md5 is the live #3318 body')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';

-- ALLOW_RAW_TESTIMONY_WRITE
-- K: all-superseded unfiled photos (the live #3322 shape).
-- L: all-duplicate unfiled photos.
-- M: mixed — one genuine unfiled + one superseded unfiled; stays open either body.
-- N: actually filed (vehicle_id).
-- O: unfiled superseded but has an active document page.
-- P: unfiled duplicate but has an active capture_set_link.
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, is_duplicate, is_superseded) VALUES
 ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-11 18:00+00', false, true),
 ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-11 18:05+00', false, true),
 ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-12 18:00+00', true, false),
 ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-13 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-13 18:05+00', false, true),
 ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1', '2026-03-14 18:00+00', false, false),
 ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-15 18:00+00', false, true),
 ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-16 18:00+00', true, false);
INSERT INTO capture_document_pages VALUES ('00000000-0000-4000-8000-000000000037', NULL);
INSERT INTO capture_set_links(run_id, image_id, vehicle_id, set_key)
  VALUES ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-0000000000b1', 'ios:a:P');
INSERT INTO capture_set_review(id, run_id, user_id, set_key, image_ids, reason, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:K',
  '{00000000-0000-4000-8000-000000000031,00000000-0000-4000-8000-000000000032}', 'typ_other_vehicle', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:L',
  '{00000000-0000-4000-8000-000000000033}', 'typ_other_vehicle', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:M',
  '{00000000-0000-4000-8000-000000000034,00000000-0000-4000-8000-000000000035}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:N',
  '{00000000-0000-4000-8000-000000000036}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:O',
  '{00000000-0000-4000-8000-000000000037}', 'no_clear_lead', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:P',
  '{00000000-0000-4000-8000-000000000038}', 'no_clear_lead', '2026-11-01 00:00+00');

-- Parent (#3318) incorrectly resolves K and L as nothing_left_unfiled.
SELECT public.capture_set_review_sweep(NULL, 0) AS pre \gset
SELECT pg_temp.assert_true((:'pre')::jsonb->>'nothing_left_unfiled' = '5'
  AND (:'pre')::jsonb->>'superseded' = '0' AND (:'pre')::jsonb->>'rearmed' = '0',
  'pre: parent resolves K, L, N, O, P');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'resolved'
  AND (SELECT evidence#>>'{resolved,how}' FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'nothing_left_unfiled',
  'pre: all-superseded unfiled K is incorrectly resolved (the bug)');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a2') = 'resolved',
  'pre: all-duplicate unfiled L is incorrectly resolved');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a3') = 'open',
  'pre: mixed set M stays open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a4') = 'resolved'
  AND (SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a5') = 'resolved'
  AND (SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a6') = 'resolved',
  'pre: truly filed / paged / linked N, O, P resolve');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 'pre: re-arm limit 0 writes no queue rows');

-- Re-open K and L so the same rows can show the fix. Leave N, O, P resolved.
UPDATE capture_set_review
   SET status = 'open', evidence = '{}'::jsonb
 WHERE id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2');

\i supabase/migrations/20261115234000_capture_review_sweep_nothing_left_unfiled.sql

SELECT pg_temp.assert_true(md5(p.prosrc) = 'e569895db14709dd55e98b3061dc538e', 'new sweep body md5')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';
SELECT pg_temp.assert_true(position('is_superseded do not exempt it; same definition as the coverage clause' in p.prosrc) > 0
  AND position('20261113120600' in p.prosrc) > 0
  AND position('uncovered_after_newer_run' in p.prosrc) > 0,
  'fix comment, coverage, and 20600 re-arm comments are all present')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';

SELECT public.capture_set_review_sweep(NULL, 0) AS post \gset
SELECT pg_temp.assert_true((:'post')::jsonb->>'nothing_left_unfiled' = '0'
  AND (:'post')::jsonb->>'superseded' = '0' AND (:'post')::jsonb->>'rearmed' = '0',
  'post: K and L stay open; already-resolved N/O/P are not counted again');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'open',
  'post: all-superseded unfiled K stays open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a2') = 'open',
  'post: all-duplicate unfiled L stays open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a3') = 'open',
  'post: mixed set M still open');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a4') = 'resolved'
  AND (SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a5') = 'resolved'
  AND (SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a6') = 'resolved',
  'post: truly filed / paged / linked N, O, P stay resolved');

-- A revoked document page and a reverted link do not count as filing.
INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, is_duplicate, is_superseded) VALUES
 ('00000000-0000-4000-8000-000000000039', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-17 18:00+00', false, true),
 ('00000000-0000-4000-8000-00000000003a', '00000000-0000-4000-8000-0000000000aa', NULL, '2026-03-18 18:00+00', true, false);
INSERT INTO capture_document_pages VALUES ('00000000-0000-4000-8000-000000000039', now());
INSERT INTO capture_set_links(run_id, image_id, vehicle_id, set_key, reverted_at)
  VALUES ('00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-00000000003a', '00000000-0000-4000-8000-0000000000b1', 'ios:a:R', now());
INSERT INTO capture_set_review(id, run_id, user_id, set_key, image_ids, reason, created_at) VALUES
 ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:Q',
  '{00000000-0000-4000-8000-000000000039}', 'typ_other_vehicle', '2026-11-01 00:00+00'),
 ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', 'ios:a:R',
  '{00000000-0000-4000-8000-00000000003a}', 'typ_other_vehicle', '2026-11-01 00:00+00');

SELECT public.capture_set_review_sweep(NULL, 0) AS post2 \gset
SELECT pg_temp.assert_true((:'post2')::jsonb->>'nothing_left_unfiled' = '0',
  'revoked page and reverted link do not let Q or R resolve');
SELECT pg_temp.assert_true((SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a7') = 'open'
  AND (SELECT status FROM capture_set_review WHERE id = '00000000-0000-4000-8000-0000000000a8') = 'open',
  'Q and R stay open');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_rescore_queue) = 0, 're-arm limit 0 still writes no queue rows');
SELECT pg_temp.assert_true((SELECT count(*) FROM cron.job) = 0, 'this migration does not touch cron');

-- revert restores the parent body, then the migration can be re-applied
\i supabase/sql/revert_20261115234000_capture_review_sweep_nothing_left_unfiled.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = '2e3bb92f11c82feea8b91687d58e4748', 'revert restores the #3318 body')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';
\i supabase/migrations/20261115234000_capture_review_sweep_nothing_left_unfiled.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = 'e569895db14709dd55e98b3061dc538e', 'migration is re-applicable after revert')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='capture_set_review_sweep';

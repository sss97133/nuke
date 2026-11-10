-- Unseen admitted photos re-open a refused day (20261113120900). A day the gate refused stays blocked until new evidence;
-- new evidence now includes a planner-eligible unfiled photo absent from the refused plan that only became eligible after
-- the refusal (admission epoch). A photo the refused plan saw, or one it could have seen and left out, never re-opens the day.
-- Requires empty disposable dm_refinement_capture_replan_unseen* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_replan_unseen%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text, exif_data jsonb, image_url text,
  taken_at timestamptz, created_at timestamptz DEFAULT now(), is_duplicate boolean, is_superseded boolean, is_sensitive boolean,
  vision_gate_status text);
CREATE TABLE public.capture_set_review (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text, image_ids uuid[],
  to_vehicle_id uuid, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_set_candidates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, image_ids uuid[]);
CREATE TABLE public.capture_set_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, set_key text, image_id uuid, vehicle_id uuid,
  created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.filing_run_gate (run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.capture_document_pages (image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_landing_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, t_from timestamptz, t_to timestamptz,
  state text, dry boolean DEFAULT false, run_id uuid DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), updated_at timestamptz);
-- the 120700 admission (live bodies, simplified to their contract) and its saved-defs table
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['capture_relay_ios','iphoto','iphoto_60d','photo_auto_sync','library_recovery'] $$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ SELECT p_source = ANY (public.capture_set_photo_sources())
       OR (p_vehicle_id IS NULL AND (p_source IN ('user_upload','owner_upload','drop-folder') OR p_source LIKE 'direct\_pull\_%')
           AND coalesce(p_exif ? 'DateTimeOriginal', false)) $$;
CREATE TABLE public.capture_admit_uploads_prev_defs (proname text, def text, md5 text, saved_at timestamptz);
INSERT INTO public.capture_admit_uploads_prev_defs VALUES ('x', 'x', 'x', now() - interval '2 hours');

-- the live body read 2026-11-09 (20261113120800), verbatim
CREATE OR REPLACE FUNCTION public.capture_day_replan_state(p_user uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz := p_day::timestamp AT TIME ZONE 'America/Los_Angeles';
  v_to   timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'America/Los_Angeles';
  c record; v_photos boolean; v_anchor boolean;
BEGIN
  SELECT id, state, coalesce(updated_at, created_at) AS at INTO c
  FROM capture_landing_chunks
  WHERE user_id = p_user AND t_from = v_from AND t_to = v_to
    AND NOT coalesce(dry, false)  -- 20261113120800: a dry run is a preview, never a pending plan
  ORDER BY created_at DESC LIMIT 1;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'never_planned');
  END IF;
  IF c.state IN ('planned', 'awaiting_gate') THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'plan_pending', 'chunk', c.id, 'state', c.state);
  END IF;
  IF c.state <> 'gate_failed' THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'last_plan_' || c.state, 'chunk', c.id);
  END IF;
  -- refused: new evidence is a photo of that day that arrived after the refusal, or a gate-passed filing after the
  -- refusal onto a vehicle the day's open review rows propose, or in the same capture session (set_key) or capture day
  -- (20261113120100: no longer any vehicle when they propose none)
  SELECT EXISTS (SELECT 1 FROM vehicle_images v
                 WHERE v.user_id = p_user AND v.vehicle_id IS NULL AND v.taken_at >= v_from AND v.taken_at < v_to
                   AND v.created_at > c.at)
    INTO v_photos;
  SELECT EXISTS (
           WITH vehs AS (
             SELECT array_agg(DISTINCT r.to_vehicle_id) FILTER (WHERE r.to_vehicle_id IS NOT NULL) a, array_agg(DISTINCT r.set_key) s
             FROM capture_set_review r
             WHERE r.user_id = p_user AND r.status = 'open'
               AND (SELECT (min(v.taken_at) AT TIME ZONE 'America/Los_Angeles')::date FROM vehicle_images v WHERE v.id = ANY (r.image_ids)) = p_day)
           SELECT 1 FROM capture_set_links l
           JOIN filing_run_gate fg ON fg.run_id = l.run_id::text AND fg.passed
           JOIN vehicle_images vi ON vi.id = l.image_id, vehs
           WHERE l.reverted_at IS NULL AND vi.user_id = p_user AND l.created_at > c.at
             AND (l.vehicle_id = ANY (coalesce(vehs.a, '{}'::uuid[])) OR l.set_key = ANY (coalesce(vehs.s, '{}'::text[]))
                  OR (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date = p_day))
    INTO v_anchor;
  IF v_photos OR v_anchor THEN
    RETURN jsonb_build_object('blocked', false, 'reason', 'new_evidence_since_refusal', 'chunk', c.id,
                              'new_photos', v_photos, 'new_anchor', v_anchor);
  END IF;
  RETURN jsonb_build_object('blocked', true, 'reason', 'refused_no_new_evidence', 'chunk', c.id, 'refused_at', c.at);
END $function$;
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_day_replan_state(uuid, date)'::regprocedure)) = 'a872c072bd702a360071a733f7b69dc4',
  'fixture is the live body');

CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE FUNCTION pg_temp.at(d date) RETURNS timestamptz LANGUAGE sql AS $$ SELECT d::timestamp AT TIME ZONE 'America/Los_Angeles' + interval '12 hours' $$;
-- a refused (gate_failed) plan of day d, made `age` ago, that saw `seen`
CREATE FUNCTION pg_temp.refused(d date, age interval, seen uuid[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r uuid := gen_random_uuid(); BEGIN
  INSERT INTO capture_landing_chunks(user_id, t_from, t_to, state, run_id, created_at)
  VALUES (pg_temp.u(), d::timestamp AT TIME ZONE 'America/Los_Angeles', (d + 1)::timestamp AT TIME ZONE 'America/Los_Angeles', 'gate_failed', r, now() - age);
  IF seen IS NOT NULL THEN INSERT INTO capture_set_review(run_id, user_id, image_ids, status) VALUES (r, pg_temp.u(), seen, 'resolved'); END IF;
  RETURN r; END $$;
CREATE FUNCTION pg_temp.photo(id uuid, d date, src text, created timestamptz, exif boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$
  INSERT INTO vehicle_images(id, user_id, vehicle_id, source, exif_data, image_url, taken_at, created_at)
  VALUES (id, pg_temp.u(), NULL, src, CASE WHEN exif THEN '{"DateTimeOriginal":"x"}'::jsonb ELSE '{}'::jsonb END, 'https://x/' || id, pg_temp.at(d), created) $$;
CREATE FUNCTION pg_temp.st(d date) RETURNS text LANGUAGE sql AS $$ SELECT public.capture_day_replan_state(pg_temp.u(), d)->>'reason' $$;

-- day A: refused 30 min ago (after the 2h-old admission); a library photo it saw, plus an old upload admitted 2h ago it also saw
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000a001', '2017-11-14', 'capture_relay_ios', now() - interval '300 days');
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000a002', '2017-11-14', 'user_upload', now() - interval '300 days');
SELECT pg_temp.refused('2017-11-14', interval '30 minutes', ARRAY['00000000-0000-4000-8000-00000000a001','00000000-0000-4000-8000-00000000a002']::uuid[]);
-- day B: refused 5 hours ago (BEFORE the admission); an old upload it never saw (it was not eligible then)
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000b001', '2017-11-19', 'capture_relay_ios', now() - interval '300 days');
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000b002', '2017-11-19', 'user_upload', now() - interval '300 days');
SELECT pg_temp.refused('2017-11-19', interval '5 hours', ARRAY['00000000-0000-4000-8000-00000000b001']::uuid[]);
-- day C: refused 5 hours ago; an old LIBRARY photo it left out (eligible then, so the planner chose not to propose it)
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000c001', '2017-12-01', 'capture_relay_ios', now() - interval '300 days');
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000c002', '2017-12-01', 'capture_relay_ios', now() - interval '300 days');
SELECT pg_temp.refused('2017-12-01', interval '5 hours', ARRAY['00000000-0000-4000-8000-00000000c001']::uuid[]);
-- day D: refused 5 hours ago; old unseen upload WITHOUT a camera clock (not admitted), one sensitive, one empty-link
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000d001', '2017-12-02', 'user_upload', now() - interval '300 days', false);
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000d002', '2017-12-02', 'user_upload', now() - interval '300 days');
UPDATE vehicle_images SET is_sensitive = true WHERE id = '00000000-0000-4000-8000-00000000d002';
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000d003', '2017-12-02', 'user_upload', now() - interval '300 days');
UPDATE vehicle_images SET image_url = '' WHERE id = '00000000-0000-4000-8000-00000000d003';
SELECT pg_temp.refused('2017-12-02', interval '5 hours', NULL);
-- day E: refused 5 hours ago; unseen admitted upload that is already filed (linked)
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000e001', '2017-12-03', 'user_upload', now() - interval '300 days');
INSERT INTO capture_set_links(image_id, vehicle_id) VALUES ('00000000-0000-4000-8000-00000000e001', gen_random_uuid());
SELECT pg_temp.refused('2017-12-03', interval '5 hours', NULL);

-- before: every refused day stays blocked (the gap)
SELECT pg_temp.assert_true(pg_temp.st('2017-11-19') = 'refused_no_new_evidence', 'before: an unseen admitted upload does not re-open the day');

\i supabase/migrations/20261113120900_capture_replan_unseen_admitted.sql

SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_admission_epochs WHERE rule = 'unfiled_uploads'
  AND admitted_from = (SELECT min(saved_at) FROM capture_admit_uploads_prev_defs)) = 1, 'epoch seeded from the 120700 apply time');
SELECT pg_temp.assert_true(NOT has_table_privilege('anon', 'public.capture_set_admission_epochs', 'SELECT'), 'epochs not readable by anon');
SELECT pg_temp.assert_true(pg_temp.st('2017-11-19') = 'new_evidence_since_refusal'
  AND (public.capture_day_replan_state(pg_temp.u(), '2017-11-19')->>'unseen_photos')::boolean, 'B: refused before admission, unseen upload re-opens');
SELECT pg_temp.assert_true(pg_temp.st('2017-11-14') = 'refused_no_new_evidence', 'A: refused after admission and saw it: stays blocked');
SELECT pg_temp.assert_true(pg_temp.st('2017-12-01') = 'refused_no_new_evidence', 'C: a library photo the plan left out never re-opens (no loop)');
SELECT pg_temp.assert_true(pg_temp.st('2017-12-02') = 'refused_no_new_evidence', 'D: unadmitted, sensitive and empty-link photos do not count');
SELECT pg_temp.assert_true(pg_temp.st('2017-12-03') = 'refused_no_new_evidence', 'E: a filed photo does not count');
-- B re-planned after the admission and refused again, leaving the upload out: no loop
SELECT pg_temp.refused('2017-11-19', interval '10 minutes', ARRAY['00000000-0000-4000-8000-00000000b001']::uuid[]);
SELECT pg_temp.assert_true(pg_temp.st('2017-11-19') = 'refused_no_new_evidence', 'B: a re-plan that leaves the upload out is not re-opened by it again');
-- a brand-new photo still re-opens (existing rule kept)
SELECT pg_temp.photo('00000000-0000-4000-8000-00000000c009', '2017-12-01', 'capture_relay_ios', now());
SELECT pg_temp.assert_true(pg_temp.st('2017-12-01') = 'new_evidence_since_refusal', 'a photo that arrived after the refusal still re-opens');
-- dry and pending rules unchanged
INSERT INTO capture_landing_chunks(user_id, t_from, t_to, state, created_at) VALUES (pg_temp.u(), '2017-12-05'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2017-12-06'::timestamp AT TIME ZONE 'America/Los_Angeles', 'awaiting_gate', now());
SELECT pg_temp.assert_true(pg_temp.st('2017-12-05') = 'plan_pending', 'a pending plan still blocks');
INSERT INTO capture_landing_chunks(user_id, t_from, t_to, state, dry, created_at) VALUES (pg_temp.u(), '2017-12-07'::timestamp AT TIME ZONE 'America/Los_Angeles',
  '2017-12-08'::timestamp AT TIME ZONE 'America/Los_Angeles', 'planned', true, now());
SELECT pg_temp.assert_true(pg_temp.st('2017-12-07') = 'never_planned', 'a dry chunk is still ignored');

\i supabase/sql/revert_20261113120900_capture_replan_unseen_admitted.sql
SELECT pg_temp.assert_true(to_regclass('public.capture_set_admission_epochs') IS NULL, 'revert drops the epochs table');
SELECT pg_temp.assert_true(pg_temp.st('2017-11-14') = 'refused_no_new_evidence', 'revert restores the prior behaviour');
SELECT 'capture replan unseen admitted contract: ok' AS result;

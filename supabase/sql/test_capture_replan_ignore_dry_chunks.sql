-- Re-plan state ignores dry runs (20261113120800): a dry landing chunk (a preview, left in 'planned') must not block the
-- day's real plans as 'plan_pending'; a real planned / awaiting_gate chunk still does. Revert restores the prior body.
-- Requires empty disposable dm_refinement_capture_replan_ignore_dry* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_replan_ignore_dry%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, taken_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_set_review (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, set_key text, image_ids uuid[],
  to_vehicle_id uuid, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.capture_set_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, set_key text, image_id uuid, vehicle_id uuid,
  created_at timestamptz DEFAULT now(), reverted_at timestamptz);
CREATE TABLE public.filing_run_gate (run_id text PRIMARY KEY, passed boolean);
CREATE TABLE public.capture_landing_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, t_from timestamptz, t_to timestamptz,
  state text, dry boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz);

-- the live body read 2026-11-09, verbatim
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
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.capture_day_replan_state(uuid, date)'::regprocedure)) = '4e24c7285297626bc4b13e1ded45fa8f',
  'fixture is the live body');

CREATE FUNCTION pg_temp.chunk(d date, st text, is_dry boolean, age interval) RETURNS void LANGUAGE sql AS $$
  INSERT INTO capture_landing_chunks(user_id, t_from, t_to, state, dry, created_at)
  VALUES ('00000000-0000-4000-8000-0000000000a1', d::timestamp AT TIME ZONE 'America/Los_Angeles',
          (d + 1)::timestamp AT TIME ZONE 'America/Los_Angeles', st, is_dry, now() - age) $$;
CREATE FUNCTION pg_temp.st(d date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.capture_day_replan_state('00000000-0000-4000-8000-0000000000a1', d) $$;

-- before: a dry preview on a never-planned day blocks it (the bug)
SELECT pg_temp.chunk('2017-07-15', 'planned', true, interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.st('2017-07-15')->>'reason' = 'plan_pending', 'before: a dry chunk blocks the day');

\i supabase/migrations/20261113120800_capture_replan_ignore_dry_chunks.sql

-- after: the dry preview is ignored
SELECT pg_temp.assert_true(pg_temp.st('2017-07-15')->>'reason' = 'never_planned' AND (pg_temp.st('2017-07-15')->>'blocked')::boolean = false,
  'after: a dry chunk alone leaves the day never_planned');
-- a dry preview newer than a real applied plan: the real plan decides
SELECT pg_temp.chunk('2017-07-16', 'applied', false, interval '2 hours');
SELECT pg_temp.chunk('2017-07-16', 'planned', true, interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.st('2017-07-16')->>'reason' = 'last_plan_applied', 'a newer dry chunk does not mask the real last plan');
-- real pending plans still block
SELECT pg_temp.chunk('2017-07-17', 'awaiting_gate', false, interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.st('2017-07-17')->>'reason' = 'plan_pending' AND (pg_temp.st('2017-07-17')->>'blocked')::boolean,
  'a real chunk awaiting the gate still blocks');
SELECT pg_temp.chunk('2017-07-18', 'planned', false, interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.st('2017-07-18')->>'reason' = 'plan_pending', 'a real planned chunk still blocks');
-- a refused real plan with no new evidence still blocks, even with a newer dry preview
SELECT pg_temp.chunk('2017-07-19', 'gate_failed', false, interval '2 hours');
SELECT pg_temp.chunk('2017-07-19', 'planned', true, interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.st('2017-07-19')->>'reason' = 'refused_no_new_evidence', 'refusal backoff unchanged');
-- null dry is treated as a real chunk
SELECT pg_temp.chunk('2017-07-20', 'planned', NULL, interval '1 hour');
SELECT pg_temp.assert_true(pg_temp.st('2017-07-20')->>'reason' = 'plan_pending', 'null dry counts as real');

\i supabase/sql/revert_20261113120800_capture_replan_ignore_dry_chunks.sql
SELECT pg_temp.assert_true(pg_temp.st('2017-07-15')->>'reason' = 'plan_pending', 'revert restores the prior behaviour');
SELECT 'capture replan ignore dry chunks contract: ok' AS result;

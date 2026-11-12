-- Contract: 20261116243000 photos in an open review, or already marked wrong
-- on a visual pre_gate for the same vehicle, never enter a clear landing set.
-- Disposable DB only (dm_refinement_capture_no_clear_held%).
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_no_clear_held%' THEN
    RAISE EXCEPTION 'refusing: not a disposable contract database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.capture_landing_config (
  id int primary key default 1 check (id = 1),
  user_id uuid not null,
  enabled boolean not null default false,
  halted boolean not null default false,
  halt_reason text,
  forward_cursor timestamptz,
  chunk_days int not null default 30,
  recent_days int not null default 7,
  min_score numeric not null default 2.5,
  min_margin numeric not null default 1.0,
  plan_budget_seconds int not null default 40,
  apply_batch_sets int not null default 10,
  protected_vehicle_ids uuid[] not null default '{}'::uuid[],
  updated_at timestamptz not null default now()
);
CREATE TABLE public.capture_landing_chunks (
  id uuid primary key default gen_random_uuid(),
  track text not null,
  pass int not null default 1,
  user_id uuid not null,
  t_from timestamptz not null,
  t_to timestamptz not null,
  dry boolean not null default false,
  state text not null default 'planning',
  run_id uuid not null default gen_random_uuid(),
  plan_cursor timestamptz,
  stats jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE TABLE public.capture_landing_sets (
  chunk_id uuid not null references capture_landing_chunks(id) on delete cascade,
  set_key text not null,
  t0 timestamptz not null, t1 timestamptz not null,
  vehicle_id uuid,
  image_ids uuid[] not null, filed_ids uuid[] not null default '{}',
  cells text[] not null default '{}',
  score numeric, margin numeric,
  decision text not null check (decision in ('clear','review')),
  reason text,
  top3 jsonb,
  applied_at timestamptz, apply_result text,
  primary key (chunk_id, set_key)
);
CREATE TABLE public.vehicle_images (
  id uuid primary key,
  user_id uuid,
  vehicle_id uuid,
  taken_at timestamptz,
  latitude numeric,
  longitude numeric,
  ai_scan_metadata jsonb
);
CREATE TABLE public.capture_set_review (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  user_id uuid not null,
  set_key text not null,
  image_ids uuid[] not null,
  confidence numeric not null default 0,
  basis text,
  reason text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
CREATE TABLE public.auto_filing_audit_queue (
  id bigint primary key generated always as identity,
  image_id uuid,
  vehicle_id uuid,
  source text,
  run_id text,
  queued_at timestamptz default now(),
  status text,
  reason text,
  verified_at timestamptz
);
CREATE FUNCTION public.capture_landing_set_identity_conflict(p_vehicle uuid, p_ids uuid[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

INSERT INTO capture_landing_config (id, user_id) VALUES (1, '00000000-0000-4000-8000-0000000000aa');

-- f1 typ=other; f2 fresh exterior; f3 held exterior; f4 prior-wrong exterior
INSERT INTO vehicle_images VALUES
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000aa', NULL,
   '2026-11-04 12:00:00+00', NULL, NULL, '{"classification":{"image_type":"other"}}'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000aa', NULL,
   '2026-11-04 12:01:00+00', NULL, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000aa', NULL,
   '2026-11-04 12:02:00+00', NULL, NULL, '{"classification":{"image_type":"vehicle_exterior"}}'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000aa', NULL,
   '2026-11-04 12:03:00+00', NULL, NULL, '{"classification":{"image_type":"vehicle_exterior"}}');

INSERT INTO capture_set_review (user_id, set_key, image_ids, confidence, reason, status)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'open:held',
        ARRAY['00000000-0000-4000-8000-0000000000f3'::uuid], 0, 'no_clear_lead', 'open');

INSERT INTO auto_filing_audit_queue (image_id, vehicle_id, source, status, verified_at, reason)
VALUES ('00000000-0000-4000-8000-0000000000f4', '724204a1-535d-4c1b-9b3b-0cb2688f461f',
        'pre_gate', 'wrong', '2026-11-07 12:00:00+00', 'key tag, not the scored vehicle');

CREATE TABLE pg_temp.score_stub (kind text);
INSERT INTO pg_temp.score_stub VALUES ('fresh');

CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[], p_prov jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
 LANGUAGE sql STABLE AS $function$
  SELECT 'set:day', '2026-11-04 12:00:00+00'::timestamptz, '2026-11-04 12:03:00+00'::timestamptz,
         CASE (SELECT kind FROM pg_temp.score_stub)
           WHEN 'other_only' THEN ARRAY['00000000-0000-4000-8000-0000000000f1'::uuid]
           WHEN 'held_only' THEN ARRAY['00000000-0000-4000-8000-0000000000f3'::uuid]
           WHEN 'wrong_only' THEN ARRAY['00000000-0000-4000-8000-0000000000f4'::uuid]
           WHEN 'mixed' THEN ARRAY['00000000-0000-4000-8000-0000000000f2'::uuid,
                                   '00000000-0000-4000-8000-0000000000f3'::uuid,
                                   '00000000-0000-4000-8000-0000000000f4'::uuid]
           ELSE ARRAY['00000000-0000-4000-8000-0000000000f2'::uuid] END,
         '{}'::uuid[], '724204a1-535d-4c1b-9b3b-0cb2688f461f'::uuid, 1,
         jsonb_build_object('score', 6.29, 'margin_raw', 6.18, 'visual', 0, 'vin', 3, 'plate', 0, 'badge', 0, 'model', 1)
$function$;

\i supabase/sql/helpers/capture_landing_plan_step_live_parent_20261116243000.sql
SELECT pg_temp.assert_true(
  md5(prosrc) = '34f8d002ffaa8fd09400986694b272cd',
  'parent plan_step prosrc matches live 12 Nov body')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'capture_landing_plan_step';

INSERT INTO capture_landing_chunks (id, track, user_id, t_from, t_to, state)
VALUES ('00000000-0000-4000-8000-0000000000c1', 'forward', '00000000-0000-4000-8000-0000000000aa',
        '2026-11-03 10:00:00+00', '2026-11-04 10:00:00+00', 'planning');

-- Pre-migration: a photo already in an open review still clears (the 6748ad5b defect).
UPDATE pg_temp.score_stub SET kind = 'held_only';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'clear' AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000f3'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'pre-migration held exterior still clears');

\i supabase/migrations/20261116243000_capture_no_clear_held_or_wrong.sql
SELECT pg_temp.assert_true(position('20261116243000' in
  pg_get_functiondef('public.capture_landing_plan_step(uuid,integer)'::regprocedure)) > 0,
  'plan_step carries 20261116243000 marker');

-- Held-only set becomes review.
DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'review' AND reason = 'already_held_or_prior_wrong'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000f3'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'held-only set is review/already_held_or_prior_wrong');

-- Prior-wrong-only set becomes review.
UPDATE pg_temp.score_stub SET kind = 'wrong_only';
DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'review' AND reason = 'already_held_or_prior_wrong'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000f4'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'prior-wrong-only set is review/already_held_or_prior_wrong');

-- typ=other-only stays non_vehicle_type (typ patch intact).
UPDATE pg_temp.score_stub SET kind = 'other_only';
DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'review' AND reason = 'non_vehicle_type'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000f1'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'typ=other-only set stays review/non_vehicle_type');

-- Mixed: fresh exterior + held + prior-wrong -> clear keeps only the fresh frame.
UPDATE pg_temp.score_stub SET kind = 'mixed';
DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'clear'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000f2'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'mixed set clears with only the fresh exterior');

-- A fresh exterior with no hold and no prior wrong still clears.
UPDATE pg_temp.score_stub SET kind = 'fresh';
DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'clear'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000f2'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'fresh exterior still clears');

\i supabase/sql/revert_20261116243000_capture_no_clear_held_or_wrong.sql
SELECT pg_temp.assert_true(
  md5(prosrc) = '34f8d002ffaa8fd09400986694b272cd',
  'revert restored the parent plan_step prosrc')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'capture_landing_plan_step';
SELECT pg_temp.assert_true(position('20261116243000' in
  pg_get_functiondef('public.capture_landing_plan_step(uuid,integer)'::regprocedure)) = 0,
  'revert removed the 20261116243000 marker');

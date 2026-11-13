-- Contract: 20261115123000 typ=other / receipt_document never enter a clear set.
-- Disposable DB only (dm_refinement_capture_no_clear%).
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_no_clear%' THEN
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

INSERT INTO capture_landing_config (id, user_id) VALUES (1, '00000000-0000-4000-8000-0000000000aa');
INSERT INTO vehicle_images VALUES
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000aa', NULL,
   '2026-02-18 12:00:00+00', NULL, NULL, '{"classification":{"image_type":"other"}}'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000aa', NULL,
   '2026-02-18 12:01:00+00', NULL, NULL, '{"classification":{"image_type":"exterior"}}');

CREATE TABLE pg_temp.score_stub (kind text);
INSERT INTO pg_temp.score_stub VALUES ('passport_only');

CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[], p_prov jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
 LANGUAGE sql STABLE AS $function$
  SELECT 'set:passport', '2026-02-18 12:00:00+00'::timestamptz, '2026-02-18 12:00:00+00'::timestamptz,
         CASE WHEN (SELECT kind FROM pg_temp.score_stub) = 'mixed'
              THEN ARRAY['00000000-0000-4000-8000-0000000000b1'::uuid,'00000000-0000-4000-8000-0000000000b2'::uuid]
              ELSE ARRAY['00000000-0000-4000-8000-0000000000b1'::uuid] END,
         '{}'::uuid[], '724204a1-535d-4c1b-9b3b-0cb2688f461f'::uuid, 1,
         jsonb_build_object('score', 2.5, 'margin_raw', 2.243, 'visual', 2.5, 'vin', 0, 'plate', 0, 'badge', 0, 'model', 0)
  WHERE (SELECT kind FROM pg_temp.score_stub) IN ('passport_only','mixed')
$function$;

\i supabase/sql/live_capture_landing_plan_step_20261110.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.capture_landing_plan_step(uuid,integer)'::regprocedure))
    = '7567ec597d417ee6e217b04e2872e0ba',
  'installed live plan_step body matches recorded md5');

INSERT INTO capture_landing_chunks (id, track, user_id, t_from, t_to, state)
VALUES ('00000000-0000-4000-8000-0000000000c1', 'manual', '00000000-0000-4000-8000-0000000000aa',
        '2026-02-18 00:00:00-08', '2026-02-19 00:00:00-08', 'planning');

-- Pre-migration: a typ=other passport with visual evidence clears (the 2026-02-18 defect).
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'clear' AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000b1'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'pre-migration typ=other passport clears');

-- Install the recorded live score body so the typ migration can patch the blocked line, then the migration.
\i supabase/sql/live_capture_sets_score_20261110.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.capture_sets_score(uuid,timestamptz,timestamptz,text,uuid[],jsonb)'::regprocedure))
    = '08c95280a4f8888d5276aaab8ec2f204',
  'installed live score body matches recorded md5');

\i supabase/migrations/20261115123000_capture_no_clear_non_vehicle_type.sql
SELECT pg_temp.assert_true(position('(20261115123000)' in
  pg_get_functiondef('public.capture_sets_score(uuid,timestamptz,timestamptz,text,uuid[],jsonb)'::regprocedure)) > 0,
  'score carries typ-blocked marker');
SELECT pg_temp.assert_true(position('non_vehicle_type' in
  pg_get_functiondef('public.capture_landing_plan_step(uuid,integer)'::regprocedure)) > 0,
  'plan_step carries non_vehicle_type reason');

-- Restore the stub scorer (plan_step is already patched) and re-plan.
CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[], p_prov jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
 LANGUAGE sql STABLE AS $function$
  SELECT 'set:passport', '2026-02-18 12:00:00+00'::timestamptz, '2026-02-18 12:00:00+00'::timestamptz,
         CASE WHEN (SELECT kind FROM pg_temp.score_stub) = 'mixed'
              THEN ARRAY['00000000-0000-4000-8000-0000000000b1'::uuid,'00000000-0000-4000-8000-0000000000b2'::uuid]
              ELSE ARRAY['00000000-0000-4000-8000-0000000000b1'::uuid] END,
         '{}'::uuid[], '724204a1-535d-4c1b-9b3b-0cb2688f461f'::uuid, 1,
         jsonb_build_object('score', 2.5, 'margin_raw', 2.243, 'visual', 2.5, 'vin', 0, 'plate', 0, 'badge', 0, 'model', 0)
  WHERE (SELECT kind FROM pg_temp.score_stub) IN ('passport_only','mixed')
$function$;

DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'review' AND reason = 'non_vehicle_type'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000b1'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'after typ patch, typ=other-only set is review/non_vehicle_type');

-- Mixed set: typ=other + exterior. Clear set keeps only the exterior frame.
UPDATE pg_temp.score_stub SET kind = 'mixed';
DELETE FROM capture_landing_sets;
UPDATE capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
 WHERE id = '00000000-0000-4000-8000-0000000000c1';
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40);
SELECT pg_temp.assert_true(
  (SELECT decision = 'clear'
      AND image_ids = ARRAY['00000000-0000-4000-8000-0000000000b2'::uuid]
     FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1'),
  'mixed set clears with typ=other stripped');

\i supabase/sql/revert_20261115123000_capture_no_clear_non_vehicle_type.sql
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.capture_landing_plan_step(uuid,integer)'::regprocedure))
    = '7567ec597d417ee6e217b04e2872e0ba',
  'revert restored the pre-patch plan_step md5');
SELECT pg_temp.assert_true(
  md5(pg_get_functiondef('public.capture_sets_score(uuid,timestamptz,timestamptz,text,uuid[],jsonb)'::regprocedure))
    = '08c95280a4f8888d5276aaab8ec2f204',
  'revert restored the pre-patch score md5');

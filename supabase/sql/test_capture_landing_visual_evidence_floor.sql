-- Contract: 20261123234500 visual evidence floor. A set clears only when the winner has
-- vin/plate/badge/model > 0, or visual >= 1.0 and visual_margin >= 0.25 (required when visual
-- is the only photo leg). Otherwise review with weak_visual or priors_only. The 2.5 / 1.0 bar
-- is unchanged. The signed redecide moves still-unapplied awaiting_gate clears under that rule
-- to review, does not file, and reverts by run.
-- Disposable DB only (dm_refinement_capture_landing_visual_evidence%).
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_visual_evidence%' THEN
    RAISE EXCEPTION 'refusing: not a disposable contract database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
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
  track text not null default 'manual',
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
  ai_scan_metadata jsonb,
  ai_processing_status text
);
CREATE TABLE public.capture_set_review (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  user_id uuid not null,
  set_key text not null,
  image_ids uuid[] not null,
  from_vehicle_id uuid,
  to_vehicle_id uuid,
  confidence numeric not null default 0,
  basis text,
  evidence jsonb,
  reason text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  unique (run_id, set_key)
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

-- One day, eight synthetic sets (rank-1 winners; a rank-2 exists so margin_raw is meaningful).
--   S_priors:     session+cell only, visual 0, score 3.5 / margin 3.5          -> review, priors_only
--   S_crumb:      visual 0.278 / margin 0.009 + session/cell, score 3.056      -> review, weak_visual (the Corvette case)
--   S_thin_vis:   visual 2.5 / visual_margin 0.11, score 3.445                  -> review, weak_visual (the hauler case)
--   S_visual:     visual 2.0 / visual_margin 0.50, score 3.0 / margin 2.0       -> clear
--   S_model:      model 1.0, visual 0, score 3.5 / margin 3.0                   -> clear (identity, no visual_margin needed)
--   S_plate_thin: plate 3.0, visual 2.0 / visual_margin 0.05, score 5.0 / 2.0   -> clear (identity present)
--   S_below:      visual 2.0 / visual_margin 0.50, score 2.3 / margin 1.2       -> review, score_below_threshold (bar unchanged)
--   S_margin:     plate 3.0, score 5.5 / margin 0.5                            -> review, no_clear_lead (bar unchanged)
CREATE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamptz, p_to timestamptz, p_mode text DEFAULT 'live', p_only_imgs uuid[] DEFAULT NULL, p_prov jsonb DEFAULT NULL)
RETURNS TABLE (set_key text, t0 timestamptz, t1 timestamptz, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    ('S_priors', '2026-03-01 10:00+00'::timestamptz, '2026-03-01 10:05+00'::timestamptz,
      ARRAY['00000000-0000-4000-8000-000000000011'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score":3.5,"margin_raw":3.5,"visual":0,"visual_margin":0,"vin":0,"plate":0,"badge":0,"model":0,"session":2.5,"cell":1.0}'::jsonb),
    ('S_crumb', '2026-03-01 10:10+00','2026-03-01 10:15+00',
      ARRAY['00000000-0000-4000-8000-000000000012'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score":3.056,"margin_raw":3.056,"visual":0.278,"visual_margin":0.0089,"vin":0,"plate":0,"badge":0,"model":0,"session":1.25,"cell":1.0,"prev_day":0.379,"recent":0.15}'::jsonb),
    ('S_thin_vis', '2026-03-01 10:20+00','2026-03-01 10:25+00',
      ARRAY['00000000-0000-4000-8000-000000000013'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 1,
      '{"score":3.445,"margin_raw":3.445,"visual":2.5,"visual_margin":0.1066,"vin":0,"plate":0,"badge":0,"model":0,"work_session":0.6}'::jsonb),
    ('S_visual', '2026-03-01 10:30+00','2026-03-01 10:35+00',
      ARRAY['00000000-0000-4000-8000-000000000014'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score":3.0,"margin_raw":2.0,"visual":2.0,"visual_margin":0.50,"vin":0,"plate":0,"badge":0,"model":0,"session":1.0}'::jsonb),
    ('S_model', '2026-03-01 10:40+00','2026-03-01 10:45+00',
      ARRAY['00000000-0000-4000-8000-000000000015'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 1,
      '{"score":3.5,"margin_raw":3.0,"visual":0,"visual_margin":0,"vin":0,"plate":0,"badge":0,"model":1.0,"session":2.5}'::jsonb),
    ('S_plate_thin', '2026-03-01 10:50+00','2026-03-01 10:55+00',
      ARRAY['00000000-0000-4000-8000-000000000016'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score":5.0,"margin_raw":2.0,"visual":2.0,"visual_margin":0.05,"vin":0,"plate":3.0,"badge":0,"model":0}'::jsonb),
    ('S_below', '2026-03-01 11:00+00','2026-03-01 11:05+00',
      ARRAY['00000000-0000-4000-8000-000000000017'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score":2.3,"margin_raw":1.2,"visual":2.0,"visual_margin":0.50,"vin":0,"plate":0,"badge":0,"model":0}'::jsonb),
    ('S_margin', '2026-03-01 11:10+00','2026-03-01 11:15+00',
      ARRAY['00000000-0000-4000-8000-000000000018'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b1'::uuid, 1,
      '{"score":5.5,"margin_raw":0.5,"visual":0,"visual_margin":0,"vin":0,"plate":3.0,"badge":0,"model":0,"session":2.5}'::jsonb)
  ) AS v(set_key, t0, t1, image_ids, filed_ids, vehicle_id, rank, signals)
  WHERE p_user = '00000000-0000-4000-8000-0000000000aa'::uuid AND v.t0 >= p_from AND v.t0 < p_to
$$;

INSERT INTO vehicle_images (id, user_id, taken_at, ai_scan_metadata, ai_processing_status) VALUES
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 10:00+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 10:10+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 10:20+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 10:30+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 10:40+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 10:50+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 11:00+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed'),
 ('00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 11:10+00', '{"classification":{"image_type":"vehicle_exterior"}}', 'completed');

-- Install the live parent body, then the migration (md5-guarded replace).
\i supabase/sql/helpers/capture_landing_plan_step_parent_20261123234500.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = '6f8a5cef85f325e4fced48023908b4a9', 'parent body is the 2026-11-23 live plan_step')
  FROM pg_proc p WHERE p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');

\i supabase/migrations/20261123234500_capture_landing_visual_evidence_floor.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = '6ef112d20600756350a78e4deb0ef93b', 'migration installed the visual evidence floor body')
  FROM pg_proc p WHERE p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');

-- Helpers, including the two live false-clear signal shapes (no photos, no coordinates).
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"vin":1}') IS TRUE, 'vin is evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"plate":0.1}') IS TRUE, 'plate is evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"badge":0.1}') IS TRUE, 'badge is evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"model":1}') IS TRUE, 'model is evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"visual":2.0,"visual_margin":0.25}') IS TRUE, 'visual at the floor with margin 0.25 is evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"visual":0.999,"visual_margin":1}') IS FALSE, 'visual just under 1.0 is not evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"visual":2.0,"visual_margin":0.249}') IS FALSE, 'visual without the 0.25 margin is not evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"visual":2.0}') IS FALSE, 'visual without visual_margin is not evidence');
SELECT pg_temp.assert_true(public.capture_landing_has_photo_evidence('{"visual":2.0,"visual_margin":0.05,"plate":3}') IS TRUE, 'identity does not need visual_margin');
SELECT pg_temp.assert_true(public.capture_landing_photo_evidence_gap('{"visual":0.278,"visual_margin":0.0089}') = 'weak_visual', 'Corvette-like crumb is weak_visual');
SELECT pg_temp.assert_true(public.capture_landing_photo_evidence_gap('{"visual":2.5,"visual_margin":0.1066}') = 'weak_visual', 'hauler-like thin visual margin is weak_visual');
SELECT pg_temp.assert_true(public.capture_landing_photo_evidence_gap('{"session":2.5,"cell":1.0}') = 'priors_only', 'priors only');
SELECT pg_temp.assert_true(public.capture_landing_photo_evidence_gap('{"visual":2.0,"visual_margin":0.5}') IS NULL, 'strong visual has no gap');

INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, state)
VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000aa', '2026-03-01 00:00+00', '2026-03-02 00:00+00', 'planning');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1', 40) AS r \gset
SELECT pg_temp.assert_true((:'r')::jsonb->>'done' = 'true', 'the chunk is planned in one step');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_landing_sets WHERE chunk_id = '00000000-0000-4000-8000-0000000000c1') = 8, 'one row per set');

SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'S_priors') = 'review:priors_only', 'priors only stay held');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'S_crumb') = 'review:weak_visual', 'crumb visual is weak_visual, not clear');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'S_thin_vis') = 'review:weak_visual', 'thin visual margin is weak_visual, not clear');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'S_visual') = 'clear' AND (SELECT reason FROM capture_landing_sets WHERE set_key = 'S_visual') IS NULL, 'visual at the floor clears');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'S_model') = 'clear', 'a model leg clears');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'S_plate_thin') = 'clear', 'a plate leg clears even with a thin visual margin');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'S_below') = 'review:score_below_threshold', 'the 2.5 bar is unchanged');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'S_margin') = 'review:no_clear_lead', 'the 1.0 margin bar is unchanged');
SELECT pg_temp.assert_true((SELECT (stats->>'clear_sets')::int FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000c1') = 3, 'three clear sets');

-- Redecide: two awaiting_gate clears that fail the new rule (the live shapes), plus one that still passes, plus the reserved chunk.
INSERT INTO capture_landing_chunks (id, user_id, t_from, t_to, dry, state, run_id, note) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa', '2019-09-26 07:00+00', '2019-09-27 07:00+00', false, 'awaiting_gate', '9d127a26-b97e-4aee-afb0-f9652d3db51f', 'gate'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000aa', '2017-09-21 07:00+00', '2017-09-22 07:00+00', false, 'awaiting_gate', 'ae38b1d1-44df-4b02-8579-e56cf375db99', 'gate'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000aa', '2026-03-02 00:00+00', '2026-03-03 00:00+00', false, 'awaiting_gate', '00000000-0000-4000-8000-0000000000d3', 'still clear'),
  ('9cf5b7a4-57db-4460-a8ee-434c77428a33', '00000000-0000-4000-8000-0000000000aa', '2019-09-24 07:00+00', '2019-09-25 07:00+00', false, 'awaiting_gate', '00000000-0000-4000-8000-000000000099', 'reserved');

INSERT INTO capture_landing_sets (chunk_id, set_key, t0, t1, vehicle_id, image_ids, score, margin, decision, reason, top3) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'corvette-day', '2019-09-26 08:00+00', '2019-09-26 18:00+00',
   '00000000-0000-4000-8000-0000000000b1', ARRAY['00000000-0000-4000-8000-000000000012'::uuid], 3.056, 3.056, 'clear', null,
   '[{"rank":1,"signals":{"score":3.056,"margin_raw":3.056,"visual":0.278,"visual_margin":0.0089,"vin":0,"plate":0,"badge":0,"model":0,"session":1.25,"cell":1.0}}]'::jsonb),
  ('00000000-0000-4000-8000-0000000000a2', 'hauler-day', '2017-09-21 08:00+00', '2017-09-21 18:00+00',
   '00000000-0000-4000-8000-0000000000b2', ARRAY['00000000-0000-4000-8000-000000000013'::uuid], 3.445, 3.445, 'clear', null,
   '[{"rank":1,"signals":{"score":3.445,"margin_raw":3.445,"visual":2.5,"visual_margin":0.1066,"vin":0,"plate":0,"badge":0,"model":0}}]'::jsonb),
  ('00000000-0000-4000-8000-0000000000a3', 'ok-visual', '2026-03-02 08:00+00', '2026-03-02 18:00+00',
   '00000000-0000-4000-8000-0000000000b1', ARRAY['00000000-0000-4000-8000-000000000014'::uuid], 3.0, 2.0, 'clear', null,
   '[{"rank":1,"signals":{"score":3.0,"margin_raw":2.0,"visual":2.0,"visual_margin":0.5,"vin":0,"plate":0,"badge":0,"model":0}}]'::jsonb),
  ('9cf5b7a4-57db-4460-a8ee-434c77428a33', 'reserved', '2019-09-24 08:00+00', '2019-09-24 18:00+00',
   '00000000-0000-4000-8000-0000000000b1', ARRAY['00000000-0000-4000-8000-000000000011'::uuid], 3.056, 3.056, 'clear', null,
   '[{"rank":1,"signals":{"score":3.056,"margin_raw":3.056,"visual":0.278,"visual_margin":0.0089,"vin":0,"plate":0,"badge":0,"model":0}}]'::jsonb);

SELECT public.capture_landing_visual_evidence_redecide_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ee', true, 50) AS dry \gset
SELECT pg_temp.assert_true((:'dry')::jsonb->>'dry_run' = 'true' AND (:'dry')::jsonb->>'would_redecide' = '2', 'dry run names the two failing clears and no others');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'corvette-day') = 'clear', 'dry run does not write');

SELECT public.capture_landing_visual_evidence_redecide_v1('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000ee', false, 50) AS live \gset
SELECT pg_temp.assert_true((:'live')::jsonb->>'dry_run' = 'false' AND (:'live')::jsonb->>'redecided' = '2' AND (:'live')::jsonb->>'chunks_closed' = '2', 'two sets redecided, both chunks closed');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'corvette-day') = 'review:weak_visual', 'Corvette-like set is held weak_visual');
SELECT pg_temp.assert_true((SELECT decision || ':' || reason FROM capture_landing_sets WHERE set_key = 'hauler-day') = 'review:weak_visual', 'hauler-like set is held weak_visual');
SELECT pg_temp.assert_true((SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'applied', 'Corvette chunk is applied after redecide');
SELECT pg_temp.assert_true((SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000a2') = 'applied', 'hauler chunk is applied after redecide');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'ok-visual') = 'clear'
  AND (SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000a3') = 'awaiting_gate', 'a still-valid clear is untouched');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'reserved') = 'clear'
  AND (SELECT state FROM capture_landing_chunks WHERE id = '9cf5b7a4-57db-4460-a8ee-434c77428a33') = 'awaiting_gate', '9cf5b7a4 is not touched');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE evidence->>'redecide_run' = '00000000-0000-4000-8000-0000000000ee') = 2, 'two review rows');
SELECT pg_temp.assert_true((SELECT applied_at IS NULL FROM capture_landing_sets WHERE set_key = 'corvette-day'), 'nothing was filed');

SELECT pg_temp.assert_true(public.capture_landing_visual_evidence_redecide_revert_v1('00000000-0000-4000-8000-0000000000ee') = 2, 'revert returns 2');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'corvette-day') = 'clear'
  AND (SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'awaiting_gate', 'revert restores the Corvette clear and gate wait');
SELECT pg_temp.assert_true((SELECT decision FROM capture_landing_sets WHERE set_key = 'hauler-day') = 'clear'
  AND (SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000a2') = 'awaiting_gate', 'revert restores the hauler clear and gate wait');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_set_review WHERE evidence->>'redecide_run' = '00000000-0000-4000-8000-0000000000ee') = 0, 'review rows are removed');

-- Revert of the plan_step body itself.
\i supabase/sql/revert_20261123234500_capture_landing_visual_evidence_floor.sql
SELECT pg_temp.assert_true(md5(p.prosrc) = '6f8a5cef85f325e4fced48023908b4a9', 'sql revert restores the parent plan_step')
  FROM pg_proc p WHERE p.oid = to_regprocedure('public.capture_landing_plan_step(uuid,integer)');

\echo TEST_EXIT:0

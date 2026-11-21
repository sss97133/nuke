-- Contract: 20261120184500 a photo nobody has read (no image type; pending, processing or failed) joins no
-- capture set and is never stored on a clear set. Both functions are production's own bodies of 2026-11-20: the plan
-- step runs for real against a stub scorer, and the scorer's blocked rule is cut out of its patched text and evaluated.
-- Disposable DB only (dm_refinement_capture_unread%). The fixture below is the 20261116243000 contract's.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_unread%' THEN
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


-- ===== this contract's own part =====================================================================================
-- the plan step as production holds it: the 12 Nov parent plus 20261116243000
\i supabase/sql/helpers/capture_landing_plan_step_live_parent_20261116243000.sql
\i supabase/migrations/20261116243000_capture_no_clear_held_or_wrong.sql

CREATE FUNCTION pg_temp.fn_md5() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(p.proname, md5(p.prosrc)) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('capture_sets_score', 'capture_landing_plan_step') $$;
CREATE TEMP TABLE md5_at (label text PRIMARY KEY, v jsonb NOT NULL);
SELECT pg_temp.assert_true(pg_temp.fn_md5() ->> 'capture_landing_plan_step' = '5695e2f8306f012fa5dacb0b34a35140',
  'the plan step in this fixture is production''s body of 2026-11-20');

-- the columns the two rules read, and one photo per state. e1, e2, e8 are waiting for their first read; ea is a photo
-- whose read gave up without leaving a type.
ALTER TABLE public.vehicle_images ADD COLUMN ai_processing_status text, ADD COLUMN is_duplicate boolean,
  ADD COLUMN is_superseded boolean, ADD COLUMN is_sensitive boolean, ADD COLUMN vision_gate_status text;
INSERT INTO public.vehicle_images (id, user_id, taken_at, ai_scan_metadata, ai_processing_status) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:10:00+00', '{}', 'pending'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:11:00+00', NULL, 'processing'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:12:00+00', '{}', 'skipped'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:13:00+00', '{"on_device_vision":{"is_vehicle":true}}', 'completed'),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:14:00+00', '{"classification":{"image_type":"vehicle_exterior","classifier_ok":true}}', 'completed'),
  ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:15:00+00', '{"classification":{"image_type":"vehicle_exterior","classifier_ok":true}}', 'pending'),
  ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:16:00+00', '{"classifier_failed":true,"classification":{"image_type":"other","confidence":0,"classifier_ok":false}}', 'pending'),
  ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:17:00+00', '{"on_device_vision":{"is_vehicle":true}}', 'pending'),
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:18:00+00', '{}', NULL),
  ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:19:00+00', '{"pipeline_error":"pipeline_operation_failed","retry":{"attempt":3}}', 'failed'),
  ('00000000-0000-4000-8000-0000000000eb', '00000000-0000-4000-8000-0000000000aa', '2026-11-04 12:19:30+00', '{"classifier_failed":true,"classification":{"image_type":"vehicle_interior","classifier_ok":true}}', 'failed');

-- a stub scorer that hands the plan step one set with evidence (vin 3, model 1), its photos chosen by kind
CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_mode text DEFAULT 'live'::text, p_only_imgs uuid[] DEFAULT NULL::uuid[], p_prov jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
 LANGUAGE sql STABLE AS $function$
  SELECT 'set:day', '2026-11-04 12:00:00+00'::timestamptz, '2026-11-04 12:20:00+00'::timestamptz,
         CASE (SELECT kind FROM pg_temp.score_stub)
           WHEN 'unread' THEN ARRAY['00000000-0000-4000-8000-0000000000e1'::uuid]
           WHEN 'unread_processing' THEN ARRAY['00000000-0000-4000-8000-0000000000e2'::uuid]
           WHEN 'unread_with_phone_tags' THEN ARRAY['00000000-0000-4000-8000-0000000000e8'::uuid]
           WHEN 'skipped_untyped' THEN ARRAY['00000000-0000-4000-8000-0000000000e3'::uuid]
           WHEN 'completed_untyped' THEN ARRAY['00000000-0000-4000-8000-0000000000e4'::uuid]
           WHEN 'null_status' THEN ARRAY['00000000-0000-4000-8000-0000000000e9'::uuid]
           WHEN 'failed_untyped' THEN ARRAY['00000000-0000-4000-8000-0000000000ea'::uuid]
           WHEN 'failed_typed' THEN ARRAY['00000000-0000-4000-8000-0000000000eb'::uuid]
           WHEN 'read' THEN ARRAY['00000000-0000-4000-8000-0000000000e5'::uuid]
           WHEN 'read_still_pending' THEN ARRAY['00000000-0000-4000-8000-0000000000e6'::uuid]
           WHEN 'standin' THEN ARRAY['00000000-0000-4000-8000-0000000000e7'::uuid]
           WHEN 'mixed' THEN ARRAY['00000000-0000-4000-8000-0000000000e1'::uuid, '00000000-0000-4000-8000-0000000000e2'::uuid,
                                   '00000000-0000-4000-8000-0000000000e8'::uuid, '00000000-0000-4000-8000-0000000000e5'::uuid,
                                   '00000000-0000-4000-8000-0000000000f2'::uuid]
           ELSE ARRAY['00000000-0000-4000-8000-0000000000f2'::uuid] END,
         '{}'::uuid[], '724204a1-535d-4c1b-9b3b-0cb2688f461f'::uuid, 1,
         jsonb_build_object('score', 6.29, 'margin_raw', 6.18, 'visual', 0, 'vin', 3, 'plate', 0, 'badge', 0, 'model', 1)
$function$;
CREATE TEMP TABLE stub_def AS
SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE p.proname = 'capture_sets_score' AND p.pronamespace = 'public'::regnamespace;

INSERT INTO public.capture_landing_chunks (id, track, user_id, t_from, t_to, state)
VALUES ('00000000-0000-4000-8000-0000000000c1', 'forward', '00000000-0000-4000-8000-0000000000aa',
        '2026-11-04 10:00:00+00', '2026-11-05 10:00:00+00', 'planning');

-- plan the chunk afresh with the stub answering p_kind; the one stored set, photos named by their last two characters
CREATE FUNCTION pg_temp.replan(p_kind text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  UPDATE pg_temp.score_stub SET kind = p_kind;
  DELETE FROM public.capture_landing_sets;
  UPDATE public.capture_landing_chunks SET state = 'planning', plan_cursor = NULL, stats = '{}'::jsonb
   WHERE id = '00000000-0000-4000-8000-0000000000c1';
  PERFORM public.capture_landing_plan_step('00000000-0000-4000-8000-0000000000c1'::uuid, 40);
  SELECT jsonb_build_object('decision', s.decision, 'reason', s.reason,
           'ids', (SELECT jsonb_agg(right(u.x::text, 2) ORDER BY u.ord) FROM unnest(s.image_ids) WITH ORDINALITY u(x, ord)))
    INTO r FROM public.capture_landing_sets s WHERE s.chunk_id = '00000000-0000-4000-8000-0000000000c1';
  RETURN r;
END $$;

-- the scorer's own blocked rule, cut out of the function as installed and evaluated over the fixture's photos:
-- the photos it blocks, by their last two characters
CREATE FUNCTION pg_temp.scorer_blocked() RETURNS text LANGUAGE plpgsql AS $$
DECLARE def text; a int; b int; res text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname = 'capture_sets_score' AND p.pronamespace = 'public'::regnamespace;
  a := position('coalesce(vi.is_duplicate,false)' in def);
  b := position('blocked,' in def);
  IF a = 0 OR b <= a THEN RAISE EXCEPTION 'blocked expression not found in the scorer'; END IF;
  EXECUTE format(E'select coalesce(string_agg(right(q.id::text, 2), '','' order by q.id), '''') from (select vi.id, (%s\n) as blocked from public.vehicle_images vi) q where q.blocked',
                 substring(def from a for b - a)) INTO res;
  RETURN res;
END $$;

-- ===== 0. before: the gap
SELECT pg_temp.assert_true(pg_temp.replan('unread') = '{"decision":"clear","reason":null,"ids":["e1"]}'::jsonb,
  'before: a photo nobody has read is stored on a clear set');
SELECT pg_temp.assert_true(pg_temp.replan('standin') = '{"decision":"review","reason":"non_vehicle_type","ids":["e7"]}'::jsonb,
  'before: the provider''s stand-in answer is what kept an unread photo off a clear set');

-- ===== 1. the scorer: production's body, its blocked rule before and after, replay and revert
\i supabase/sql/helpers/capture_sets_score_live_parent_20261120184500.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() = jsonb_build_object('capture_sets_score', '8dab6a891c97faca68d185f38cc608bf', 'capture_landing_plan_step', '5695e2f8306f012fa5dacb0b34a35140'),
  'both functions in this fixture are production''s bodies of 2026-11-20');
INSERT INTO md5_at VALUES ('parent', pg_temp.fn_md5());
SELECT pg_temp.assert_true(pg_temp.scorer_blocked() = 'e7,f1',
  'before: the scorer blocks the stand-in and the typed non-vehicle photo, and no photo that is waiting for its read');

\i supabase/migrations/20261120184500_capture_unread_photo_in_no_set.sql
INSERT INTO md5_at VALUES ('patched', pg_temp.fn_md5());
SELECT pg_temp.assert_true((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('capture_sets_score', 'capture_landing_plan_step')
     AND (length(p.prosrc) - length(replace(p.prosrc, '(20261120184500)', ''))) / length('(20261120184500)') = 1) = 2
  AND (SELECT a.v ->> 'capture_sets_score' <> b.v ->> 'capture_sets_score' AND a.v ->> 'capture_landing_plan_step' <> b.v ->> 'capture_landing_plan_step'
         FROM md5_at a, md5_at b WHERE a.label = 'parent' AND b.label = 'patched'),
  'both functions changed and each carries the marker once');
SELECT pg_temp.assert_true(pg_temp.scorer_blocked() = 'e1,e2,e7,e8,ea,f1',
  'after: pending, processing or failed with no image type is blocked; skipped, completed, null-status and typed photos (a typed failed one too) are as they were');

\i supabase/migrations/20261120184500_capture_unread_photo_in_no_set.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() = (SELECT v FROM md5_at WHERE label = 'patched'), 'a second apply changes nothing');

\i supabase/sql/revert_20261120184500_capture_unread_photo_in_no_set.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() = (SELECT v FROM md5_at WHERE label = 'parent'), 'the revert restores both of production''s bodies');
SELECT pg_temp.assert_true(pg_temp.scorer_blocked() = 'e7,f1', 'reverted: the scorer''s rule is the old one');
\i supabase/sql/revert_20261120184500_capture_unread_photo_in_no_set.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() = (SELECT v FROM md5_at WHERE label = 'parent'), 'a second revert changes nothing');

-- a plan step whose snippet has moved is refused, and the scorer patched a moment earlier in the same transaction is
-- rolled back with it (the one statement in this contract that is meant to fail)
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p WHERE p.proname = 'capture_landing_plan_step' AND p.pronamespace = 'public'::regnamespace;
  EXECUTE replace(def, 'and not exists (', 'and  not exists (');
END $$;
INSERT INTO md5_at VALUES ('drifted', pg_temp.fn_md5());
SELECT pg_temp.assert_true((SELECT a.v ->> 'capture_landing_plan_step' <> b.v ->> 'capture_landing_plan_step' AND a.v ->> 'capture_sets_score' = b.v ->> 'capture_sets_score'
                              FROM md5_at a, md5_at b WHERE a.label = 'parent' AND b.label = 'drifted'), 'the fixture''s plan step drifted');
\set ON_ERROR_STOP off
\i supabase/migrations/20261120184500_capture_unread_photo_in_no_set.sql
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(pg_temp.fn_md5() = (SELECT v FROM md5_at WHERE label = 'drifted'),
  'a plan step whose snippet moved is refused, and the scorer is rolled back with it');
\i supabase/sql/helpers/capture_landing_plan_step_live_parent_20261116243000.sql
\i supabase/migrations/20261116243000_capture_no_clear_held_or_wrong.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() = (SELECT v FROM md5_at WHERE label = 'parent'), 'production''s plan step is back in the fixture');

\i supabase/migrations/20261120184500_capture_unread_photo_in_no_set.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() = (SELECT v FROM md5_at WHERE label = 'patched'), 're-applying gives the same patched bodies');

-- ===== 2. the plan step, for real, against the stub scorer
DO $$ BEGIN EXECUTE (SELECT def FROM stub_def); END $$;
SELECT pg_temp.assert_true(pg_temp.replan('unread') - 'reason' = '{"decision":"review","ids":["e1"]}'::jsonb,
  'a pending photo with no image type is not stored on a clear set');
SELECT pg_temp.assert_true(pg_temp.replan('unread_processing') - 'reason' = '{"decision":"review","ids":["e2"]}'::jsonb,
  'nor a processing one with no metadata at all');
SELECT pg_temp.assert_true(pg_temp.replan('unread_with_phone_tags') - 'reason' = '{"decision":"review","ids":["e8"]}'::jsonb,
  'nor a pending one that holds only the phone''s own tags');
SELECT pg_temp.assert_true(pg_temp.replan('failed_untyped') - 'reason' = '{"decision":"review","ids":["ea"]}'::jsonb,
  'nor one whose read gave up and left no type');
SELECT pg_temp.assert_true(pg_temp.replan('failed_typed') = '{"decision":"clear","reason":null,"ids":["eb"]}'::jsonb,
  'a failed photo that does hold a type is as it was');
SELECT pg_temp.assert_true(pg_temp.replan('mixed') = '{"decision":"clear","reason":null,"ids":["f2","e5"]}'::jsonb,
  'a mixed set clears with only its read photos');
SELECT pg_temp.assert_true(pg_temp.replan('read') = '{"decision":"clear","reason":null,"ids":["e5"]}'::jsonb,
  'a read photo clears as before');
SELECT pg_temp.assert_true(pg_temp.replan('read_still_pending') = '{"decision":"clear","reason":null,"ids":["e6"]}'::jsonb,
  'a photo that holds an image type clears whatever its status');
SELECT pg_temp.assert_true(pg_temp.replan('standin') = '{"decision":"review","reason":"non_vehicle_type","ids":["e7"]}'::jsonb,
  'the stand-in answer is held for the same reason as before');
-- not judged by this migration: untyped photos that are skipped, completed or carry no status stand as they did
SELECT pg_temp.assert_true(pg_temp.replan('skipped_untyped') = '{"decision":"clear","reason":null,"ids":["e3"]}'::jsonb
  AND pg_temp.replan('completed_untyped') = '{"decision":"clear","reason":null,"ids":["e4"]}'::jsonb
  AND pg_temp.replan('null_status') = '{"decision":"clear","reason":null,"ids":["e9"]}'::jsonb,
  'skipped, completed and null-status photos without a type are unchanged');
SELECT pg_temp.assert_true(pg_temp.replan('fresh') = '{"decision":"clear","reason":null,"ids":["f2"]}'::jsonb,
  'the 11-16 contract''s fresh photo still clears');

-- ===== 3. with the stub scorer installed the revert leaves it alone and restores the plan step
\i supabase/sql/revert_20261120184500_capture_unread_photo_in_no_set.sql
SELECT pg_temp.assert_true(pg_temp.fn_md5() ->> 'capture_landing_plan_step' = '5695e2f8306f012fa5dacb0b34a35140'
  AND (SELECT pg_get_functiondef(p.oid) = (SELECT def FROM stub_def) FROM pg_proc p WHERE p.proname = 'capture_sets_score' AND p.pronamespace = 'public'::regnamespace),
  'the revert restores the plan step and leaves a scorer without the marker alone');
SELECT pg_temp.assert_true(pg_temp.replan('unread') = '{"decision":"clear","reason":null,"ids":["e1"]}'::jsonb,
  'reverted: the gap is back, so the plan-step rule is what closed it');

\echo 'capture unread photo in no set contract passed'

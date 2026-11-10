-- Contract: 20261115160000 — 0-clear forward finalize advances forward_cursor;
-- a gate-passed apply still does too; a manual 0-clear finalize does not.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_finalize_forward_cursor%' THEN
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
  id integer PRIMARY KEY DEFAULT 1,
  user_id uuid,
  forward_cursor timestamptz,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.capture_landing_chunks (
  id uuid PRIMARY KEY,
  user_id uuid,
  track text,
  state text,
  dry boolean DEFAULT false,
  t_from timestamptz,
  t_to timestamptz,
  run_id uuid,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.capture_landing_sets (
  chunk_id uuid,
  set_key text,
  t0 timestamptz,
  t1 timestamptz,
  vehicle_id uuid,
  image_ids uuid[],
  filed_ids uuid[] DEFAULT '{}',
  cells text[] DEFAULT '{}',
  score numeric,
  margin numeric,
  decision text,
  reason text,
  top3 jsonb DEFAULT '[]',
  PRIMARY KEY (chunk_id, set_key)
);
CREATE TABLE public.capture_set_review (
  run_id uuid,
  user_id uuid,
  set_key text,
  image_ids uuid[],
  to_vehicle_id uuid,
  confidence numeric,
  basis text,
  evidence jsonb,
  reason text,
  status text DEFAULT 'open',
  PRIMARY KEY (run_id, set_key)
);
CREATE TABLE public.auto_filing_audit_queue (
  id bigserial PRIMARY KEY,
  image_id uuid,
  vehicle_id uuid,
  source text,
  run_id text,
  reason text
);
CREATE TABLE public.filing_run_gate (
  run_id text PRIMARY KEY,
  planned_n int,
  required_n int,
  passed boolean DEFAULT false,
  note text
);
CREATE FUNCTION public.record_capture_set_candidates(p_run uuid, p_user uuid, p_basis text, p_cands jsonb)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;

-- Pre-patch finalize_plan: the live n_clear=0 block, no cursor move.
CREATE FUNCTION public.capture_landing_finalize_plan(p_chunk uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '120s'
AS $function$
declare c capture_landing_chunks; cands jsonb; n_clear int; n_ph int; req int; q int; g jsonb;
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  if c.state <> 'planned' or c.dry then return jsonb_build_object('chunk', p_chunk, 'state', c.state, 'skipped', true); end if;
  select count(*), coalesce(sum(cardinality(image_ids)),0) into n_clear, n_ph from capture_landing_sets where chunk_id = c.id and decision = 'clear';
  insert into capture_set_review (run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason)
  select c.run_id, c.user_id, s.set_key, s.image_ids, s.vehicle_id, round(1/(1+exp(-coalesce(s.score,0)+2)),3), 'scored_session',
         jsonb_build_object('top3', s.top3, 'scorer', 'v3'), s.reason
  from capture_landing_sets s where s.chunk_id = c.id and s.decision = 'review'
  on conflict (run_id, set_key) do nothing;
  select coalesce(jsonb_agg(jsonb_build_object('set_key', s.set_key, 'image_ids', to_jsonb(s.image_ids), 'vehicle_id', t->>'vehicle_id',
        'rank', (t->>'rank')::int,
        'combined', 0, 'margin', 0, 'band', 'weak', 'signals', t->'signals')), '[]'::jsonb) into cands
  from capture_landing_sets s cross join lateral jsonb_array_elements(coalesce(s.top3,'[]')) t where s.chunk_id = c.id;
  perform record_capture_set_candidates(c.run_id, c.user_id, 'scored_session_v1', cands);
  if n_clear = 0 then
    update capture_landing_chunks set state = 'applied', note = 'no set passed the score threshold; all held as proposals (capture_set_review)', updated_at = now() where id = c.id;
    return jsonb_build_object('chunk', c.id, 'state', 'applied', 'clear_sets', 0);
  end if;
  req := least(10, n_ph::int);
  insert into auto_filing_audit_queue (image_id, vehicle_id, source, run_id, reason)
  select z.img, z.vid, 'pre_gate', c.run_id::text, z.set_key
  from (select i.img, s.vehicle_id vid, s.set_key
        from capture_landing_sets s cross join lateral unnest(s.image_ids) i(img)
        where s.chunk_id = c.id and s.decision = 'clear') z
  limit req
  on conflict do nothing;
  get diagnostics q = row_count;
  insert into filing_run_gate (run_id, planned_n, required_n, note) values (c.run_id::text, n_ph::int, req, 'awaiting visual verification')
  on conflict (run_id) do update set planned_n = excluded.planned_n, required_n = excluded.required_n, passed = false, note = 're-enqueued';
  update capture_landing_chunks set state = 'awaiting_gate', updated_at = now() where id = c.id;
  return jsonb_build_object('chunk', c.id, 'state', 'awaiting_gate', 'clear_sets', n_clear, 'clear_photos', n_ph, 'gate_sample', q, 'gate_run', c.run_id);
end $function$;

-- Gate-passed apply still advances the cursor the same way apply_chunk does live.
CREATE FUNCTION public.capture_landing_apply_chunk(p_chunk uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare c capture_landing_chunks;
begin
  select * into c from capture_landing_chunks where id = p_chunk for update;
  update capture_landing_chunks set state = 'applied', updated_at = now() where id = c.id;
  if c.track = 'forward' then update capture_landing_config set forward_cursor = c.t_to, updated_at = now() where id = 1; end if;
  return jsonb_build_object('chunk', c.id, 'state', 'applied');
end $function$;

INSERT INTO public.capture_landing_config (id, user_id, forward_cursor)
VALUES (1, '00000000-0000-4000-8000-0000000000aa', '2026-10-28 10:00:00+00');

-- A: 0-clear forward chunk (the 11:40 AST 2026-11-10 case)
INSERT INTO public.capture_landing_chunks (id, user_id, track, state, dry, t_from, t_to, run_id)
VALUES ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000aa',
        'forward', 'planned', false, '2026-10-28 10:00:00+00', '2026-11-03 10:00:00+00',
        '00000000-0000-4000-8000-000000000011');
INSERT INTO public.capture_landing_sets (chunk_id, set_key, vehicle_id, image_ids, score, margin, decision, reason, top3)
VALUES ('00000000-0000-4000-8000-0000000000f1', 'S_review', '00000000-0000-4000-8000-0000000000b1',
        ARRAY['00000000-0000-4000-8000-0000000000d1'::uuid], 0.77, 0.44, 'review', 'no_clear_lead', '[]'::jsonb);

-- B: 0-clear manual
INSERT INTO public.capture_landing_chunks (id, user_id, track, state, dry, t_from, t_to, run_id)
VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa',
        'manual', 'planned', false, '2019-09-24 07:00:00+00', '2019-09-25 07:00:00+00',
        '00000000-0000-4000-8000-000000000012');

-- C: forward chunk ready for a gate-passed apply
INSERT INTO public.capture_landing_chunks (id, user_id, track, state, dry, t_from, t_to, run_id)
VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000aa',
        'forward', 'applying', false, '2026-11-03 10:00:00+00', '2026-11-04 10:00:00+00',
        '00000000-0000-4000-8000-000000000013');

-- Pre-patch: 0-clear forward finalize must NOT move the cursor (the defect).
SELECT public.capture_landing_finalize_plan('00000000-0000-4000-8000-0000000000f1');
SELECT pg_temp.assert_true(
  (SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'applied'
  AND (SELECT forward_cursor FROM capture_landing_config WHERE id = 1) = '2026-10-28 10:00:00+00',
  'pre-patch 0-clear forward finalize leaves forward_cursor unmoved');
UPDATE capture_landing_chunks SET state = 'planned' WHERE id = '00000000-0000-4000-8000-0000000000f1';

\i supabase/migrations/20261115160000_capture_landing_finalize_forward_cursor.sql

SELECT public.capture_landing_finalize_plan('00000000-0000-4000-8000-0000000000f1');
SELECT pg_temp.assert_true(
  (SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000f1') = 'applied'
  AND (SELECT forward_cursor FROM capture_landing_config WHERE id = 1) = '2026-11-03 10:00:00+00',
  '0-clear forward finalize advances forward_cursor to t_to');

-- Manual 0-clear must not move the (now advanced) cursor.
SELECT public.capture_landing_finalize_plan('00000000-0000-4000-8000-0000000000e1');
SELECT pg_temp.assert_true(
  (SELECT state FROM capture_landing_chunks WHERE id = '00000000-0000-4000-8000-0000000000e1') = 'applied'
  AND (SELECT forward_cursor FROM capture_landing_config WHERE id = 1) = '2026-11-03 10:00:00+00',
  '0-clear manual finalize does not move forward_cursor');

-- Gate-passed apply still advances as before.
UPDATE capture_landing_config SET forward_cursor = '2026-11-03 10:00:00+00' WHERE id = 1;
SELECT public.capture_landing_apply_chunk('00000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.assert_true(
  (SELECT forward_cursor FROM capture_landing_config WHERE id = 1) = '2026-11-04 10:00:00+00',
  'gate-passed apply_chunk still advances forward_cursor to t_to');

\i supabase/sql/revert_20261115160000_capture_landing_finalize_forward_cursor.sql
SELECT pg_temp.assert_true(
  position('(20261115160000)' in pg_get_functiondef('public.capture_landing_finalize_plan(uuid)'::regprocedure)) = 0,
  'revert removes the 20261115160000 marker');

-- After revert, a 0-clear forward finalize no longer moves the cursor.
UPDATE capture_landing_config SET forward_cursor = '2026-10-28 10:00:00+00' WHERE id = 1;
UPDATE capture_landing_chunks SET state = 'planned' WHERE id = '00000000-0000-4000-8000-0000000000f1';
SELECT public.capture_landing_finalize_plan('00000000-0000-4000-8000-0000000000f1');
SELECT pg_temp.assert_true(
  (SELECT forward_cursor FROM capture_landing_config WHERE id = 1) = '2026-10-28 10:00:00+00',
  'after revert, 0-clear forward finalize leaves forward_cursor unmoved');

\i supabase/migrations/20261115160000_capture_landing_finalize_forward_cursor.sql
UPDATE capture_landing_chunks SET state = 'planned' WHERE id = '00000000-0000-4000-8000-0000000000f1';
SELECT public.capture_landing_finalize_plan('00000000-0000-4000-8000-0000000000f1');
SELECT pg_temp.assert_true(
  (SELECT forward_cursor FROM capture_landing_config WHERE id = 1) = '2026-11-03 10:00:00+00',
  're-apply is idempotent and again advances the cursor');

SELECT 'capture landing finalize forward cursor contract: ok' AS result;

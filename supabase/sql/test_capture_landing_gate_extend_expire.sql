-- Contract: 20261115170000 gate extend + all-unclear expire. Disposable DB only.
-- Covers: dry writes nothing; extend unused only and never shrinks required_n;
-- viewed unclears stay; chunk state unchanged; expire fully-sampled only to
-- review/gate_undecided + applied and does not file; skips unused / mixed marks;
-- both reverts restore; over-cap writes nothing; grants.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_landing_gate_extend_expire%' THEN
    RAISE EXCEPTION 'refusing: not a disposable contract database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

CREATE TABLE public.capture_landing_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track text DEFAULT 'manual',
  pass int DEFAULT 1,
  user_id uuid,
  t_from timestamptz,
  t_to timestamptz,
  dry boolean DEFAULT false,
  state text CHECK (state IN ('planning','planned','awaiting_gate','applying','applied','gate_failed','empty','superseded')),
  run_id uuid DEFAULT gen_random_uuid(),
  plan_cursor timestamptz,
  stats jsonb DEFAULT '{}',
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
  top3 jsonb,
  PRIMARY KEY (chunk_id, set_key)
);
CREATE TABLE public.filing_run_gate (
  run_id text PRIMARY KEY,
  planned_n int,
  required_n int,
  correct int,
  wrong int,
  unclear int,
  error_rate numeric,
  passed boolean DEFAULT false,
  note text
);
CREATE TABLE public.auto_filing_audit_queue (
  id bigserial PRIMARY KEY,
  image_id uuid NOT NULL,
  vehicle_id uuid,
  source text,
  run_id text,
  queued_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','correct','wrong','unclear'])),
  reason text,
  UNIQUE (image_id, run_id)
);
CREATE TABLE public.capture_set_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  user_id uuid,
  set_key text,
  image_ids uuid[],
  to_vehicle_id uuid,
  confidence numeric,
  basis text,
  evidence jsonb,
  reason text,
  status text NOT NULL DEFAULT 'open',
  UNIQUE (run_id, set_key)
);
CREATE TABLE public.capture_set_links (
  id bigserial PRIMARY KEY,
  run_id uuid,
  set_key text,
  image_id uuid,
  vehicle_id uuid
);

\i supabase/migrations/20261115170000_capture_landing_gate_extend_expire.sql

SELECT pg_temp.assert_true(
  NOT has_function_privilege('anon', 'public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.capture_landing_gate_expire_all_unclear_v1(uuid, uuid, boolean, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.capture_landing_gate_expire_all_unclear_revert_v1(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer)', 'EXECUTE'),
  'grants: service_role only');
SELECT pg_temp.assert_true(
  position('(20261115170000)' IN pg_get_functiondef('public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer)'::regprocedure)) > 0
  AND position('(20261115170000)' IN pg_get_functiondef('public.capture_landing_gate_expire_all_unclear_v1(uuid, uuid, boolean, integer)'::regprocedure)) > 0,
  'markers landed');

CREATE FUNCTION pg_temp.u() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-0000000000aa'::uuid $$;
CREATE FUNCTION pg_temp.i(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.cid(x text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-0000000000' || x)::uuid $$;
CREATE FUNCTION pg_temp.rid(x text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('11111111-0000-4000-8000-0000000000' || x)::uuid $$;

-- A: extendable all-unclear (10 unclear + 3 unused), required_n=10
-- B: fully sampled all-unclear (2 photos, both unclear, required_n=2)
-- C: all-unclear but has a correct mark — neither path
-- D: has unused but also pending — neither path
-- E: other user, fully sampled — neither path for p_user
INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, state, run_id, note)
VALUES
  (pg_temp.cid('a1'), pg_temp.u(), '2026-06-09', '2026-06-10', 'awaiting_gate', pg_temp.rid('a1'), 'gate A'),
  (pg_temp.cid('b1'), pg_temp.u(), '2026-08-25', '2026-08-26', 'awaiting_gate', pg_temp.rid('b1'), 'gate B'),
  (pg_temp.cid('c1'), pg_temp.u(), '2026-08-26', '2026-08-27', 'awaiting_gate', pg_temp.rid('c1'), 'gate C'),
  (pg_temp.cid('d1'), pg_temp.u(), '2026-08-27', '2026-08-28', 'awaiting_gate', pg_temp.rid('d1'), 'gate D'),
  (pg_temp.cid('e1'), '00000000-0000-4000-8000-0000000000bb', '2026-08-28', '2026-08-29', 'awaiting_gate', pg_temp.rid('e1'), 'gate E');

INSERT INTO capture_landing_sets(chunk_id, set_key, vehicle_id, image_ids, score, margin, decision, reason)
SELECT pg_temp.cid('a1'), 's-a-'||n, pg_temp.i(90), ARRAY[pg_temp.i(n)], 3.0, 1.2, 'clear', null
FROM generate_series(1,13) n;
INSERT INTO capture_landing_sets(chunk_id, set_key, vehicle_id, image_ids, score, margin, decision, reason)
VALUES
  (pg_temp.cid('b1'), 's-b-1', pg_temp.i(91), ARRAY[pg_temp.i(21), pg_temp.i(22)], 3.1, 1.3, 'clear', null),
  (pg_temp.cid('c1'), 's-c-1', pg_temp.i(92), ARRAY[pg_temp.i(31)], 3.1, 1.3, 'clear', null),
  (pg_temp.cid('d1'), 's-d-1', pg_temp.i(93), ARRAY[pg_temp.i(41), pg_temp.i(42)], 3.1, 1.3, 'clear', null),
  (pg_temp.cid('e1'), 's-e-1', pg_temp.i(94), ARRAY[pg_temp.i(51)], 3.1, 1.3, 'clear', null);

INSERT INTO filing_run_gate(run_id, planned_n, required_n, correct, wrong, unclear, error_rate, passed)
VALUES
  (pg_temp.rid('a1')::text, 13, 10, 0, 0, 10, null, false),
  (pg_temp.rid('b1')::text, 2, 2, 0, 0, 2, null, false),
  (pg_temp.rid('c1')::text, 1, 1, 1, 0, 0, 0, false),
  (pg_temp.rid('d1')::text, 2, 1, 0, 0, 1, null, false),
  (pg_temp.rid('e1')::text, 1, 1, 0, 0, 1, null, false);

INSERT INTO auto_filing_audit_queue(image_id, vehicle_id, source, run_id, status)
SELECT pg_temp.i(n), pg_temp.i(90), 'pre_gate', pg_temp.rid('a1')::text, 'unclear' FROM generate_series(1,10) n;
INSERT INTO auto_filing_audit_queue(image_id, vehicle_id, source, run_id, status)
VALUES
  (pg_temp.i(21), pg_temp.i(91), 'pre_gate', pg_temp.rid('b1')::text, 'unclear'),
  (pg_temp.i(22), pg_temp.i(91), 'pre_gate', pg_temp.rid('b1')::text, 'unclear'),
  (pg_temp.i(31), pg_temp.i(92), 'pre_gate', pg_temp.rid('c1')::text, 'correct'),
  (pg_temp.i(41), pg_temp.i(93), 'pre_gate', pg_temp.rid('d1')::text, 'pending'),
  (pg_temp.i(51), pg_temp.i(94), 'pre_gate', pg_temp.rid('e1')::text, 'unclear');

-- dry extend: A only, no writes
SELECT public.capture_landing_gate_extend_v1(pg_temp.u(), 'e0000000-0000-4000-8000-0000000000d1', true, 50) AS r \gset
SELECT pg_temp.assert_true((:'r'::jsonb->>'dry_run')::boolean AND (:'r'::jsonb->>'would_extend')::int = 1
  AND (:'r'::jsonb->>'unused_photos')::int = 3 AND (SELECT count(*) FROM auto_filing_audit_queue WHERE status='pending' AND run_id=pg_temp.rid('a1')::text)=0,
  'dry extend reports A only and writes nothing');

-- live extend
SELECT public.capture_landing_gate_extend_v1(pg_temp.u(), 'e0000000-0000-4000-8000-0000000000a1', false, 50) AS r \gset
SELECT pg_temp.assert_true((:'r'::jsonb->>'extended')::int = 1 AND (:'r'::jsonb->>'queued')::int = 3, 'live extend queues 3 unused');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM auto_filing_audit_queue WHERE run_id=pg_temp.rid('a1')::text AND status='pending') = 3
  AND (SELECT count(*) FROM auto_filing_audit_queue WHERE run_id=pg_temp.rid('a1')::text AND status='unclear') = 10
  AND (SELECT required_n FROM filing_run_gate WHERE run_id=pg_temp.rid('a1')::text) = 10
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('a1')) = 'awaiting_gate'
  AND (SELECT array_agg(image_id ORDER BY image_id) FROM auto_filing_audit_queue WHERE run_id=pg_temp.rid('a1')::text AND status='pending')
      = ARRAY[pg_temp.i(11), pg_temp.i(12), pg_temp.i(13)],
  'extend: unused pending only, required_n stays 10, unclears and state untouched');

-- expire dry: B only (A now has pending so no longer all-unclear; C/D/E ineligible)
SELECT public.capture_landing_gate_expire_all_unclear_v1(pg_temp.u(), 'e0000000-0000-4000-8000-0000000000d2', true, 50) AS r \gset
SELECT pg_temp.assert_true((:'r'::jsonb->>'dry_run')::boolean AND (:'r'::jsonb->>'would_expire')::int = 1
  AND :'r'::jsonb->'items'->0->>'chunk' = pg_temp.cid('b1')::text
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('b1')) = 'awaiting_gate'
  AND (SELECT count(*) FROM capture_set_review)=0,
  'dry expire reports B only and writes nothing');

-- live expire
SELECT public.capture_landing_gate_expire_all_unclear_v1(pg_temp.u(), 'e0000000-0000-4000-8000-0000000000b1', false, 50) AS r \gset
SELECT pg_temp.assert_true((:'r'::jsonb->>'expired')::int = 1, 'live expire expires 1 chunk');
SELECT pg_temp.assert_true(
  (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('b1')) = 'applied'
  AND (SELECT decision FROM capture_landing_sets WHERE chunk_id=pg_temp.cid('b1') AND set_key='s-b-1') = 'review'
  AND (SELECT reason FROM capture_landing_sets WHERE chunk_id=pg_temp.cid('b1') AND set_key='s-b-1') = 'gate_undecided'
  AND (SELECT count(*) FROM capture_set_review WHERE run_id=pg_temp.rid('b1') AND reason='gate_undecided' AND status='open') = 1
  AND (SELECT count(*) FROM capture_set_links) = 0
  AND (SELECT required_n FROM filing_run_gate WHERE run_id=pg_temp.rid('b1')::text) = 2
  AND (SELECT count(*) FROM auto_filing_audit_queue WHERE run_id=pg_temp.rid('b1')::text AND status='unclear') = 2
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('c1')) = 'awaiting_gate'
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('d1')) = 'awaiting_gate'
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('e1')) = 'awaiting_gate',
  'expire: B to review/applied, no file, C/D/E untouched, samples left');

-- revert expire
SELECT public.capture_landing_gate_expire_all_unclear_revert_v1('e0000000-0000-4000-8000-0000000000b1') AS n \gset
SELECT pg_temp.assert_true(:'n'::int = 1
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('b1')) = 'awaiting_gate'
  AND (SELECT note FROM capture_landing_chunks WHERE id=pg_temp.cid('b1')) = 'gate B'
  AND (SELECT decision FROM capture_landing_sets WHERE chunk_id=pg_temp.cid('b1')) = 'clear'
  AND (SELECT reason FROM capture_landing_sets WHERE chunk_id=pg_temp.cid('b1')) IS NULL
  AND (SELECT count(*) FROM capture_set_review) = 0,
  'expire revert restores awaiting_gate, clear set, and drops review rows');

-- revert extend
SELECT public.capture_landing_gate_extend_revert_v1('e0000000-0000-4000-8000-0000000000a1') AS n \gset
SELECT pg_temp.assert_true(:'n'::int = 1
  AND (SELECT count(*) FROM auto_filing_audit_queue WHERE run_id=pg_temp.rid('a1')::text AND status='pending') = 0
  AND (SELECT count(*) FROM auto_filing_audit_queue WHERE run_id=pg_temp.rid('a1')::text AND status='unclear') = 10
  AND (SELECT required_n FROM filing_run_gate WHERE run_id=pg_temp.rid('a1')::text) = 10
  AND (SELECT state FROM capture_landing_chunks WHERE id=pg_temp.cid('a1')) = 'awaiting_gate',
  'extend revert drops only the new pending rows');

-- over-cap: two extendable after revert (re-seed a second unused all-unclear)
INSERT INTO capture_landing_chunks(id, user_id, t_from, t_to, state, run_id)
VALUES (pg_temp.cid('f1'), pg_temp.u(), '2026-08-30', '2026-08-31', 'awaiting_gate', pg_temp.rid('f1'));
INSERT INTO capture_landing_sets(chunk_id, set_key, vehicle_id, image_ids, score, decision)
VALUES (pg_temp.cid('f1'), 's-f-1', pg_temp.i(95), ARRAY[pg_temp.i(61), pg_temp.i(62)], 3.0, 'clear');
INSERT INTO filing_run_gate(run_id, planned_n, required_n, passed) VALUES (pg_temp.rid('f1')::text, 2, 1, false);
INSERT INTO auto_filing_audit_queue(image_id, vehicle_id, source, run_id, status)
VALUES (pg_temp.i(61), pg_temp.i(95), 'pre_gate', pg_temp.rid('f1')::text, 'unclear');
SELECT public.capture_landing_gate_extend_v1(pg_temp.u(), 'e0000000-0000-4000-8000-0000000000c1', false, 1) AS r \gset
SELECT pg_temp.assert_true((:'r'::jsonb->>'halted_over_cap')::boolean
  AND (:'r'::jsonb->>'written')::int = 0
  AND (SELECT count(*) FROM auto_filing_audit_queue WHERE reason LIKE '%extend=%') = 0,
  'over-cap extend writes nothing');

-- migration revert refuses while unreverted? none now. Apply revert of functions after a dummy expire+revert already done.
-- functions still present; drop via revert script (logs empty/reverted)
\i supabase/sql/revert_20261115170000_capture_landing_gate_extend_expire.sql
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='capture_landing_gate_extend_v1' AND pronamespace='public'::regnamespace)
  AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='capture_landing_gate_extend_log'),
  'migration revert drops functions and log tables');

SELECT 'ok' AS result;

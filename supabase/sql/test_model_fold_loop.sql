-- Contract: 20261124040000_model_fold_loop + 20261124041000_analysis_queue_orphan_reaper.
-- Triggers signal only in-scope, non-excluded vehicles and never fail the host write; the tick folds signalled vehicles
-- with fresh run ids, sweeps the whole scope once per logic key (and again when the key changes), invalidates readings
-- whose text went away, backs off and dead-letters failures, honours backpressure, the circuit and the off switch, and a
-- tick revert puts everything back. The reaper backs rows up before releasing them in batches and its revert restores them.
-- Producers are stubbed with the same signatures as production. Disposable PG17 only, synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- ── production-shaped fixtures ──
CREATE TABLE public.platform_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, year int, vin text, description text, highlights text,
  equipment text, modifications text, numbers_quote text, title text, listing_title text, bat_listing_title text,
  deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.auction_comments(id uuid PRIMARY KEY, auction_event_id uuid, vehicle_id uuid, comment_type text, comment_text text,
  has_question boolean);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, content_text text, is_superseded boolean DEFAULT false);
CREATE TABLE public.field_evidence(id uuid PRIMARY KEY, vehicle_id uuid, proposed_value text, status text);
CREATE TYPE public.vision_gate_status AS ENUM ('pending','filed');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, vision_gate_status public.vision_gate_status DEFAULT 'pending');
CREATE TABLE public.vehicle_decode_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text, make text, code text,
  superseded_at timestamptz);
CREATE TABLE public.vehicle_code_reading_runs(run_id text PRIMARY KEY, status text NOT NULL, reverted_at timestamptz);
CREATE TABLE public.vehicle_code_readings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text, code text,
  origin_table text, origin_id uuid, origin_column text, match_text text, rule_version text, run_id text,
  state text NOT NULL DEFAULT 'active', reverted_at timestamptz);
CREATE UNIQUE INDEX ON public.vehicle_code_readings (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active';
CREATE TABLE public.data_set_runs(run_id text PRIMARY KEY, status text NOT NULL, reverted_at timestamptz);
CREATE TABLE public.data_set_members(id bigserial PRIMARY KEY, run_id text, vehicle_id uuid, set_key text, basis_id uuid,
  state text NOT NULL DEFAULT 'active', superseded_by_run text);
CREATE TABLE public.data_set_member_plan(run_id text, action text, member_id bigint, vehicle_id uuid, set_key text, basis_id uuid);
CREATE TABLE public.analysis_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid UNIQUE, status text NOT NULL,
  worker_id text, claimed_at timestamptz, lease_expires_at timestamptz, lease_token uuid,
  request_revision bigint NOT NULL DEFAULT 0, completed_revision bigint NOT NULL DEFAULT 0);

-- ── producer stubs (production signatures) ──
CREATE FUNCTION public.text_code_matches_v1(p_text text)
RETURNS TABLE(kind text, code text, match_text text, pattern_key text, base_conf numeric) LANGUAGE sql IMMUTABLE AS $$
  SELECT 'paint_code', m[2], m[1], 'paint', 0.8::numeric FROM regexp_matches(coalesce(p_text, ''), '(paint code ([0-9]+))', 'gi') AS m $$;
CREATE FUNCTION public.text_code_rescore_v1(p uuid[]) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.data_set_candidates_v1(p uuid[]) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT unnest(p) $$;
CREATE FUNCTION public.data_set_basis_live(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.text_code_decode_v2(p_run uuid, p_scope text, p_vehicle uuid, p_batch int, p_from int, p_count int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF p_scope <> 'vehicle' OR p_from <> 1 THEN RAISE EXCEPTION 'stub: unexpected call'; END IF;
  IF EXISTS (SELECT 1 FROM vehicle_code_reading_runs WHERE run_id = p_run::text) THEN RAISE EXCEPTION 'run exists'; END IF;
  INSERT INTO vehicle_code_reading_runs VALUES (p_run::text, 'applying');
  IF EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle AND description LIKE '%BOOM%') THEN RAISE EXCEPTION 'stub boom'; END IF;
  -- like production: match text is kept for listing rows, not for comments
  INSERT INTO vehicle_code_readings (vehicle_id, kind, code, origin_table, origin_id, origin_column, match_text, rule_version, run_id)
  SELECT p_vehicle, m.kind, m.code, s.t, s.oid, s.col, CASE WHEN s.t <> 'auction_comments' THEN m.match_text END,
         'text_code_decode_v2', p_run::text FROM (
     SELECT 'vehicles' t, v.id oid, 'description' col, v.description txt FROM vehicles v
      WHERE v.id = p_vehicle AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
     UNION ALL SELECT 'vehicle_observations', o.id, 'content_text', o.content_text FROM vehicle_observations o
      WHERE o.vehicle_id = p_vehicle AND NOT o.is_superseded
     UNION ALL SELECT 'auction_comments', c.id, 'comment_text', c.comment_text FROM auction_comments c
      WHERE c.vehicle_id = p_vehicle AND coalesce(c.comment_type, '') NOT IN ('bid','sold') AND c.has_question IS NOT TRUE) s
   CROSS JOIN LATERAL text_code_matches_v1(s.txt) m
  ON CONFLICT (vehicle_id, kind, code, origin_table, origin_id, origin_column) WHERE state = 'active' DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE vehicle_code_reading_runs SET status = 'applied' WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'inserted_this_slice', n);
END $$;
CREATE FUNCTION public.text_code_decode_revert_v1(p_run uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM vehicle_code_readings WHERE run_id = p_run::text;
  UPDATE vehicle_code_reading_runs SET status = 'reverted', reverted_at = now() WHERE run_id = p_run::text;
  RETURN '{}';
END $$;
CREATE FUNCTION public.data_set_membership_plan_v1(p_run uuid, p_scope text, p_vehicle uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n_add int; n_sup int;
BEGIN
  IF p_scope <> 'vehicle' THEN RAISE EXCEPTION 'stub: unexpected scope'; END IF;
  INSERT INTO data_set_runs VALUES (p_run::text, 'planned');
  INSERT INTO data_set_member_plan (run_id, action, vehicle_id, set_key, basis_id)
  SELECT p_run::text, 'add', r.vehicle_id, r.kind || ':' || r.code, r.id FROM vehicle_code_readings r
   WHERE r.vehicle_id = p_vehicle AND r.state = 'active'
     AND NOT EXISTS (SELECT 1 FROM data_set_members m WHERE m.basis_id = r.id AND m.state = 'active');
  GET DIAGNOSTICS n_add = ROW_COUNT;
  INSERT INTO data_set_member_plan (run_id, action, member_id, vehicle_id)
  SELECT p_run::text, 'supersede', m.id, m.vehicle_id FROM data_set_members m
   WHERE m.vehicle_id = p_vehicle AND m.state = 'active'
     AND NOT EXISTS (SELECT 1 FROM vehicle_code_readings r WHERE r.id = m.basis_id AND r.state = 'active');
  GET DIAGNOSTICS n_sup = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run, 'planned_add', n_add, 'planned_supersede', n_sup);
END $$;
CREATE FUNCTION public.data_set_membership_apply_v1(p_run uuid, p_batch int, p_max_batches int, p_dry boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO data_set_members (run_id, vehicle_id, set_key, basis_id)
  SELECT run_id, vehicle_id, set_key, basis_id FROM data_set_member_plan WHERE run_id = p_run::text AND action = 'add';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE data_set_members m SET state = 'superseded', superseded_by_run = p_run::text
    FROM data_set_member_plan p WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.member_id = m.id;
  UPDATE data_set_runs SET status = 'applied' WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'applied', n);
END $$;
CREATE FUNCTION public.data_set_membership_revert_v1(p_run uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM data_set_members WHERE run_id = p_run::text;
  UPDATE data_set_members SET state = 'active', superseded_by_run = NULL WHERE superseded_by_run = p_run::text;
  UPDATE data_set_runs SET status = 'reverted', reverted_at = now() WHERE run_id = p_run::text;
  RETURN '{}';
END $$;

\set fb1 '''a0000000-0000-4000-8000-000000000001'''
\set fb2 '''a0000000-0000-4000-8000-000000000002'''
\set fb3 '''a0000000-0000-4000-8000-000000000003'''
\set mus '''a0000000-0000-4000-8000-000000000004'''
\set excl '''9cf5b7a4-0000-4000-8000-000000000005'''
\set boom '''a0000000-0000-4000-8000-000000000006'''
\set vinonly '''a0000000-0000-4000-8000-000000000007'''

-- Rows that landed before the loop existed (only the sweep can find these).
INSERT INTO vehicles (id, make, model, year, vin, description) VALUES
  (:fb1, 'Pontiac', 'Firebird Formula', 1973, NULL, 'Body tag shows paint code 75, original.'),
  (:mus, 'Ford', 'Mustang', 1967, NULL, 'paint code 99'),
  (:excl, 'Pontiac', 'Firebird', 1973, NULL, 'paint code 12'),
  (:vinonly, 'Pontiac', NULL, NULL, '2V87X3N100001', 'paint code 24');

\ir ../migrations/20261124040000_model_fold_loop.sql
\ir ../migrations/20261124041000_analysis_queue_orphan_reaper.sql

UPDATE platform_config SET config_value = config_value || '{"settle_seconds":0,"max_delay_seconds":0,"sweep_scan":2,"budget_ms":20000,"min_pass_hours":0}'
 WHERE config_key = 'model_fold';

SELECT t_assert(model_fold_scope_of('Pontiac', 'Trans Am', NULL, 1979) = 'pontiac_f_body'
  AND model_fold_scope_of('Pontiac', NULL, '2V87X3N100001', NULL) = 'pontiac_f_body'
  AND model_fold_scope_of('Pontiac', 'Grand Prix', NULL, 1973) IS NULL, 'scope predicate matches the producer scope');

-- Signals: in-scope only, excluded prefix dropped, comments/events/observations/evidence/photo moves signal.
INSERT INTO vehicles (id, make, model, year, description) VALUES
  (:fb2, 'Pontiac', 'Trans Am', 1979, 'no codes here'),
  (:fb3, 'Pontiac', 'Firebird', 1970, 'paint code 11'),
  ('a0000000-0000-4000-8000-000000000008', 'Ford', 'Mustang', 1968, 'paint code 98');
UPDATE vehicles SET description = 'paint code 13' WHERE id = :excl;
INSERT INTO auction_comments VALUES ('c0000000-0000-4000-8000-000000000001', NULL, :fb2, 'comment', 'Has paint code 55 on the tag', NULL);
SELECT t_assert((SELECT array_agg(DISTINCT vehicle_id ORDER BY vehicle_id) FROM model_fold_signal) = ARRAY[:fb2, :fb3]::uuid[],
  'only in-scope, non-excluded vehicles signal');

UPDATE platform_config SET config_value = config_value || '{"signals_enabled":false}' WHERE config_key = 'model_fold';
INSERT INTO auction_comments VALUES ('c0000000-0000-4000-8000-000000000002', NULL, :fb1, 'comment', 'nice', NULL);
SELECT t_assert((SELECT count(*) FROM model_fold_signal WHERE vehicle_id = :fb1) = 0, 'signals_enabled=false stops signals');
UPDATE platform_config SET config_value = config_value || '{"signals_enabled":true}' WHERE config_key = 'model_fold';
DELETE FROM auction_comments WHERE id = 'c0000000-0000-4000-8000-000000000002';
SELECT t_assert((SELECT count(*) FROM model_fold_signal WHERE vehicle_id = :fb1 AND reason = 'auction_comments_delete') = 1,
  'comment delete signals');
DELETE FROM model_fold_signal WHERE vehicle_id = :fb1;

-- A broken signal path never fails the host write.
ALTER TABLE model_fold_signal RENAME TO model_fold_signal_x;
INSERT INTO auction_comments VALUES ('c0000000-0000-4000-8000-000000000003', NULL, :fb3, 'bid', '$10,000', NULL);
ALTER TABLE model_fold_signal_x RENAME TO model_fold_signal;
SELECT t_assert(EXISTS (SELECT 1 FROM auction_comments WHERE id = 'c0000000-0000-4000-8000-000000000003'), 'signal failure does not fail the write');

-- Tick 1: signals folded with fresh run ids; the sweep starts its chunked snapshot.
CALL model_fold_tick();
SELECT t_assert((SELECT status = 'ok' AND signals = 2 AND folded = 2 FROM model_fold_ticks ORDER BY started_at DESC LIMIT 1), 'first tick folds signalled vehicles');
SELECT t_assert((SELECT count(*) FROM model_fold_signal) = 0, 'signals consumed');
SELECT t_assert(EXISTS (SELECT 1 FROM vehicle_code_readings WHERE vehicle_id = :fb2 AND code = '55' AND origin_table = 'auction_comments')
  AND EXISTS (SELECT 1 FROM vehicle_code_readings WHERE vehicle_id = :fb3 AND code = '11'), 'readings decoded from text');
SELECT t_assert((SELECT count(*) FROM data_set_members WHERE state = 'active' AND vehicle_id IN (:fb2, :fb3)) = 2, 'memberships applied');
SELECT t_assert((SELECT count(*) FROM model_fold_tick_runs r JOIN vehicle_code_reading_runs d ON d.run_id = r.decode_run_id::text
                   JOIN data_set_runs m ON m.run_id = r.membership_run_id::text WHERE d.status = 'applied' AND m.status = 'applied') = 2,
  'each fold logs real producer run ids');

-- Ticks until the snapshot and the first sweep pass complete.
DO $$ BEGIN FOR i IN 1..16 LOOP CALL model_fold_tick(); END LOOP; END $$;
SELECT t_assert((SELECT snapshot_n = 4 AND cycle >= 1 AND verified_key = model_fold_logic_key() FROM model_fold_cursor WHERE scope = 'pontiac_f_body'),
  'snapshot holds the in-scope vehicles and the pass verified the current logic');
SELECT t_assert(EXISTS (SELECT 1 FROM vehicle_code_readings WHERE vehicle_id = :fb1 AND code = '75' AND state = 'active')
  AND EXISTS (SELECT 1 FROM vehicle_code_readings WHERE vehicle_id = :vinonly AND code = '24'), 'sweep folds pre-existing vehicles');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM model_fold_work WHERE vehicle_id IN (:mus, :excl))
  AND NOT EXISTS (SELECT 1 FROM vehicle_code_readings WHERE vehicle_id IN (:mus, :excl)), 'out-of-scope and excluded vehicles are never folded');
SELECT t_assert((SELECT bool_and(state = 'done' AND folded_key = model_fold_logic_key()) FROM model_fold_work), 'all work done under current key');

-- Idle ticks do nothing.
CREATE TEMP TABLE n_runs AS SELECT count(*) n FROM model_fold_tick_runs;
DO $$ BEGIN FOR i IN 1..3 LOOP CALL model_fold_tick(); END LOOP; END $$;
SELECT t_assert((SELECT count(*) FROM model_fold_tick_runs) = (SELECT n FROM n_runs), 'idle ticks create no runs');

-- Invalidation: the text that said paint code 75 is gone, so the reading and its membership go.
UPDATE vehicles SET description = 'Repainted, tag missing.' WHERE id = :fb1;
CALL model_fold_tick();
CREATE TEMP TABLE inv_tick AS SELECT tick_id FROM model_fold_ticks WHERE status = 'ok' ORDER BY started_at DESC LIMIT 1;
SELECT t_assert((SELECT state FROM vehicle_code_readings WHERE vehicle_id = :fb1 AND code = '75') = 'reverted'
  AND NOT EXISTS (SELECT 1 FROM data_set_members WHERE vehicle_id = :fb1 AND state = 'active'), 'stale reading invalidated, membership superseded');
SELECT t_assert((SELECT readings_invalidated = 1 AND members_superseded = 1 FROM model_fold_ticks WHERE tick_id = (SELECT tick_id FROM inv_tick)),
  'tick counts invalidation');

-- Tick revert restores reading and membership.
SELECT model_fold_revert_v1((SELECT tick_id FROM inv_tick));
SELECT t_assert((SELECT state FROM vehicle_code_readings WHERE vehicle_id = :fb1 AND code = '75') = 'active'
  AND EXISTS (SELECT 1 FROM data_set_members WHERE vehicle_id = :fb1 AND state = 'active')
  AND (SELECT status FROM model_fold_ticks WHERE tick_id = (SELECT tick_id FROM inv_tick)) = 'reverted', 'tick revert restores');

-- Photo move signals both vehicles (a09 beside a08).
INSERT INTO vehicle_images VALUES ('d0000000-0000-4000-8000-000000000001', :fb2, 'pending');
UPDATE vehicle_images SET vehicle_id = :fb3 WHERE id = 'd0000000-0000-4000-8000-000000000001';
SELECT t_assert((SELECT array_agg(vehicle_id ORDER BY vehicle_id) FROM model_fold_signal WHERE reason = 'photo_move') = ARRAY[:fb2, :fb3]::uuid[],
  'photo move signals old and new vehicle');
INSERT INTO auction_events VALUES ('e0000000-0000-4000-8000-000000000001', :fb2);
INSERT INTO vehicle_observations VALUES ('f0000000-0000-4000-8000-000000000001', :fb3, 'Dealer page: paint code 66 per tag', false);
INSERT INTO field_evidence VALUES ('f1000000-0000-4000-8000-000000000001', :fb3, 'TH400', 'pending');
SELECT t_assert((SELECT count(DISTINCT reason) FROM model_fold_signal) = 4, 'events, observations and evidence signal');
CALL model_fold_tick();
SELECT t_assert(EXISTS (SELECT 1 FROM vehicle_code_readings WHERE vehicle_id = :fb3 AND code = '66' AND state = 'active'), 'observation text folded');
-- Withdrawn origins: a superseded observation and a comment that became a question.
UPDATE vehicle_observations SET is_superseded = true WHERE id = 'f0000000-0000-4000-8000-000000000001';
UPDATE auction_comments SET has_question = true WHERE id = 'c0000000-0000-4000-8000-000000000001';
SELECT t_assert(EXISTS (SELECT 1 FROM model_fold_signal WHERE vehicle_id = :fb2 AND reason = 'auction_comments_update'), 'question flag change signals');
UPDATE vehicles SET listing_title = '1979 Pontiac Trans Am 6.6' WHERE id = :fb2;
SELECT t_assert(EXISTS (SELECT 1 FROM model_fold_signal WHERE vehicle_id = :fb2 AND reason = 'vehicle_update'), 'title change signals');
SELECT model_fold_signal_ids(ARRAY[:fb3]::uuid[], 'test');
CALL model_fold_tick();
SELECT t_assert((SELECT state FROM vehicle_code_readings WHERE vehicle_id = :fb3 AND code = '66') = 'reverted'
  AND (SELECT state FROM vehicle_code_readings WHERE vehicle_id = :fb2 AND code = '55') = 'reverted', 'withdrawn origins invalidate');
-- Comment readings keep no match text: an edit retires them and the re-decode brings back what the text still says.
INSERT INTO auction_comments VALUES ('c0000000-0000-4000-8000-000000000004', NULL, :fb3, 'comment', 'Tag says paint code 44', NULL);
CALL model_fold_tick();
SELECT t_assert((SELECT count(*) FROM vehicle_code_readings WHERE origin_id = 'c0000000-0000-4000-8000-000000000004' AND state = 'active' AND match_text IS NULL) = 1,
  'comment reading folded without match text');
UPDATE auction_comments SET comment_text = 'Sorry, wrong car.' WHERE id = 'c0000000-0000-4000-8000-000000000004';
SELECT t_assert(EXISTS (SELECT 1 FROM model_fold_signal WHERE reason = 'auction_comment_edit' AND origin_id = 'c0000000-0000-4000-8000-000000000004'), 'comment edit carries its id');
CALL model_fold_tick();
SELECT t_assert(NOT EXISTS (SELECT 1 FROM vehicle_code_readings WHERE origin_id = 'c0000000-0000-4000-8000-000000000004' AND state = 'active'),
  'edited comment no longer supports the reading');
SELECT t_assert((SELECT edited_origins = '{}' FROM model_fold_work WHERE vehicle_id = :fb3), 'edited ids cleared after the fold');
UPDATE auction_comments SET comment_text = 'Checked again: paint code 44 it is.' WHERE id = 'c0000000-0000-4000-8000-000000000004';
CALL model_fold_tick();
SELECT t_assert((SELECT count(*) FROM vehicle_code_readings WHERE origin_id = 'c0000000-0000-4000-8000-000000000004' AND state = 'active') = 1,
  'unchanged code comes back as a fresh reading after an edit');
-- A reading from an origin this check does not know is left alone.
INSERT INTO vehicle_code_readings (vehicle_id, kind, code, origin_table, origin_id, origin_column, match_text, rule_version, run_id)
VALUES (:fb3, 'paint_code', '77', 'vehicles', :fb3, 'some_future_column', 'paint code 77', 'text_code_decode_v2', 'manual');
SELECT model_fold_signal_ids(ARRAY[:fb3]::uuid[], 'test');
CALL model_fold_tick();
SELECT t_assert((SELECT state FROM vehicle_code_readings WHERE code = '77') = 'active', 'unknown origin column untouched');
SELECT t_assert((SELECT count(*) FROM model_fold_ticks WHERE status IN ('ok','reverted') AND readings_invalidated > 0) >= 2, 'invalidations counted');
UPDATE platform_config SET config_value = config_value || '{"decoder":"no_such_fn"}' WHERE config_key = 'model_fold';
SELECT model_fold_signal_ids(ARRAY[:fb3]::uuid[], 'test');
CALL model_fold_tick();
SELECT t_assert((SELECT last_error LIKE '%decoder no_such_fn%' FROM model_fold_work WHERE vehicle_id = :fb3), 'only a real text_code_decode_vN is called');
UPDATE platform_config SET config_value = config_value || '{"decoder":"text_code_decode_v2"}' WHERE config_key = 'model_fold';
UPDATE model_fold_work SET next_attempt_at = now(), attempts = 0 WHERE last_error LIKE '%no_such_fn%';
CALL model_fold_tick();

-- Failure backs off, then dead-letters.
UPDATE platform_config SET config_value = config_value || '{"max_attempts":2}' WHERE config_key = 'model_fold';
INSERT INTO vehicles (id, make, model, year, description) VALUES (:boom, 'Pontiac', 'Firebird', 1971, 'BOOM paint code 33');
CALL model_fold_tick();
SELECT t_assert((SELECT state = 'pending' AND attempts = 1 AND next_attempt_at > now() AND last_error LIKE '%stub boom%' FROM model_fold_work WHERE vehicle_id = :boom),
  'failure backs off');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM vehicle_code_reading_runs r WHERE NOT EXISTS (SELECT 1 FROM model_fold_tick_runs t WHERE t.decode_run_id::text = r.run_id)),
  'a failed fold leaves no partial run');
UPDATE model_fold_work SET next_attempt_at = now() WHERE vehicle_id = :boom;
CALL model_fold_tick();
SELECT t_assert((SELECT state FROM model_fold_work WHERE vehicle_id = :boom) = 'dead', 'dead-lettered after max_attempts');
SELECT t_assert((SELECT status FROM model_fold_ticks ORDER BY started_at DESC LIMIT 1) = 'ok', 'a failing vehicle does not fail the tick');

-- A tick that died mid-fold: next tick marks it stale and backs its vehicle off.
INSERT INTO model_fold_ticks (tick_id, status, pid, started_at) VALUES ('b0000000-0000-4000-8000-000000000001', 'running', 0, now() - interval '1 minute');
UPDATE model_fold_work SET state = 'leased', lease_tick = 'b0000000-0000-4000-8000-000000000001', leased_until = now() + interval '5 minutes', attempts = 1
 WHERE vehicle_id = :fb3;
CALL model_fold_tick();
SELECT t_assert((SELECT status FROM model_fold_ticks WHERE tick_id = 'b0000000-0000-4000-8000-000000000001') = 'stale'
  AND (SELECT state = 'pending' AND next_attempt_at > now() FROM model_fold_work WHERE vehicle_id = :fb3), 'stale tick releases its lease with backoff');

-- A tick that died on this session left its lock and flag: the next tick clears them and ends holding nothing.
SELECT pg_advisory_lock(hashtext('public.model_fold_tick')), pg_advisory_lock(hashtext('public.model_fold_tick')),
       set_config('model_fold.in_tick', 'on', false);
CALL model_fold_tick();
SELECT t_assert(NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid())
  AND coalesce(current_setting('model_fold.in_tick', true), '') = '', 'leftover session lock and flag are cleared');

-- Logic change re-folds the whole scope through the sweep.
CREATE OR REPLACE FUNCTION public.text_code_matches_v1(p_text text)
RETURNS TABLE(kind text, code text, match_text text, pattern_key text, base_conf numeric) LANGUAGE sql IMMUTABLE AS $$
  -- v2
  SELECT 'paint_code', m[2], m[1], 'paint', 0.8::numeric FROM regexp_matches(coalesce(p_text, ''), '(paint code ([0-9]+))', 'gi') AS m $$;
UPDATE model_fold_work SET next_attempt_at = now() WHERE vehicle_id = :fb3;
DO $$ BEGIN FOR i IN 1..8 LOOP CALL model_fold_tick(); END LOOP; END $$;
SELECT t_assert((SELECT bool_and(folded_key = model_fold_logic_key()) FROM model_fold_work WHERE state = 'done')
  AND (SELECT count(*) FROM model_fold_work WHERE state = 'done') = 3
  AND (SELECT state = 'pending' AND next_attempt_at > now() + interval '23 hours' FROM model_fold_work WHERE vehicle_id = :fb1),
  'logic key change re-folds every in-scope vehicle; a reverted vehicle is held for a day');

-- Backpressure, circuit, off switch.
UPDATE platform_config SET config_value = config_value || '{"max_active_backends":-1}' WHERE config_key = 'model_fold';
CALL model_fold_tick();
SELECT t_assert((SELECT status = 'skipped' AND skip_reason LIKE 'active backends%' FROM model_fold_ticks ORDER BY started_at DESC LIMIT 1), 'backpressure skips');
UPDATE platform_config SET config_value = config_value || '{"max_active_backends":60}' WHERE config_key = 'model_fold';
INSERT INTO model_fold_ticks (tick_id, status, started_at, finished_at)
SELECT gen_random_uuid(), 'error', clock_timestamp(), clock_timestamp() FROM generate_series(1, 3);
CALL model_fold_tick();
SELECT t_assert((SELECT status = 'skipped' AND skip_reason LIKE 'circuit open%' FROM model_fold_ticks ORDER BY started_at DESC LIMIT 1), 'circuit opens');
DELETE FROM model_fold_ticks WHERE status = 'error';
UPDATE platform_config SET config_value = config_value || '{"enabled":false}' WHERE config_key = 'model_fold';
CREATE TEMP TABLE n_ticks AS SELECT count(*) n FROM model_fold_ticks;
CALL model_fold_tick();
SELECT t_assert((SELECT count(*) FROM model_fold_ticks) = (SELECT n FROM n_ticks), 'enabled=false: no tick');
SELECT t_assert((SELECT dead = 1 AND done = 3 AND pending = 1 FROM model_fold_freshness), 'freshness view counts');
SELECT t_assert((assay_model_fold() ->> 'enabled') = 'false', 'assay is quiet when disabled');
UPDATE platform_config SET config_value = config_value || '{"enabled":true}' WHERE config_key = 'model_fold';
CALL model_fold_tick();
SELECT t_assert((assay_model_fold() ->> 'ok') = 'true', 'assay passes when healthy');
SELECT t_assert(NOT has_function_privilege('anon', 'public.model_fold_revert_v1(uuid)', 'execute')
  AND NOT has_table_privilege('authenticated', 'public.model_fold_work', 'select'), 'not exposed to anon/authenticated');

-- Reaper.
INSERT INTO analysis_queue (vehicle_id, status, worker_id, claimed_at, lease_expires_at, lease_token, request_revision, completed_revision) VALUES
  (gen_random_uuid(), 'processing', 'w-old', '2026-04-01', NULL, NULL, 0, 0),
  (gen_random_uuid(), 'processing', 'w-old', '2026-04-02', NULL, NULL, 0, 0),
  (gen_random_uuid(), 'processing', 'w-old', '2026-04-03', NULL, NULL, 0, 0),
  (gen_random_uuid(), 'processing', 'w-new', '2026-04-03', now() + interval '1 minute', gen_random_uuid(), 1, 0),
  (gen_random_uuid(), 'processing', 'w-old', '2026-04-03', NULL, NULL, 2, 1),
  (gen_random_uuid(), 'processing', 'w-new', now(), NULL, NULL, 0, 0);
DO $$ BEGIN
  PERFORM analysis_queue_reap_orphans_v1('ab000000-0000-4000-8000-000000000001', now(), 2, 1);
  RAISE EXCEPTION 'expected refusal';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'expected refusal' THEN RAISE; END IF;
END $$;
SELECT t_assert((analysis_queue_reap_orphans_v1('ab000000-0000-4000-8000-000000000001', '2026-05-01', 2, 1) ->> 'backed_up')::int = 3, 'reaper backs up only orphans');
SELECT t_assert((SELECT count(*) FROM analysis_queue WHERE status = 'processing') = 6, 'backup step releases nothing');
SELECT t_assert((analysis_queue_reap_orphans_v1('ab000000-0000-4000-8000-000000000001', '2026-05-01', 2, 1) ->> 'released_this_call')::int = 2, 'release batch 1');
SELECT t_assert((analysis_queue_reap_orphans_v1('ab000000-0000-4000-8000-000000000001', '2026-05-01', 2, 1) ->> 'done')::boolean, 'release finishes');
SELECT t_assert((SELECT count(*) FROM analysis_queue WHERE status = 'pending' AND worker_id IS NULL AND claimed_at IS NULL) = 3
  AND (SELECT count(*) FROM analysis_queue WHERE status = 'processing') = 3, 'only orphans released');
SELECT t_assert((analysis_queue_reap_revert_v1('ab000000-0000-4000-8000-000000000001') ->> 'restored')::int = 3, 'reaper revert reports');
SELECT t_assert((SELECT count(*) FROM analysis_queue WHERE status = 'processing' AND worker_id = 'w-old' AND claimed_at < '2026-05-01') = 4,
  'reaper revert restores');

-- Revert files remove everything.
\ir revert_20261124041000_analysis_queue_orphan_reaper.sql
\ir revert_20261124040000_model_fold_loop.sql
SELECT t_assert(to_regclass('public.model_fold_work') IS NULL AND to_regclass('public.analysis_queue_reap_backup') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE '%model_fold%')
  AND NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'model_fold'), 'revert files remove the loop and the reaper');

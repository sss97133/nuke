-- Empty disposable PG17 worker phase scaffolding. Reuses existing loop fixture producers.
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
SET statement_timeout='10s';
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


create table if not exists public.model_fold_signal (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null,
  reason text not null,
  origin_id uuid,
  at timestamptz not null default now());

create table if not exists public.model_fold_work (
  vehicle_id uuid primary key,
  state text not null default 'pending' check (state in ('pending','leased','done','dead')),
  priority smallint not null default 5,
  reasons text[] not null default '{}',
  first_dirty_at timestamptz not null default now(),
  dirty_at timestamptz not null default now(),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  lease_tick uuid,
  last_error text,
  folded_at timestamptz,
  folded_key text,
  edited_origins uuid[] not null default '{}',
  updated_at timestamptz not null default now());
-- re-apply safe: columns added after the first draft of these tables
alter table public.model_fold_signal add column if not exists origin_id uuid;
alter table public.model_fold_work add column if not exists edited_origins uuid[] not null default '{}';
drop function if exists public.model_fold_invalidate_readings(uuid);
drop function if exists public.model_fold_one(uuid, uuid, jsonb);
create index if not exists model_fold_work_pending_idx on public.model_fold_work (priority, dirty_at) where state = 'pending';
create index if not exists model_fold_work_leased_idx on public.model_fold_work (leased_until) where state = 'leased';

create table if not exists public.model_fold_scope_members (
  scope text not null,
  vehicle_id uuid not null,
  gen int not null default 0,
  primary key (scope, vehicle_id));

create table if not exists public.model_fold_cursor (
  scope text primary key,
  cursor uuid,
  pass_key text,
  verified_key text,
  cycle int not null default 0,
  snapshot_at timestamptz,
  snapshot_n int,
  snap_gen int not null default 0,
  snap_step int,
  pass_started_at timestamptz,
  wrapped_at timestamptz,
  enqueued_total bigint not null default 0,
  updated_at timestamptz not null default now());

create table if not exists public.model_fold_ticks (
  tick_id uuid primary key,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  pid int,
  status text not null check (status in ('running','ok','skipped','error','stale','reverted')),
  skip_reason text,
  logic_key text,
  signals int not null default 0,
  swept int not null default 0,
  claimed int not null default 0,
  folded int not null default 0,
  failed int not null default 0,
  dead int not null default 0,
  readings_added int not null default 0,
  readings_invalidated int not null default 0,
  members_applied int not null default 0,
  members_superseded int not null default 0,
  ms int,
  error text,
  reverted_at timestamptz,
  revert_summary jsonb);
create index if not exists model_fold_ticks_started_idx on public.model_fold_ticks (started_at desc);

create table if not exists public.model_fold_tick_runs (
  id bigint generated always as identity primary key,
  tick_id uuid not null,
  vehicle_id uuid not null,
  decode_run_id uuid,
  membership_run_id uuid,
  invalidated_reading_ids uuid[] not null default '{}',
  readings_added int not null default 0,
  members_applied int not null default 0,
  members_superseded int not null default 0,
  ms int,
  at timestamptz not null default now(),
  reverted_at timestamptz);
create index if not exists model_fold_tick_runs_tick_idx on public.model_fold_tick_runs (tick_id);
create index if not exists model_fold_tick_runs_vehicle_idx on public.model_fold_tick_runs (vehicle_id, at desc);


-- Actual worker control/dispatch bodies were captured read-only from production
--2026-11-26; general input producers are the existing loop fixture's stubs.
-- No source observations are inserted or mutated by this phase contract.
ALTER TABLE public.model_fold_signal ADD COLUMN priority smallint NOT NULL DEFAULT 5;
ALTER TABLE public.vehicles ADD COLUMN is_public boolean NOT NULL DEFAULT true;
CREATE TABLE public.harness_designs(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id));
INSERT INTO public.harness_designs VALUES(md5('worker phase design')::uuid,:fb1);
CREATE TABLE public.harness_model_evaluations(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),logic_key text,UNIQUE(id,vehicle_id));
CREATE TABLE public.harness_model_state(vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),source_epoch bigint NOT NULL DEFAULT 1,
 folded_epoch bigint,source_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),latest_evaluation_id uuid REFERENCES public.harness_model_evaluations(id),
 failure_count integer NOT NULL DEFAULT 0,retry_after timestamptz,last_error_code text,last_attempt_logic_key text);
CREATE TABLE public.worker_phase_calls(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,vehicle_id uuid,phase text);
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT config_value FROM public.platform_config WHERE config_key='model_fold'$$;
INSERT INTO public.platform_config(config_key,config_value) VALUES('model_fold','{"enabled":true,"signals_enabled":true,"decode_scopes":[],"scopes":[],"max_vehicles":5,"max_attempts":2,"budget_ms":6000,"settle_seconds":0,"max_delay_seconds":0,"lease_seconds":60,"max_lock_waiters":20,"max_active_backends":60,"circuit_bad_ticks":3,"stuck_tick_seconds":60,"yield_job":"model-fold-tick"}');
CREATE FUNCTION public.model_fold_logic_key() RETURNS text LANGUAGE sql STABLE AS $$SELECT md5('generic fixture')$$;
CREATE FUNCTION public.model_fold_scope_of(text,text,text,integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT NULL::text$$;
CREATE FUNCTION public.model_fold_invalidate_readings(uuid,uuid[] DEFAULT '{}') RETURNS uuid[] LANGUAGE sql AS $$SELECT '{}'::uuid[]$$;
CREATE FUNCTION public.data_set_grade_vehicle(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
CREATE FUNCTION public.vehicle_facet_grades_in_scope(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.vehicle_labor_appraisal_in_scope(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.auction_close_yield(text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('test.auction_yield',true),''),'false')::boolean$$;
CREATE FUNCTION public.model_fold_sweep(text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 PERFORM pg_sleep(coalesce(nullif(current_setting('test.sweep_ms',true),''),'0')::numeric/1000);
 RETURN '{"_queued":0}'::jsonb;END$$;
CREATE FUNCTION public.harness_model_logic_key() RETURNS text LANGUAGE sql STABLE AS $$SELECT md5(coalesce(nullif(current_setting('test.harness_logic',true),''),'harness fixture'))$$;
CREATE FUNCTION public.harness_model_fold(p_vehicle_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $stub$
DECLARE e uuid; lk text:=public.harness_model_logic_key(); mode text:=current_setting('test.harness_mode',true);
BEGIN
 INSERT INTO public.worker_phase_calls(vehicle_id,phase) VALUES(p_vehicle_id,'harness');
 IF mode='busy' THEN RETURN '{"status":"busy"}'::jsonb;END IF;
 INSERT INTO public.harness_model_state(vehicle_id) VALUES(p_vehicle_id) ON CONFLICT DO NOTHING;
 BEGIN
  IF mode='error' THEN RAISE EXCEPTION 'synthetic source error' USING ERRCODE='22023';END IF;
  PERFORM pg_sleep(coalesce(nullif(current_setting('test.harness_ms',true),''),'0')::numeric/1000);
  e:=gen_random_uuid();
  INSERT INTO public.harness_model_evaluations VALUES(e,p_vehicle_id,lk);
  UPDATE public.harness_model_state SET folded_epoch=source_epoch,latest_evaluation_id=e,last_attempt_logic_key=lk,
   last_error_code=NULL,retry_after=NULL,failure_count=0 WHERE vehicle_id=p_vehicle_id;
  IF mode='dirty' THEN
   UPDATE public.harness_model_state SET source_epoch=source_epoch+1 WHERE vehicle_id=p_vehicle_id;
   UPDATE public.model_fold_work SET dirty_at=clock_timestamp(),edited_origins=array_append(edited_origins,md5('during harness')::uuid) WHERE vehicle_id=p_vehicle_id;
  END IF;
  RETURN jsonb_build_object('status','current','evaluation_id',e);
 EXCEPTION WHEN OTHERS OR query_canceled THEN
  UPDATE public.harness_model_state SET failure_count=failure_count+1,last_error_code=SQLSTATE,
   last_attempt_logic_key=lk,retry_after=clock_timestamp()+interval '1 hour' WHERE vehicle_id=p_vehicle_id;
  RETURN jsonb_build_object('status','error','error_code',SQLSTATE);
 END;
END $stub$;
-- Generic work remains the real captured dispatcher. Its membership producer
-- records scheduling and can simulate a changed input/failure/latency.
DO $stub$
DECLARE b text:=pg_get_functiondef('public.data_set_membership_plan_v1(uuid,text,uuid)'::regprocedure);
BEGIN
 b:=replace(b,'BEGIN', $inject$BEGIN
 INSERT INTO public.worker_phase_calls(vehicle_id,phase) VALUES(p_vehicle,'vehicle');
 PERFORM pg_sleep(coalesce(nullif(current_setting('test.vehicle_ms',true),''),'0')::numeric/1000);
 IF current_setting('test.vehicle_mode',true)='error' THEN RAISE EXCEPTION 'synthetic generic failure';END IF;
 IF current_setting('test.vehicle_mode',true)='dirty' THEN
  UPDATE public.harness_model_state SET source_epoch=source_epoch+1 WHERE vehicle_id=p_vehicle;
  UPDATE public.model_fold_work SET dirty_at=clock_timestamp(),edited_origins=array_append(edited_origins,md5('during vehicle')::uuid) WHERE vehicle_id=p_vehicle;
 END IF;
$inject$);
 EXECUTE b;
END $stub$;

CREATE FUNCTION public.harness_model_in_scope(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS (SELECT FROM public.vehicles v JOIN public.harness_designs d ON d.vehicle_id=v.id
  WHERE v.id=p_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
   AND v.id::text NOT LIKE '9cf5b7a4%');
$$;


CREATE FUNCTION public.harness_model_enqueue_changed() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb:=public.model_fold_config(); lk text; n integer;
BEGIN
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN 0; END IF;
 lk:=public.harness_model_logic_key();
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority,at)
 SELECT s.vehicle_id,'harness:stale_or_logic',2,clock_timestamp()-make_interval(secs=>greatest(0,coalesce((cfg->>'settle_seconds')::int,0)))
 FROM public.harness_model_state s LEFT JOIN public.harness_model_evaluations r ON r.id=s.latest_evaluation_id
 WHERE public.harness_model_in_scope(s.vehicle_id)
  AND (s.latest_evaluation_id IS NULL OR s.source_epoch IS DISTINCT FROM s.folded_epoch OR r.logic_key IS DISTINCT FROM lk OR s.last_error_code IS NOT NULL)
  AND (s.last_attempt_logic_key IS DISTINCT FROM lk OR s.source_epoch IS DISTINCT FROM s.folded_epoch AND s.failure_count=0
    OR (s.failure_count<greatest(1,coalesce((cfg->>'max_attempts')::int,1)) AND coalesce(s.retry_after,'-infinity')<=clock_timestamp()))
  AND NOT EXISTS (SELECT FROM public.model_fold_signal q WHERE q.vehicle_id=s.vehicle_id)
  AND NOT EXISTS (SELECT FROM public.model_fold_work w WHERE w.vehicle_id=s.vehicle_id AND w.state IN ('pending','leased'))
 ORDER BY s.source_changed_at,s.vehicle_id LIMIT greatest(1,coalesce((cfg->>'max_vehicles')::int,1));
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.model_fold_absorb_signals(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with s as (
    delete from public.model_fold_signal where id in (select id from public.model_fold_signal order by id limit p_limit)
    returning vehicle_id, reason, origin_id, at, priority),
  g as (select vehicle_id, array_agg(distinct reason) reasons, min(at) f, max(at) l, min(priority) pr,
               coalesce(array_agg(distinct origin_id) filter (where origin_id is not null), '{}') edited
          from s group by vehicle_id)
  insert into public.model_fold_work as w (vehicle_id, priority, reasons, first_dirty_at, dirty_at, next_attempt_at, edited_origins)
  select vehicle_id, pr, reasons, f, l, now(), edited from g
  on conflict (vehicle_id) do update set
    -- model_fold_signal_tiers_v1: the signal's tier; a pending row keeps the more urgent of the two
    priority = case when w.state in ('done','dead') then excluded.priority else least(w.priority, excluded.priority) end,
    edited_origins = (select coalesce(array_agg(distinct x), '{}') from unnest(w.edited_origins || excluded.edited_origins) x),
    reasons = case when w.state in ('done','dead') then excluded.reasons
                   else (select array_agg(distinct x order by x) from unnest(w.reasons || excluded.reasons) x) end,
    first_dirty_at = case when w.state in ('done','dead') then excluded.first_dirty_at else least(w.first_dirty_at, excluded.first_dirty_at) end,
    dirty_at = greatest(w.dirty_at, excluded.dirty_at),
    -- new input revives a dead letter with a fresh attempt budget; a leased row keeps its lease
    state = case when w.state = 'leased' then w.state else 'pending' end,
    attempts = case when w.state = 'dead' then 0 else w.attempts end,
    next_attempt_at = case when w.state in ('done','dead') then now() else w.next_attempt_at end,
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.model_fold_backpressure(p_cfg jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n_lock int; n_act int; n_bad int;
begin
  -- Auction closes: the loop yields while the shared rule row says its job must (auction_close_yield). Only a config that
  -- names its yield_job asks; the spec-landing callers pass '{}'.
  if nullif(p_cfg ->> 'yield_job', '') is not null and public.auction_close_yield(p_cfg ->> 'yield_job') then
    return format('auction closes: %s yields (auction_close_yield)', p_cfg ->> 'yield_job');
  end if;
  select count(*) filter (where wait_event_type = 'Lock'), count(*) filter (where state = 'active')
    into n_lock, n_act from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid();
  if n_lock > coalesce((p_cfg ->> 'max_lock_waiters')::int, 20) then return format('lock waiters %s', n_lock); end if;
  if n_act > coalesce((p_cfg ->> 'max_active_backends')::int, 60) then return format('active backends %s', n_act); end if;
  -- Circuit: the last N finished ticks (30 min window) all bad and the newest bad one under 10 minutes old -> skip.
  -- After 10 quiet minutes one tick is let through (half-open); if it fails the circuit stays open another 10 minutes.
  select count(*) filter (where status in ('error','stale')), count(*) into n_bad, n_act from (
    select status from public.model_fold_ticks where status in ('ok','error','stale') and started_at > now() - interval '30 minutes'
     order by started_at desc limit coalesce((p_cfg ->> 'circuit_bad_ticks')::int, 3)) z;
  if n_act >= coalesce((p_cfg ->> 'circuit_bad_ticks')::int, 3) and n_bad = n_act
     and exists (select 1 from public.model_fold_ticks where status in ('error','stale') and started_at > now() - interval '10 minutes') then
    return format('circuit open: last %s ticks failed', n_bad);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.model_fold_one(p_tick uuid, p_vehicle uuid, p_cfg jsonb, p_edited uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  t0 timestamptz := clock_timestamp(); v_inv uuid[]; v_dec uuid; v_mem uuid := gen_random_uuid();
  r jsonb; p jsonb; a jsonb; v public.vehicles; v_exists boolean; n_add int := 0; v_decoder text;
begin
  if p_vehicle::text like '9cf5b7a4%' then return jsonb_build_object('skipped', 'excluded'); end if;
  select * into v from public.vehicles where id = p_vehicle;
  v_exists := found;
  v_inv := public.model_fold_invalidate_readings(p_vehicle, p_edited);
  if v_exists and public.model_fold_scope_of(v.make, v.model, v.vin, v.year) in
       (select jsonb_array_elements_text(p_cfg -> 'decode_scopes')) then
    v_dec := gen_random_uuid();
    v_decoder := coalesce(p_cfg ->> 'decoder', 'text_code_decode_v2');
    if v_decoder !~ '^text_code_decode_v[0-9]+$'
       or to_regprocedure(format('public.%s(uuid,text,uuid,integer,integer,integer)', v_decoder)) is null then
      raise exception 'model_fold: decoder % is not an existing text_code_decode_vN(uuid,text,uuid,int,int,int)', v_decoder;
    end if;
    execute format('select public.%I($1, $2, $3, $4, $5, $6)', v_decoder)
      into r using v_dec, 'vehicle'::text, p_vehicle, 50, 1, null::int;
    n_add := coalesce((r ->> 'inserted_this_slice')::int, 0);
  elsif cardinality(v_inv) > 0 then
    perform public.text_code_rescore_v1(array[p_vehicle]);
  end if;
  if not v_exists then
    -- Vehicle row gone: nothing to plan from; any members it had stay for the membership producer's own scopes.
    insert into public.model_fold_tick_runs (tick_id, vehicle_id, decode_run_id, membership_run_id, invalidated_reading_ids, ms)
    values (p_tick, p_vehicle, null, null, v_inv, (extract(epoch from clock_timestamp() - t0) * 1000)::int);
    return jsonb_build_object('vehicle_missing', true, 'invalidated', cardinality(v_inv));
  end if;
  p := public.data_set_membership_plan_v1(v_mem, 'vehicle', p_vehicle);
  a := public.data_set_membership_apply_v1(v_mem, 500, 200, false);
  perform public.data_set_grade_vehicle(p_vehicle);
  -- facet_grades_fold_v1: the viewer-independent facet grades of a car in scope (a failure lands in its folds row)
  if public.vehicle_facet_grades_in_scope(p_vehicle) then
    perform public.vehicle_facet_grades_fold(p_vehicle);
  end if;
  -- facet_grades_fold_v1_end
  -- labor_fold_v1: the stored labor appraisal of a car in scope (a failure lands in its state row)
  begin
    if public.vehicle_labor_appraisal_in_scope(p_vehicle) then
      perform public.vehicle_labor_appraisal_fold(p_vehicle);
    end if;
  exception when others then
    raise warning 'labor fold skipped: %', sqlerrm;
  end;
  -- labor_fold_v1_end
  -- harness_model_loop_v1
  if public.harness_model_in_scope(p_vehicle) then
    perform public.harness_model_fold(p_vehicle);
  end if;
  -- harness_model_loop_v1_end
  insert into public.model_fold_tick_runs (tick_id, vehicle_id, decode_run_id, membership_run_id, invalidated_reading_ids,
                                           readings_added, members_applied, members_superseded, ms)
  values (p_tick, p_vehicle, v_dec, v_mem, v_inv, n_add, coalesce((a ->> 'applied')::int, 0),
          coalesce((p ->> 'planned_supersede')::int, 0), (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  return jsonb_build_object('decode_run', v_dec, 'membership_run', v_mem, 'invalidated', cardinality(v_inv),
                            'readings_added', n_add, 'applied', coalesce((a ->> 'applied')::int, 0),
                            'superseded', coalesce((p ->> 'planned_supersede')::int, 0));
end $function$;
;
CREATE OR REPLACE PROCEDURE public.model_fold_tick()
 LANGUAGE plpgsql
AS $procedure$
declare
  cfg jsonb := public.model_fold_config();
  v_tick uuid := gen_random_uuid(); t0 timestamptz := clock_timestamp();
  v_budget interval := make_interval(secs => coalesce((cfg ->> 'budget_ms')::numeric, 40000) / 1000.0);
  v_max int := coalesce((cfg ->> 'max_vehicles')::int, 200);
  v_settle interval := make_interval(secs => coalesce((cfg ->> 'settle_seconds')::int, 300));
  v_maxdelay interval := make_interval(secs => coalesce((cfg ->> 'max_delay_seconds')::int, 1800));
  v_lease interval := make_interval(secs => coalesce((cfg ->> 'lease_seconds')::int, 300));
  v_maxatt int := coalesce((cfg ->> 'max_attempts')::int, 5);
  v_key text; v_reason text; v_sig int := 0; v_sweep jsonb; v_veh uuid; v_dirty timestamptz; v_att int; r jsonb; v_err text;
  n_claim int := 0; n_ok int := 0; n_fail int := 0; n_dead int := 0; n_add int := 0; n_inv int := 0; n_app int := 0; n_sup int := 0;
  v_stuck record; v_edited uuid[];
begin
  if not coalesce((cfg ->> 'enabled')::boolean, false) then return; end if;
  -- A tick that died on this same session (error or timeout after COMMIT) left its session lock and in_tick flag behind;
  -- drop them before trying again. Cron runs this CALL alone on its connection, so this session holds no other advisory lock.
  if coalesce(current_setting('model_fold.in_tick', true), '') = 'on' then
    perform pg_advisory_unlock_all();
    perform set_config('model_fold.in_tick', '', false);
  end if;
  if not pg_try_advisory_lock(hashtext('public.model_fold_tick')) then
    -- Another tick holds the lock. Cancel it only if it has overrun the stuck limit.
    for v_stuck in select t.tick_id, t.pid from public.model_fold_ticks t
                    where t.status = 'running' and t.started_at < now() - make_interval(secs => coalesce((cfg ->> 'stuck_tick_seconds')::int, 180))
    loop
      perform pg_cancel_backend(v_stuck.pid) from pg_stat_activity a where a.pid = v_stuck.pid and a.query ilike '%model_fold_tick%';
      update public.model_fold_ticks set status = 'stale', finished_at = clock_timestamp(), error = 'cancelled: overran stuck_tick_seconds'
       where tick_id = v_stuck.tick_id and status = 'running';
      -- its vehicle backs off now rather than waiting for the lease to expire
      update public.model_fold_work w set state = case when w.attempts >= v_maxatt then 'dead' else 'pending' end,
             next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, w.attempts)::int)),
             leased_until = null, lease_tick = null, last_error = 'tick cancelled while folding this vehicle', updated_at = now()
       where w.state = 'leased' and w.lease_tick = v_stuck.tick_id;
    end loop;
    insert into public.model_fold_ticks (tick_id, status, skip_reason, finished_at, pid)
    values (v_tick, 'skipped', 'previous tick still running', clock_timestamp(), pg_backend_pid());
    commit;
    return;
  end if;
  perform set_config('model_fold.in_tick', 'on', false);
  perform set_config('lock_timeout', coalesce(cfg ->> 'lock_timeout', '2s'), false);
  -- A tick that ended without finishing (cancelled, timed out) is stale; the vehicle it held backs off and counts an attempt.
  with st as (update public.model_fold_ticks set status = 'stale', finished_at = clock_timestamp(),
                     error = coalesce(error, 'tick ended without finishing (timeout or cancel)')
               where status = 'running' returning tick_id)
  update public.model_fold_work w set state = case when w.attempts >= v_maxatt then 'dead' else 'pending' end,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, w.attempts)::int)),
         leased_until = null, lease_tick = null, last_error = 'tick ended while folding this vehicle (timeout or cancel)', updated_at = now()
    from st where w.state = 'leased' and w.lease_tick = st.tick_id;
  insert into public.model_fold_ticks (tick_id, status, pid) values (v_tick, 'running', pg_backend_pid());
  commit;

  v_reason := public.model_fold_backpressure(cfg);
  if v_reason is not null then
    update public.model_fold_ticks set status = 'skipped', skip_reason = v_reason, finished_at = clock_timestamp(),
           ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int where tick_id = v_tick;
    commit;
    perform set_config('model_fold.in_tick', '', false);
    perform pg_advisory_unlock(hashtext('public.model_fold_tick'));
    return;
  end if;

  -- harness_model_loop_v1: data and logic freshness share the existing queue and budget
  perform public.harness_model_enqueue_changed();
  -- harness_model_loop_v1_end
  v_sig := public.model_fold_absorb_signals(coalesce((cfg ->> 'signal_batch')::int, 50000));
  -- Leases left by a tick that died: back to pending (their attempt already counted).
  update public.model_fold_work set state = case when attempts >= v_maxatt then 'dead' else 'pending' end,
         leased_until = null, last_error = coalesce(last_error, 'lease expired'), updated_at = now()
   where state = 'leased' and leased_until < now();
  v_key := public.model_fold_logic_key();
  update public.model_fold_ticks set signals = v_sig, logic_key = v_key where tick_id = v_tick;
  commit;

  v_sweep := public.model_fold_sweep(v_key, cfg);
  update public.model_fold_ticks set swept = coalesce((v_sweep ->> '_queued')::int, 0) where tick_id = v_tick;
  commit;

  loop
    exit when n_claim >= v_max or clock_timestamp() - t0 > v_budget;
    select w.vehicle_id, w.dirty_at, w.edited_origins into v_veh, v_dirty, v_edited from public.model_fold_work w
     where w.state = 'pending' and w.next_attempt_at <= now()
       and (w.dirty_at <= now() - v_settle or w.first_dirty_at <= now() - v_maxdelay)
     order by w.priority, w.dirty_at limit 1 for update skip locked;
    exit when not found;
    update public.model_fold_work set state = 'leased', attempts = attempts + 1, leased_until = now() + v_lease,
           lease_tick = v_tick, updated_at = now() where vehicle_id = v_veh returning attempts into v_att;
    commit;
    n_claim := n_claim + 1;
    begin
      r := public.model_fold_one(v_tick, v_veh, cfg, v_edited);
      update public.model_fold_work set state = case when dirty_at > v_dirty then 'pending' else 'done' end,
             attempts = 0, leased_until = null, lease_tick = null, last_error = null, folded_at = now(), folded_key = v_key,
             edited_origins = array(select unnest(edited_origins) except select unnest(v_edited)),
             priority = case when dirty_at > v_dirty then priority else 5 end, updated_at = now()
       where vehicle_id = v_veh;
      n_ok := n_ok + 1;
      n_add := n_add + coalesce((r ->> 'readings_added')::int, 0);
      n_inv := n_inv + coalesce((r ->> 'invalidated')::int, 0);
      n_app := n_app + coalesce((r ->> 'applied')::int, 0);
      n_sup := n_sup + coalesce((r ->> 'superseded')::int, 0);
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.model_fold_work set state = case when attempts >= v_maxatt then 'dead' else 'pending' end,
             next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::int)),
             leased_until = null, lease_tick = null, last_error = left(v_err, 500), updated_at = now()
       where vehicle_id = v_veh;
      n_fail := n_fail + 1;
      if v_att >= v_maxatt then n_dead := n_dead + 1; end if;
    end;
    update public.model_fold_ticks set claimed = n_claim, folded = n_ok, failed = n_fail, dead = n_dead,
           readings_added = n_add, readings_invalidated = n_inv, members_applied = n_app, members_superseded = n_sup,
           ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
     where tick_id = v_tick;
    commit;
  end loop;

  update public.model_fold_ticks set status = 'ok', finished_at = clock_timestamp(), claimed = n_claim, folded = n_ok,
         failed = n_fail, dead = n_dead, readings_added = n_add, readings_invalidated = n_inv, members_applied = n_app,
         members_superseded = n_sup, ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
   where tick_id = v_tick;
  commit;
  perform set_config('model_fold.in_tick', '', false);
  perform pg_advisory_unlock(hashtext('public.model_fold_tick'));
end $procedure$
;

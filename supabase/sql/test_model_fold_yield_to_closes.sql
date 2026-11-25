-- Contract for 20261126114000_model_fold_tick_yields_to_auction_closes (empty disposable PG17).
-- The live model_fold_tick, model_fold_config, model_fold_backpressure, assay_model_fold and model_fold_freshness are
-- loaded verbatim (read from production 2026-11-25, prosrc md5 tick d164edcd, backpressure 27111d19, assay 54509aaf,
-- config ba265011), over small fixture tables. The rule row and reader of 20261126033500 (auction_close_yield) are
-- loaded as that migration writes them.
-- Asserts: the migration stops while the reader is missing and changes nothing; once it exists the migration adds
-- model-fold-tick to the rule row's jobs (once, keeping the others) and yield_job to the model_fold config; the
-- backpressure answers 'auction closes' for a lot ending inside 30 minutes, a lot ended under 15 minutes ago and a lot in
-- soft close that ended under 60 minutes ago, and null for 31 minutes out, 20 minutes ago, a stale soft-close flag, a lot
-- not live, a null end time, the spec-landing call with '{}', an empty yield_job and a job removed from the rule row;
-- a missing rule row raises; the live tick then records status skipped with that reason and leases nothing; the watch
-- holds its stale and backlog checks only while the newest tick is a closes skip under 2 minutes old, and still raises
-- on dead letters. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.model_fold_ticks') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.platform_config (id uuid DEFAULT gen_random_uuid(), config_key text PRIMARY KEY, config_value jsonb,
  description text, updated_at timestamptz DEFAULT now(), updated_by text);
INSERT INTO public.platform_config (config_key, config_value) VALUES ('model_fold',
  '{"scopes": ["pontiac_f_body"], "enabled": true, "budget_ms": 6000, "max_lock_waiters": 1000, "max_active_backends": 1000, "circuit_bad_ticks": 3}');
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_live boolean,
  is_in_soft_close boolean, auction_end_time timestamptz, last_extension_at timestamptz);
CREATE TABLE public.model_fold_ticks (tick_id uuid PRIMARY KEY, started_at timestamptz DEFAULT clock_timestamp(),
  finished_at timestamptz, pid int, status text, skip_reason text, logic_key text, signals int DEFAULT 0, swept int DEFAULT 0,
  claimed int DEFAULT 0, folded int DEFAULT 0, failed int DEFAULT 0, dead int DEFAULT 0, readings_added int DEFAULT 0,
  readings_invalidated int DEFAULT 0, members_applied int DEFAULT 0, members_superseded int DEFAULT 0, ms int, error text);
CREATE TABLE public.model_fold_work (vehicle_id uuid PRIMARY KEY, state text NOT NULL DEFAULT 'pending',
  priority smallint NOT NULL DEFAULT 5, reasons text[] NOT NULL DEFAULT '{}', first_dirty_at timestamptz NOT NULL DEFAULT now(),
  dirty_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz, lease_tick uuid, last_error text, folded_at timestamptz, folded_key text,
  edited_origins uuid[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.model_fold_signal (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, vehicle_id uuid, reason text,
  origin_id uuid, at timestamptz DEFAULT now());
CREATE TABLE public.model_fold_cursor (scope text PRIMARY KEY, cursor uuid, pass_key text, verified_key text,
  cycle int NOT NULL DEFAULT 0, snapshot_at timestamptz, snapshot_n int, snap_gen int NOT NULL DEFAULT 0, snap_step int,
  pass_started_at timestamptz, wrapped_at timestamptz, enqueued_total bigint NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.model_fold_logic_key() RETURNS text LANGUAGE sql STABLE AS $$ select 'k1' $$;

-- live definitions (2026-11-25)
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.model_fold_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((select config_value from public.platform_config where config_key = 'model_fold' limit 1), '{}'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION public.model_fold_backpressure(p_cfg jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n_lock int; n_act int; n_bad int;
begin
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

CREATE OR REPLACE FUNCTION public.assay_model_fold()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare f record;
begin
  select * into f from public.model_fold_freshness;
  if not f.enabled then return jsonb_build_object('enabled', false); end if;
  if f.last_ok_tick_at is null or f.last_ok_tick_at < now() - interval '15 minutes' then
    raise exception 'model_fold stale: last ok tick %', coalesce(f.last_ok_tick_at::text, 'never');
  end if;
  if f.oldest_signal_dirty_at < now() - interval '3 hours' then
    raise exception 'model_fold backlog: signalled work dirty since %', f.oldest_signal_dirty_at;
  end if;
  if f.dead > 50 then raise exception 'model_fold dead letters: %', f.dead; end if;
  if f.bad_ticks_1h >= 5 then raise exception 'model_fold bad ticks in last hour: %', f.bad_ticks_1h; end if;
  return jsonb_build_object('ok', true, 'pending', f.pending, 'dead', f.dead, 'folded_last_hour', f.folded_last_hour,
                            'signals_waiting', f.signals_waiting, 'last_ok_tick_at', f.last_ok_tick_at);
end $function$;

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
end $procedure$;

CREATE VIEW public.model_fold_freshness AS
 SELECT COALESCE(((model_fold_config() ->> 'enabled'::text))::boolean, false) AS enabled,
    ( SELECT count(*) AS count
           FROM model_fold_signal) AS signals_waiting,
    ( SELECT min(model_fold_signal.at) AS min
           FROM model_fold_signal) AS oldest_signal_at,
    count(*) FILTER (WHERE (state = 'pending'::text)) AS pending,
    count(*) FILTER (WHERE ((state = 'pending'::text) AND (next_attempt_at <= now()))) AS due,
    count(*) FILTER (WHERE (state = 'leased'::text)) AS leased,
    count(*) FILTER (WHERE (state = 'done'::text)) AS done,
    count(*) FILTER (WHERE (state = 'dead'::text)) AS dead,
    min(first_dirty_at) FILTER (WHERE ((state = ANY (ARRAY['pending'::text, 'leased'::text])) AND (priority < 5))) AS oldest_signal_dirty_at,
    count(*) FILTER (WHERE (folded_at > (now() - '01:00:00'::interval))) AS folded_last_hour,
    ( SELECT max(model_fold_ticks.finished_at) AS max
           FROM model_fold_ticks
          WHERE (model_fold_ticks.status = 'ok'::text)) AS last_ok_tick_at,
    ( SELECT count(*) AS count
           FROM model_fold_ticks
          WHERE ((model_fold_ticks.started_at > (now() - '01:00:00'::interval)) AND (model_fold_ticks.status = 'ok'::text))) AS ok_ticks_1h,
    ( SELECT count(*) AS count
           FROM model_fold_ticks
          WHERE ((model_fold_ticks.started_at > (now() - '01:00:00'::interval)) AND (model_fold_ticks.status = 'skipped'::text))) AS skipped_ticks_1h,
    ( SELECT count(*) AS count
           FROM model_fold_ticks
          WHERE ((model_fold_ticks.started_at > (now() - '01:00:00'::interval)) AND (model_fold_ticks.status = ANY (ARRAY['error'::text, 'stale'::text])))) AS bad_ticks_1h,
    ( SELECT jsonb_agg(jsonb_build_object('scope', c.scope, 'cursor_set', (c.cursor IS NOT NULL), 'cycle', c.cycle, 'snapshot_n', c.snapshot_n, 'snapshot_at', c.snapshot_at, 'verified_current', (c.verified_key = model_fold_logic_key()), 'wrapped_at', c.wrapped_at)) AS jsonb_agg
           FROM model_fold_cursor c) AS sweep
   FROM model_fold_work w;

SET check_function_bodies = on;

-- Before: a closing lot does not stop the tick.
INSERT INTO public.monitored_auctions (is_live, auction_end_time) VALUES (true, now() + interval '10 minutes');
DO $$ BEGIN
  IF public.model_fold_backpressure(public.model_fold_config()) IS NOT NULL THEN RAISE EXCEPTION 'before: expected no backpressure'; END IF;
END $$;

-- The migration stops while the reader is missing (here its rule row exists without it), and changes nothing.
-- The ERROR lines psql prints for this step are expected.
INSERT INTO public.platform_config (config_key, config_value) VALUES ('auction_close_yield', '{"jobs": []}');
\set ON_ERROR_STOP off
\ir ../migrations/20261126114000_model_fold_tick_yields_to_auction_closes.sql
\set ON_ERROR_STOP on
ROLLBACK;
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'model_fold_backpressure') LIKE '%yield_job%' THEN RAISE EXCEPTION 'missing reader: backpressure replaced'; END IF;
  IF public.model_fold_config() ? 'yield_job' THEN RAISE EXCEPTION 'missing reader: config changed'; END IF;
  IF (SELECT config_value FROM public.platform_config WHERE config_key = 'auction_close_yield') <> '{"jobs": []}' THEN
    RAISE EXCEPTION 'missing reader: rule row changed';
  END IF;
END $$;
DELETE FROM public.platform_config WHERE config_key = 'auction_close_yield';

-- 20261126033500 rule row and reader, as that migration writes them.
INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('auction_close_yield',
  jsonb_build_object(
    'jobs', jsonb_build_array('data-set-grades-backfill', 'data-set-public-counts', 'retained-projection-grade'),
    'minutes_before_end', 30,
    'minutes_after_end', 15,
    'soft_close_max_minutes', 60,
    'basis', 'bat-live-pull median run 2.5-2.8 s -> 8-14.6 s on IO:DataFileRead after these backfills started (2026-11-24 evening); lead ruling 2026-11-25: backfills yield while lots close'),
  'Cron jobs listed here skip a run while a monitored auction ends within minutes_before_end, ended under minutes_after_end ago, or is in soft close (ended under soft_close_max_minutes ago). Read by public.auction_close_yield(job).')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.auction_close_yield(p_job text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  r jsonb := (SELECT config_value FROM public.platform_config WHERE config_key = 'auction_close_yield');
  v_before integer;
  v_after integer;
  v_soft integer;
BEGIN
  IF r IS NULL OR jsonb_typeof(r -> 'jobs') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'auction_close_yield: rule row platform_config auction_close_yield is missing or has no jobs array';
  END IF;
  IF NOT (r -> 'jobs') ? p_job THEN
    RETURN false;
  END IF;
  v_before := CASE WHEN r ->> 'minutes_before_end' ~ '^\d{1,3}$' THEN (r ->> 'minutes_before_end')::integer END;
  v_after := CASE WHEN r ->> 'minutes_after_end' ~ '^\d{1,3}$' THEN (r ->> 'minutes_after_end')::integer END;
  v_soft := CASE WHEN r ->> 'soft_close_max_minutes' ~ '^\d{1,3}$' THEN (r ->> 'soft_close_max_minutes')::integer END;
  IF v_before IS NULL OR v_after IS NULL OR v_soft IS NULL THEN
    RAISE EXCEPTION 'auction_close_yield: rule row needs minutes_before_end, minutes_after_end and soft_close_max_minutes as whole minutes';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.monitored_auctions m
     WHERE m.is_live
       AND ((m.auction_end_time > now() - make_interval(mins => v_after)
             AND m.auction_end_time <= now() + make_interval(mins => v_before))
         OR (m.is_in_soft_close AND m.auction_end_time > now() - make_interval(mins => v_soft))));
END
$f$;
REVOKE ALL ON FUNCTION public.auction_close_yield(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_close_yield(text) TO service_role;
COMMENT ON FUNCTION public.auction_close_yield(text) IS
  'True while the named cron job must skip a run because monitored auctions are closing (rule row platform_config auction_close_yield). Called in the job command as WHERE NOT auction_close_yield(job).';

\ir ../migrations/20261126114000_model_fold_tick_yields_to_auction_closes.sql
\ir ../migrations/20261126114000_model_fold_tick_yields_to_auction_closes.sql
DO $$
DECLARE j jsonb := (SELECT config_value -> 'jobs' FROM public.platform_config WHERE config_key = 'auction_close_yield');
BEGIN
  IF (SELECT count(*) FROM jsonb_array_elements_text(j) e WHERE e = 'model-fold-tick') <> 1 THEN RAISE EXCEPTION 'jobs: model-fold-tick once, got %', j; END IF;
  IF NOT (j ? 'data-set-grades-backfill' AND j ? 'data-set-public-counts') THEN RAISE EXCEPTION 'jobs: lost the others %', j; END IF;
  IF public.model_fold_config() ->> 'yield_job' IS DISTINCT FROM 'model-fold-tick' THEN RAISE EXCEPTION 'config: yield_job'; END IF;
  IF (public.model_fold_config() ->> 'budget_ms') IS DISTINCT FROM '6000' THEN RAISE EXCEPTION 'config: other keys lost'; END IF;
END $$;

CREATE FUNCTION pg_temp.bp_case(p_label text, p_live boolean, p_soft boolean, p_end interval, p_ext interval, p_expect boolean,
                                p_cfg jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  DELETE FROM public.monitored_auctions;
  IF p_live IS NOT NULL THEN
    INSERT INTO public.monitored_auctions (is_live, is_in_soft_close, auction_end_time, last_extension_at)
    VALUES (p_live, p_soft, now() + p_end, now() + p_ext);
  END IF;
  r := public.model_fold_backpressure(coalesce(p_cfg, public.model_fold_config()));
  IF p_expect AND (r IS NULL OR r NOT LIKE 'auction closes: model-fold-tick yields%') THEN
    RAISE EXCEPTION '%: expected a closes skip, got %', p_label, r;
  END IF;
  IF NOT p_expect AND r IS NOT NULL THEN RAISE EXCEPTION '%: expected null, got %', p_label, r; END IF;
END $$;
SELECT pg_temp.bp_case('no lots', NULL, NULL, NULL, NULL, false);
SELECT pg_temp.bp_case('ends in 29 min', true, false, interval '29 minutes', NULL, true);
SELECT pg_temp.bp_case('ends in 31 min', true, false, interval '31 minutes', NULL, false);
SELECT pg_temp.bp_case('ended 10 min ago', true, false, interval '-10 minutes', NULL, true);
SELECT pg_temp.bp_case('ended 20 min ago', true, false, interval '-20 minutes', NULL, false);
SELECT pg_temp.bp_case('stale soft-close flag, ended 2 h ago', true, true, interval '-2 hours', interval '-3 hours', false);
SELECT pg_temp.bp_case('soft close, ended 40 min ago', true, true, interval '-40 minutes', interval '-1 minute', true);
SELECT pg_temp.bp_case('not live, ends in 10 min', false, false, interval '10 minutes', NULL, false);
SELECT pg_temp.bp_case('live, null end time', true, true, NULL, NULL, false);
SELECT pg_temp.bp_case('spec-landing call with {}', true, false, interval '10 minutes', NULL, false, '{}'::jsonb);
SELECT pg_temp.bp_case('empty yield_job', true, false, interval '10 minutes', NULL, false,
  public.model_fold_config() || '{"yield_job": ""}'::jsonb);
SELECT pg_temp.bp_case('job not listed', true, false, interval '10 minutes', NULL, false,
  public.model_fold_config() || '{"yield_job": "some-other-job"}'::jsonb);
-- Removing the job from the rule row turns the yield off.
UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{jobs}', (config_value -> 'jobs') - 'model-fold-tick')
 WHERE config_key = 'auction_close_yield';
SELECT pg_temp.bp_case('job removed from rule row', true, false, interval '10 minutes', NULL, false);
UPDATE public.platform_config SET config_value = jsonb_set(config_value, '{jobs}', (config_value -> 'jobs') || '["model-fold-tick"]')
 WHERE config_key = 'auction_close_yield';
-- A missing rule row raises (the reader's rule), so the tick turns red rather than running or skipping silently.
DO $$
DECLARE saved jsonb := (SELECT config_value FROM public.platform_config WHERE config_key = 'auction_close_yield');
BEGIN
  DELETE FROM public.platform_config WHERE config_key = 'auction_close_yield';
  BEGIN
    PERFORM public.model_fold_backpressure(public.model_fold_config());
    RAISE EXCEPTION 'missing rule row: expected a raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'auction_close_yield:%' THEN RAISE; END IF;
  END;
  INSERT INTO public.platform_config (config_key, config_value) VALUES ('auction_close_yield', saved);
END $$;
-- The other gates still work after the closes check.
DELETE FROM public.monitored_auctions;
DO $$ BEGIN
  IF coalesce(public.model_fold_backpressure(public.model_fold_config() || '{"max_active_backends": -1}'::jsonb), '') NOT LIKE 'active backends%' THEN
    RAISE EXCEPTION 'active-backends gate lost';
  END IF;
END $$;

-- The live tick: a closing lot -> one tick row skipped with the closes reason, nothing leased.
INSERT INTO public.monitored_auctions (is_live, auction_end_time) VALUES (true, now() + interval '5 minutes');
INSERT INTO public.model_fold_work (vehicle_id, priority, first_dirty_at) VALUES ('00000000-0000-0000-0000-0000000000a1', 1, now() - interval '4 hours');
CALL public.model_fold_tick();
DO $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.model_fold_ticks ORDER BY started_at DESC LIMIT 1;
  IF t.status IS DISTINCT FROM 'skipped' OR t.skip_reason NOT LIKE 'auction closes:%' THEN
    RAISE EXCEPTION 'tick: expected a closes skip, got % %', t.status, t.skip_reason;
  END IF;
  IF t.claimed <> 0 OR t.finished_at IS NULL THEN RAISE EXCEPTION 'tick: claimed % finished %', t.claimed, t.finished_at; END IF;
  IF EXISTS (SELECT 1 FROM public.model_fold_work WHERE state <> 'pending' OR attempts <> 0) THEN RAISE EXCEPTION 'tick: work leased'; END IF;
  IF (SELECT count(*) FROM public.model_fold_ticks) <> 1 THEN RAISE EXCEPTION 'tick: rows %', (SELECT count(*) FROM public.model_fold_ticks); END IF;
END $$;

-- The watch. No ok tick ever, signalled work dirty 4 h: yielding -> ok with the reason; otherwise stale / backlog raise.
DO $$
DECLARE r jsonb;
BEGIN
  r := public.assay_model_fold();
  IF NOT (r ->> 'yielding_to_closes')::boolean OR r ->> 'oldest_signal_dirty_at' IS NULL THEN RAISE EXCEPTION 'watch: expected yielding, got %', r; END IF;
END $$;
CREATE FUNCTION pg_temp.watch_raises(p_label text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.assay_model_fold();
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE p_like THEN RETURN; END IF;
    RAISE EXCEPTION '%: raised %', p_label, SQLERRM;
  END;
  RAISE EXCEPTION '%: expected a raise like %', p_label, p_like;
END $$;
-- a closes skip older than 2 minutes is not a current yield
UPDATE public.model_fold_ticks SET started_at = now() - interval '3 minutes';
SELECT pg_temp.watch_raises('old closes skip', 'model_fold stale:%');
-- a newer skip for another reason is not a yield
INSERT INTO public.model_fold_ticks (tick_id, status, skip_reason, started_at)
VALUES (gen_random_uuid(), 'skipped', 'lock waiters 30', now() - interval '10 seconds');
SELECT pg_temp.watch_raises('lock-waiter skip', 'model_fold stale:%');
-- an ok tick now: the backlog check raises when not yielding ...
INSERT INTO public.model_fold_ticks (tick_id, status, started_at, finished_at)
VALUES (gen_random_uuid(), 'ok', now() - interval '5 seconds', now() - interval '4 seconds');
SELECT pg_temp.watch_raises('backlog, not yielding', 'model_fold backlog:%');
-- ... and is held while yielding
INSERT INTO public.model_fold_ticks (tick_id, status, skip_reason, started_at)
VALUES (gen_random_uuid(), 'skipped', 'auction closes: model-fold-tick yields (auction_close_yield)', now() - interval '1 second');
DO $$ BEGIN
  IF NOT (public.assay_model_fold() ->> 'yielding_to_closes')::boolean THEN RAISE EXCEPTION 'watch: backlog not held while yielding'; END IF;
END $$;
-- dead letters still raise while yielding
INSERT INTO public.model_fold_work (vehicle_id, state) SELECT gen_random_uuid(), 'dead' FROM generate_series(1, 51);
SELECT pg_temp.watch_raises('dead letters while yielding', 'model_fold dead letters:%');
DELETE FROM public.model_fold_work WHERE state = 'dead';
-- not yielding and healthy: no yielding key
DELETE FROM public.model_fold_work;
INSERT INTO public.model_fold_ticks (tick_id, status, started_at, finished_at)
VALUES (gen_random_uuid(), 'ok', now(), now());
DO $$ BEGIN
  IF public.assay_model_fold() ? 'yielding_to_closes' THEN RAISE EXCEPTION 'watch: yielding key on a normal reading'; END IF;
END $$;

-- The logic key does not hash the backpressure, so the migration starts no pass (live definition, checked by name).
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'model_fold_backpressure') NOT LIKE '%auction_close_yield%' THEN RAISE EXCEPTION 'not applied'; END IF;
END $$;
\echo 'test_model_fold_yield_to_closes: ok'

-- model-fold-tick skips its work while auctions close, by the shared rule row auction_close_yield.
--
-- WHY (prod, read-only, 2026-11-25). Since 20:00 PT on 11-24 the tick has used 742-841 s of run time an hour, against
-- 10-136 s an hour on quiet hours (cron.job_run_details). That is not a slower fold: each tick spends its whole budget_ms
-- (6000) while a full-scope re-fold pass runs. The 20:00 PT hour folded 3,533 cars in 112 ticks, 197 ms a car, and the
-- 11-23 19:00-00:00 pass folded at 198-257 ms a car (model_fold_ticks). A pass starts when model_fold_logic_key() changes
-- and min_pass_hours has elapsed; merges touching the key's inputs at 19:54 and 23:43 PT started the passes at 20:00 and
-- 02:05 PT. A merge between 08:05 and 13:30 PT could start the next 4-5 hour pass while BaT lots close (10:00-13:30 PT).
--
-- RULE. The reader and rule row are 20261126033500 (public.auction_close_yield(job), platform_config
-- 'auction_close_yield'); this migration needs them and stops if they are missing. It adds 'model-fold-tick' to that row's
-- jobs, and the model_fold config row gains yield_job = 'model-fold-tick', naming the job the loop yields as.
--
-- WHERE. model_fold_backpressure(cfg) is the tick's first gate after it takes its lock and records its tick row. It now
-- returns 'auction closes: ...' first when cfg names a yield_job and auction_close_yield(yield_job) is true, so the tick
-- writes status 'skipped' with that skip_reason, claims nothing and returns. spec_landing_drain_v1 and
-- spec_landing_autoqueue_v1 call the same function with '{}' (no yield_job) and behave as before. No job is unscheduled;
-- the tick resumes by itself when the window is empty. Removing model-fold-tick from the jobs array turns the yield off.
--
-- WATCH. assay_model_fold (job model-fold-watch, minute 17) raised 'stale' when no tick finished ok for 15 minutes and
-- 'backlog' when signalled work waited 3 hours. While the newest tick is a closes skip under 2 minutes old, those two
-- checks are held and the reading says yielding_to_closes with the oldest signalled dirty time; dead letters and bad ticks
-- still raise.
--
-- Not changed: model_fold_tick, model_fold_logic_key (backpressure is not one of its inputs, so this starts no pass),
-- any index or schedule.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $need$
BEGIN
  IF to_regprocedure('public.auction_close_yield(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'auction_close_yield') THEN
    RAISE EXCEPTION 'model_fold yield: needs public.auction_close_yield(text) and its rule row (20261126033500) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'model_fold') THEN
    RAISE EXCEPTION 'model_fold yield: rule row platform_config model_fold is missing';
  END IF;
END
$need$;

-- The two bodies replaced below are the live ones read 2026-11-25 (prosrc md5), or this migration's own (re-apply).
DO $anchor$
DECLARE
  b text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.model_fold_backpressure(jsonb)'::regprocedure);
  a text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.assay_model_fold()'::regprocedure);
BEGIN
  IF md5(b) <> '27111d19a8b67bc0871066d7c476a8ed' AND b NOT LIKE '%yield_job%' THEN
    RAISE EXCEPTION 'model_fold yield: model_fold_backpressure drifted from the live body read 2026-11-25 (md5 %)', md5(b);
  END IF;
  IF md5(a) <> '54509aafbd28dac64df49e0cfdb461b4' AND a NOT LIKE '%yielding_to_closes%' THEN
    RAISE EXCEPTION 'model_fold yield: assay_model_fold drifted from the live body read 2026-11-25 (md5 %)', md5(a);
  END IF;
END
$anchor$;

UPDATE public.platform_config
   SET config_value = jsonb_set(config_value, '{jobs}', (config_value -> 'jobs') || '["model-fold-tick"]'::jsonb),
       updated_at = now()
 WHERE config_key = 'auction_close_yield' AND jsonb_typeof(config_value -> 'jobs') = 'array'
   AND NOT (config_value -> 'jobs') ? 'model-fold-tick';

UPDATE public.platform_config
   SET config_value = config_value || '{"yield_job": "model-fold-tick"}'::jsonb, updated_at = now()
 WHERE config_key = 'model_fold' AND NOT (config_value ? 'yield_job');

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'auction_close_yield'
                  AND (config_value -> 'jobs') ? 'model-fold-tick') THEN
    RAISE EXCEPTION 'model_fold yield: model-fold-tick is not in auction_close_yield.jobs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'model_fold' AND config_value ? 'yield_job') THEN
    RAISE EXCEPTION 'model_fold yield: model_fold config has no yield_job';
  END IF;
END
$chk$;

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

CREATE OR REPLACE FUNCTION public.assay_model_fold()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare f record; v_yield boolean;
begin
  select * into f from public.model_fold_freshness;
  if not f.enabled then return jsonb_build_object('enabled', false); end if;
  -- The newest tick skipped for auction closes under 2 minutes ago: the loop is yielding on purpose (auction_close_yield),
  -- so no ok tick and waiting signalled work are expected until the window is empty.
  select coalesce(t.status = 'skipped' and t.skip_reason like 'auction closes:%' and t.started_at > now() - interval '2 minutes', false)
    into v_yield
    from (select status, skip_reason, started_at from public.model_fold_ticks order by started_at desc limit 1) t;
  v_yield := coalesce(v_yield, false);
  if not v_yield and (f.last_ok_tick_at is null or f.last_ok_tick_at < now() - interval '15 minutes') then
    raise exception 'model_fold stale: last ok tick %', coalesce(f.last_ok_tick_at::text, 'never');
  end if;
  if not v_yield and f.oldest_signal_dirty_at < now() - interval '3 hours' then
    raise exception 'model_fold backlog: signalled work dirty since %', f.oldest_signal_dirty_at;
  end if;
  if f.dead > 50 then raise exception 'model_fold dead letters: %', f.dead; end if;
  if f.bad_ticks_1h >= 5 then raise exception 'model_fold bad ticks in last hour: %', f.bad_ticks_1h; end if;
  return jsonb_build_object('ok', true, 'pending', f.pending, 'dead', f.dead, 'folded_last_hour', f.folded_last_hour,
                            'signals_waiting', f.signals_waiting, 'last_ok_tick_at', f.last_ok_tick_at)
         || case when v_yield then jsonb_build_object('yielding_to_closes', true, 'oldest_signal_dirty_at', f.oldest_signal_dirty_at)
                 else '{}'::jsonb end;
end $function$;

COMMIT;

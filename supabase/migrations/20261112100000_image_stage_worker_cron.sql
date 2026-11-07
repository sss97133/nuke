-- Stage worker tick: calls photo-pipeline-orchestrator {action:'run_stage', stage:'classifier'} which claims
-- image_stage_work (claim_image_stage_work) and runs only that stage. Requires 20261112090000 (PR #3027).
-- INERT by default: gated by the SAME flag as the reconciler, platform_config image_stage_reconciler.enabled (default
-- false). The function re-checks the flag itself, so enabling needs no schedule change and disabling stops the next tick.
set local statement_timeout = '30s';
set local lock_timeout = '10s';

create or replace function public.image_stage_worker_tick(p_stage text default 'classifier', p_limit integer default 4)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cfg jsonb; v_req bigint;
begin
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('skipped', 'disabled');
  end if;
  -- nothing queued: no HTTP call, no cold start
  if not exists (select 1 from public.image_stage_work where stage = p_stage and status = 'queued' and not_before <= now()) then
    return jsonb_build_object('skipped', 'queue_empty');
  end if;
  v_req := net.http_post(
    url := public.get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || public.get_service_role_key_for_cron()),
    body := jsonb_build_object('action', 'run_stage', 'stage', p_stage, 'limit', least(greatest(p_limit, 1), 8), 'deadline_ms', 100000),
    timeout_milliseconds := 120000);
  return jsonb_build_object('requested', v_req, 'stage', p_stage);
end $$;
comment on function public.image_stage_worker_tick(text, integer) is
  'Cron entry for the single-stage worker. No-op unless platform_config image_stage_reconciler.enabled=true and work is queued.';
revoke all on function public.image_stage_worker_tick(text, integer) from public, anon, authenticated;
grant execute on function public.image_stage_worker_tick(text, integer) to service_role;

-- every 5 minutes (edge-function rule: nothing faster); offset from the reconciler's */5
select cron.schedule('image-stage-worker-classifier', '2-59/5 * * * *', $c$select public.image_stage_worker_tick('classifier', 4)$c$);

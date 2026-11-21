-- Revert of 20261120183500_first_read_queued_at_landing.sql: the four replaced functions go back to the bodies
-- production held on 2026-11-20 (read with pg_get_functiondef before the change), enqueue_first_read is dropped and
-- the two keys the migration added to platform_config 'image_stage_reconciler' are removed. Work items it queued stay:
-- they are ordinary first-read items, and the reader and the reconciler handle them as any other.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

-- Each function must hold this migration's body, or already the one this file puts back (a second run changes
-- nothing). Anything else is a later change, and putting the 2026-11-20 body over it would discard that change.
do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.trigger_photo_pipeline_orchestrator()', '7f4ca0dd8c113e4ad3e0b598a309d9dd', 'd1c9f863d032d4165bbcef4ab51cf87e'),
      ('public.photo_pipeline_note_failure(uuid,text,integer,text)', '67c780fd9014369409c30f632cd10756', 'cc355c2f54ef36a0200dbaa812e1f71a'),
      ('public.photo_pipeline_clear_retry(uuid)', '224bf3fc0d48429dea2dbd802903342b', 'ea40463ac96e59b6613a454f34cffb69'),
      ('public.claim_photo_pipeline_batch(integer,integer)', 'fdc2cfcaa4afaa53c94f33b383224e22', '0c3285789eed70d1a52315d719262df6')) as t(fn, md5_before, md5_after) loop
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') not in (r.md5_before, r.md5_after) then
      raise exception '% was changed after 20261120183500 (md5 %); this revert would discard that change', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

CREATE OR REPLACE FUNCTION public.trigger_photo_pipeline_orchestrator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.ai_processing_status = 'pending' AND NEW.image_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := jsonb_build_object(
        'image_id', NEW.id,
        'image_url', NEW.image_url,
        'vehicle_id', NEW.vehicle_id,
        'user_id', NEW.user_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Non-blocking by design: the drain cron picks up anything this misses.
  RAISE WARNING 'photo-pipeline trigger failed (pg_net?): %', SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.photo_pipeline_note_failure(p_image_id uuid, p_error_class text, p_http_status integer DEFAULT NULL::integer, p_fallback_error_class text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_transient boolean; v_rl boolean; v_max int; v_att int; v_rl_att int; v_delay numeric; v_next timestamptz; v_terminal boolean; v_cf int; v_block numeric;
begin
  v_rl := p_error_class in ('classifier_rate_limited','provider_cooldown','classifier_usage_budget_exceeded')
          or p_http_status in (429, 402)
          or p_fallback_error_class = 'classifier_rate_limited';
  v_transient := v_rl or p_error_class in ('classifier_timeout','classifier_request_error','image_download_timeout','image_download_error','classifier_key_missing','pipeline_operation_failed','classifier_response_invalid','classifier_response_incomplete','classifier_response_empty','classifier_usage_missing')
    or (p_error_class in ('classifier_http_error','classifier_count_http_error','image_http_error') and (p_http_status in (408,425) or coalesce(p_http_status,0) >= 500));
  v_max := case when p_error_class like 'classifier_response_%' or p_error_class like 'classifier_usage_%' or p_error_class = 'pipeline_operation_failed' then 3 else 8 end;
  insert into public.photo_pipeline_retry_state as r (image_id, attempts, rate_limited_attempts, last_error_class, last_http_status, last_fallback_error_class, updated_at)
  values (p_image_id, 1, case when v_rl then 1 else 0 end, p_error_class, p_http_status, p_fallback_error_class, now())
  on conflict (image_id) do update set
    attempts = r.attempts + case when v_rl then 0 else 1 end,            -- provider-wide rate limits do not burn the per-image budget
    rate_limited_attempts = r.rate_limited_attempts + case when v_rl then 1 else 0 end,
    last_error_class = p_error_class, last_http_status = p_http_status, last_fallback_error_class = p_fallback_error_class, updated_at = now()
  returning r.attempts, r.rate_limited_attempts into v_att, v_rl_att;

  if v_rl then
    -- provider circuit breaker: exponential, jittered, capped at 6h; credit exhaustion (402) starts at 30 min
    update public.photo_pipeline_provider_state set consecutive_failures = consecutive_failures + 1, last_http_status = p_http_status,
           last_error_class = p_error_class, updated_at = now() where provider = 'classifier' returning consecutive_failures into v_cf;
    v_block := least(21600, (case when p_http_status = 402 then 1800 else 60 end) * power(2, least(v_cf, 8) - 1)) * (0.8 + random() * 0.4);
    update public.photo_pipeline_provider_state set blocked_until = greatest(coalesce(blocked_until, now()), now() + make_interval(secs => v_block)),
           note = case when p_http_status = 402 then 'provider returned 402 (credits exhausted?) - owner action needed' else 'rate limited' end
     where provider = 'classifier';
    v_terminal := v_rl_att >= 12;                                         -- ~days of spaced attempts before giving up on an image
    v_delay := least(21600, 300 * power(2, v_rl_att - 1)) * (0.8 + random() * 0.4);
  else
    v_terminal := not v_transient or v_att >= v_max;
    v_delay := least(7200, 120 * power(2, v_att - 1)) * (0.8 + random() * 0.4);
  end if;
  if v_terminal then
    update public.photo_pipeline_retry_state set terminal = true, next_attempt_at = null where image_id = p_image_id;
    return jsonb_build_object('status','failed','transient',v_transient,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',null);
  end if;
  v_next := now() + make_interval(secs => v_delay);
  update public.photo_pipeline_retry_state set next_attempt_at = v_next, terminal = false where image_id = p_image_id;
  return jsonb_build_object('status','pending','transient',true,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',v_next);
end $function$;

CREATE OR REPLACE FUNCTION public.photo_pipeline_clear_retry(p_image_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.photo_pipeline_retry_state where image_id = p_image_id;
  update public.photo_pipeline_provider_state set consecutive_failures = 0, blocked_until = null, note = 'healthy', updated_at = now()
   where provider = 'classifier' and (consecutive_failures > 0 or blocked_until is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.claim_photo_pipeline_batch(p_limit integer DEFAULT 8, p_lease_seconds integer DEFAULT 300)
 RETURNS TABLE(id uuid, image_url text, vehicle_id uuid, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb; v_cut timestamptz := '-infinity';
begin
  -- circuit breaker: while the provider is cooling down nobody claims (no hammering, no attempts burnt)
  if exists (select 1 from public.photo_pipeline_provider_state s where s.provider = 'classifier' and s.blocked_until > now()) then return; end if;
  select config_value into v_cfg from public.platform_config where config_key = 'photo_pipeline_backlog';
  if v_cfg is not null and coalesce((v_cfg->>'enabled')::boolean, true) = false then
    v_cut := now() - make_interval(days => coalesce((v_cfg->>'recent_days')::int, 14));
  end if;
  return query
  with cand as (
    select v.id from public.vehicle_images v
    where v.ai_processing_status = 'pending' and v.user_id is not null and v.is_duplicate = false and v.image_url is not null
      and v.created_at >= v_cut
      and not exists (select 1 from public.photo_pipeline_retry_state r
                       where r.image_id = v.id and (r.terminal or r.next_attempt_at is null or r.next_attempt_at > now()))
    order by v.created_at desc
    limit least(greatest(p_limit, 1), 25)
    for update of v skip locked
  ), lease as (
    insert into public.photo_pipeline_retry_state as r (image_id, attempts, next_attempt_at, updated_at)
    select c.id, 0, now() + make_interval(secs => p_lease_seconds), now() from cand c
    on conflict (image_id) do update set next_attempt_at = excluded.next_attempt_at, updated_at = now()   -- attempts preserved
    returning r.image_id
  )
  select v.id, v.image_url, v.vehicle_id, v.user_id from public.vehicle_images v join lease l on l.image_id = v.id;
end $function$;

drop function if exists public.enqueue_first_read(uuid);
update public.platform_config
   set config_value = config_value - 'first_read_at_landing' - 'provider_fallback_after_minutes'
 where config_key = 'image_stage_reconciler' and jsonb_typeof(config_value) = 'object';

commit;

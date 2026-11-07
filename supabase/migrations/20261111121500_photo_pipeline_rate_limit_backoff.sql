-- Classifier provider-aware recovery.
-- 2026-11-07 test report: 500 consecutive HTTP 429s tripped the provider breaker and halted all new classifier work,
-- with failed receipts on the images. A 429/402 is a provider-wide condition, not a verdict on a photo.
-- Changes:
--  * note_failure honours the provider's Retry-After as a floor, keeps jittered exponential backoff, and lets the
--    consecutive-limit counter DECAY after 30 quiet minutes so one burst cannot hold the breaker at its cap forever.
--  * per-provider concurrency (AIMD): halved on each rate limit (min 1), +1 on each success (max 8).
--  * claim is half-open: when the cooldown ends it hands out at most max_concurrency rows, so recovery is a probe,
--    not a stampede. While blocked it still claims nothing, but only classifier-bound rows pass through it;
--    programmatic stages (EXIF, VIN/GPS filing, grouping) never read this table.
--  * rate-limited images are requeued ('pending' + next_attempt_at), never terminal because of the provider
--    (the orchestrator writes outcome 'deferred', not 'failed').
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.photo_pipeline_provider_state add column if not exists max_concurrency int not null default 8;

drop function if exists public.photo_pipeline_note_failure(uuid, text, integer, text);
create or replace function public.photo_pipeline_note_failure(
  p_image_id uuid, p_error_class text, p_http_status integer default null, p_fallback_error_class text default null,
  p_retry_after_seconds numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_transient boolean; v_rl boolean; v_max int; v_att int; v_rl_att int; v_delay numeric; v_next timestamptz; v_terminal boolean;
  v_cf int; v_block numeric; v_floor numeric := least(greatest(coalesce(p_retry_after_seconds, 0), 0), 21600);
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
    attempts = r.attempts + case when v_rl then 0 else 1 end,
    rate_limited_attempts = r.rate_limited_attempts + case when v_rl then 1 else 0 end,
    last_error_class = p_error_class, last_http_status = p_http_status, last_fallback_error_class = p_fallback_error_class, updated_at = now()
  returning r.attempts, r.rate_limited_attempts into v_att, v_rl_att;

  if v_rl then
    -- the counter decays: a burst older than 30 min starts over instead of pinning the cooldown at its cap
    update public.photo_pipeline_provider_state set
           consecutive_failures = case when updated_at < now() - interval '30 minutes' then 1 else consecutive_failures + 1 end,
           max_concurrency = greatest(1, max_concurrency / 2),
           last_http_status = p_http_status, last_error_class = p_error_class, updated_at = now()
     where provider = 'classifier' returning consecutive_failures into v_cf;
    v_block := least(21600, (case when p_http_status = 402 then 1800 else 60 end) * power(2, least(v_cf, 8) - 1)) * (0.8 + random() * 0.4);
    v_block := least(21600, greatest(v_block, v_floor * (1 + random() * 0.25)));   -- Retry-After is a floor, never undercut
    update public.photo_pipeline_provider_state set blocked_until = greatest(coalesce(blocked_until, now()), now() + make_interval(secs => v_block)),
           note = case when p_http_status = 402 then 'provider returned 402 (credits exhausted?) - owner action needed' else 'rate limited; requeued, backing off' end
     where provider = 'classifier';
    v_terminal := v_rl_att >= 12;
    v_delay := greatest(least(21600, 300 * power(2, v_rl_att - 1)) * (0.8 + random() * 0.4), v_floor);
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
end $$;
revoke all on function public.photo_pipeline_note_failure(uuid, text, integer, text, numeric) from public, anon, authenticated;
grant execute on function public.photo_pipeline_note_failure(uuid, text, integer, text, numeric) to service_role;

-- success: breaker closes, concurrency climbs back one step at a time
create or replace function public.photo_pipeline_clear_retry(p_image_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.photo_pipeline_retry_state where image_id = p_image_id;
  update public.photo_pipeline_provider_state set consecutive_failures = 0, blocked_until = null, note = 'healthy',
         max_concurrency = least(8, max_concurrency + 1), updated_at = now()
   where provider = 'classifier' and (consecutive_failures > 0 or blocked_until is not null or max_concurrency < 8);
end $$;

-- claim: blocked => nothing; half-open/healthy => at most max_concurrency rows
create or replace function public.claim_photo_pipeline_batch(p_limit integer default 8, p_lease_seconds integer default 300)
returns table(id uuid, image_url text, vehicle_id uuid, user_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_cut timestamptz := '-infinity'; v_conc int := 8;
begin
  select coalesce(s.max_concurrency, 8) into v_conc from public.photo_pipeline_provider_state s where s.provider = 'classifier';
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
    limit least(greatest(p_limit, 1), 25, greatest(v_conc, 1))
    for update of v skip locked
  ), lease as (
    insert into public.photo_pipeline_retry_state as r (image_id, attempts, next_attempt_at, updated_at)
    select c.id, 0, now() + make_interval(secs => p_lease_seconds), now() from cand c
    on conflict (image_id) do update set next_attempt_at = excluded.next_attempt_at, updated_at = now()
    returning r.image_id
  )
  select v.id, v.image_url, v.vehicle_id, v.user_id from public.vehicle_images v join lease l on l.image_id = v.id;
end $$;

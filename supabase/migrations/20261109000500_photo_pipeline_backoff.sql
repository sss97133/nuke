-- Photo-landing v3 (5/6): classifier rate-limit handling without blind requeue + duplicate-copy cleanup.
--
-- Root causes found:
--  * claim_photo_pipeline_batch re-claimed rows whose retry state was TERMINAL (next_attempt_at is NULL, so
--    `next_attempt_at > now()` is NULL => not excluded) -> attempts climbed into the thousands.
--  * note_failure burned the 8-attempt budget in minutes on 429/402 (a provider-wide condition, not a per-image one).
--  * reset_stuck_photo_pipeline_images blindly flipped 'failed' back to 'pending' regardless of retry state / provider health.
--  * ~1.8k duplicate copies sat in 'pending' forever (claim ignores them but they were never settled).
-- Fix: provider-level circuit breaker with exponential backoff, rate-limit attempts counted separately (much longer budget),
-- claim/reset honour terminal rows, backoff windows and the breaker; duplicates are settled as 'skipped'.
-- NOTE for the owner: the classifier fallback provider returns HTTP 402 (credits exhausted) - that needs a top-up; the breaker
-- only stops the hammering, it cannot create credit.

alter table photo_pipeline_retry_state add column if not exists rate_limited_attempts int not null default 0;

create table if not exists photo_pipeline_provider_state (
  provider text primary key,
  blocked_until timestamptz,
  consecutive_failures int not null default 0,
  last_http_status int,
  last_error_class text,
  note text,
  updated_at timestamptz not null default now()
);
insert into photo_pipeline_provider_state (provider) values ('classifier') on conflict do nothing;

create or replace function public.photo_pipeline_note_failure(p_image_id uuid, p_error_class text, p_http_status integer default null, p_fallback_error_class text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;

-- success path: also relaxes the breaker
create or replace function public.photo_pipeline_clear_retry(p_image_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.photo_pipeline_retry_state where image_id = p_image_id;
  update public.photo_pipeline_provider_state set consecutive_failures = 0, blocked_until = null, note = 'healthy', updated_at = now()
   where provider = 'classifier' and (consecutive_failures > 0 or blocked_until is not null);
end $$;

create or replace function public.claim_photo_pipeline_batch(p_limit integer default 8, p_lease_seconds integer default 300)
returns table(id uuid, image_url text, vehicle_id uuid, user_id uuid)
language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.reset_stuck_photo_pipeline_images()
returns table(requeued_processing integer, requeued_failed integer, dead_lettered integer)
language plpgsql security definer set search_path = public as $$
declare v_processing int := 0; v_failed int := 0; v_dead int := 0; c_batch constant int := 200; v_blocked boolean;
begin
  v_blocked := exists (select 1 from public.photo_pipeline_provider_state s where s.provider = 'classifier' and s.blocked_until > now());
  with stuck as (
    select id from vehicle_images
    where ai_processing_status = 'processing' and updated_at < now() - interval '30 minutes' and updated_at > now() - interval '7 days' and ai_retry_count < 3
    order by updated_at desc limit c_batch for update skip locked
  ), upd as (
    update vehicle_images v set ai_processing_status = 'pending', ai_retry_count = ai_retry_count + 1 from stuck where v.id = stuck.id returning v.id
  ) select count(*) into v_processing from upd;

  -- 'failed' -> 'pending' only when: provider healthy, the retry state is not terminal and its backoff window has elapsed
  if not v_blocked then
    with retryable as (
      select v.id from vehicle_images v
      where v.ai_processing_status = 'failed' and v.updated_at < now() - interval '10 minutes' and v.updated_at > now() - interval '7 days'
        and v.ai_retry_count < 3 and v.is_duplicate is not true and v.image_url is not null
        and not exists (select 1 from photo_pipeline_retry_state r where r.image_id = v.id and (r.terminal or r.next_attempt_at > now()))
      order by v.updated_at desc limit c_batch for update skip locked
    ), upd2 as (
      update vehicle_images v set ai_processing_status = 'pending', ai_retry_count = ai_retry_count + 1 from retryable where v.id = retryable.id returning v.id
    ) select count(*) into v_failed from upd2;
  end if;

  with dead as (
    select id from vehicle_images
    where ai_processing_status = 'processing' and updated_at < now() - interval '30 minutes' and updated_at > now() - interval '7 days' and ai_retry_count >= 3
    order by updated_at desc limit c_batch for update skip locked
  ), upd3 as (
    update vehicle_images v set ai_processing_status = 'failed' from dead where v.id = dead.id returning v.id
  ) select count(*) into v_dead from upd3;
  return query select v_processing, v_failed, v_dead;
end $$;

-- Duplicate copies that will never be analysed (claim ignores is_duplicate) are settled as 'skipped' (logged, revertible).
create or replace function public.photo_pipeline_skip_duplicate_pending(p_user uuid, p_run uuid, p_dry boolean default true, p_limit int default 5000)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '120s' as $$
declare n int;
begin
  create temp table _dp on commit drop as
    select id, ai_processing_status st, is_duplicate, duplicate_of from vehicle_images
     where user_id = p_user and ai_processing_status = 'pending' and (is_duplicate or duplicate_of is not null or is_superseded)
     order by created_at limit p_limit;
  select count(*) into n from _dp;
  if p_dry then return jsonb_build_object('dry', true, 'would_skip', n); end if;
  insert into profile_fix_log (run_id, rule, vehicle_id, target_table, target_pk, column_name, op, before, after, evidence)
    select p_run, 'skip_duplicate_pending', null, 'vehicle_images', id, 'ai_processing_status', 'update', to_jsonb('pending'::text), to_jsonb('skipped'::text),
           jsonb_build_object('is_duplicate', is_duplicate, 'duplicate_of', duplicate_of) from _dp;
  update vehicle_images v set ai_processing_status = 'skipped' from _dp d where v.id = d.id and v.user_id = p_user and v.ai_processing_status = 'pending';
  return jsonb_build_object('dry', false, 'skipped', n, 'run_id', p_run, 'revert', 'select profile_fix_revert(''' || p_run || ''')');
end $$;

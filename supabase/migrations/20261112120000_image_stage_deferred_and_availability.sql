-- Follow-up to #3032: nothing sits 'pending'/abandoned after a rate-limit cap, and 'unavailable' stages retry once deployed.
--
-- (1) DEFERRED. A provider rate limit is not a verdict on a photo, so reaching a cap on it must not end the work.
--   * Image level: the image stays ai_processing_status='pending' (it truly is unclassified; vehicle_images is the hottest
--     public table and its status check/readers are not touched). The marker lives in photo_pipeline_retry_state:
--     deferred_at + deferrals. photo_pipeline_note_failure parks the row (next_attempt_at NULL, terminal=false) instead of
--     terminal=true when the RATE-LIMIT budget is spent. Not 'failed', so no failure counter, report or breaker counts it.
--   * Work-item level: image_stage_work.status='deferred' (deferred_reason 'provider_rate_limited') when an item reaches
--     max_attempts and its newest receipt is rate_limited, or a rate_limited receipt lands at the receipt cap. Not 'dead'.
--   * Recovery: photo_pipeline_requeue_deferred() / requeue_deferred_image_stage_work() run from the reconciler cron
--     (reconcile_image_pipeline) ONLY while the classifier provider has no active cooldown. Bounded per run (limit, and
--     the provider's max_concurrency for images), staggered, idempotent (the marker is cleared in the same statement), and
--     bounded in total: after max_deferrals (3) a work item goes dead (max_attempts_exceeded) and an image stays visibly
--     deferred (counted as 'exhausted') for the owner, never silently pending.
-- (2) AVAILABILITY. image_pipeline_stages.available / available_since / last_probed_at. An 'unavailable' receipt sets
--     available=false; a 'succeeded' receipt, or a probe (worker action probe_stages: OPTIONS on the edge function, 404 =
--     not deployed) sets it true. enqueue_available_stage_retries() enqueues unavailable receipts of any stage that is now
--     available, whether or not required=true, ignoring retry_after (the signal supersedes the guess), bounded by
--     max_attempts and a per-run cap.
-- Gate: the image-level requeue has its own flag (photo_pipeline_deferred_requeue, default on: it only reopens the already
-- live claim path at a bounded rate); everything stage-level stays behind image_stage_reconciler.enabled.

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- ------------------------------------------------------------------ schema
alter table public.photo_pipeline_retry_state add column if not exists deferred_at timestamptz;
alter table public.photo_pipeline_retry_state add column if not exists deferrals integer not null default 0;
create index if not exists photo_pipeline_retry_state_deferred_idx on public.photo_pipeline_retry_state (deferred_at) where deferred_at is not null;

alter table public.image_stage_work add column if not exists deferred_reason text;
alter table public.image_stage_work add column if not exists deferrals integer not null default 0 check (deferrals >= 0);
alter table public.image_stage_work drop constraint if exists image_stage_work_status_check;
alter table public.image_stage_work add constraint image_stage_work_status_check check (status in ('queued', 'claimed', 'done', 'dropped', 'dead', 'deferred'));
alter table public.image_stage_work drop constraint if exists image_stage_work_deferred_typed;
alter table public.image_stage_work add constraint image_stage_work_deferred_typed check ((status = 'deferred') = (deferred_reason is not null) and (deferred_reason is null or deferred_reason in ('provider_rate_limited')));
create unique index if not exists image_stage_work_one_deferred on public.image_stage_work (image_id, stage) where status = 'deferred';
create index if not exists image_stage_work_deferred_idx on public.image_stage_work (stage, created_at) where status = 'deferred';
comment on column public.image_stage_work.deferred_reason is 'Typed reason for status=deferred (provider_rate_limited). Deferred is not dead and not failed: the reconciler re-queues it when the provider has no cooldown.';
comment on column public.image_stage_work.deferrals is 'Times this item was deferred and re-queued. At 3 the next cap makes it dead.';
comment on column public.photo_pipeline_retry_state.deferred_at is 'Set when the rate-limit budget was spent: the image stays pending but is parked until photo_pipeline_requeue_deferred() reopens it while the provider is healthy.';

alter table public.image_pipeline_stages add column if not exists available boolean;
alter table public.image_pipeline_stages add column if not exists available_since timestamptz;
alter table public.image_pipeline_stages add column if not exists last_probed_at timestamptz;
comment on column public.image_pipeline_stages.available is 'NULL unknown; false = a receipt or probe saw the stage not deployed; true = a succeeded receipt or a probe saw it live.';
comment on column public.image_pipeline_stages.available_since is 'When available last became true.';
create index if not exists image_stage_receipts_unavailable_idx on public.image_stage_receipts (stage, observed_at) where outcome = 'unavailable';

insert into public.platform_config (config_key, config_value, description) values
  ('photo_pipeline_deferred_requeue', '{"enabled": true, "batch": 25, "max_deferrals": 3, "stagger_seconds": 20}'::jsonb,
   'photo_pipeline_requeue_deferred(): reopen images parked after the rate-limit budget, only while the classifier provider has no cooldown.')
on conflict (config_key) do nothing;

-- ------------------------------------------------------------------ availability writer
create or replace function public.set_image_stage_availability(p_stage text, p_available boolean, p_probed boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.image_pipeline_stages set
         available = p_available,
         available_since = case when p_available and available is distinct from true then now() when p_available then available_since else null end,
         last_probed_at = case when p_probed then now() else last_probed_at end
   where stage = p_stage;
end $$;

-- ------------------------------------------------------------------ cap outcome: deferred (provider) or dead
create or replace function public.image_stage_cap_outcome(p_image_id uuid, p_stage text, p_deferrals integer)
returns text language sql stable set search_path = public, pg_temp as $$
  select case when p_deferrals < 3 and exists (
           select 1 from public.image_stage_current c where c.image_id = p_image_id and c.stage = p_stage and c.outcome = 'rate_limited')
         then 'deferred' else 'dead' end
$$;

-- ------------------------------------------------------------------ receipt writer: availability + deferral at the receipt cap
create or replace function public.record_image_stage_receipt(
  p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text,
  p_error_class text default null, p_http_status integer default null, p_retry_after_seconds integer default null,
  p_input_fingerprint text default null, p_detail jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_producer text; v_max int; v_attempt int; v_id bigint; v_capped boolean;
begin
  select producer, max_attempts into v_producer, v_max from public.image_pipeline_stages where stage = p_stage;
  if v_producer is null then raise exception 'unknown stage %', p_stage; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_image_id::text || ':' || p_stage || ':' || p_producer_version, 0));
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.image_stage_receipts
   where image_id = p_image_id and stage = p_stage and producer_version = p_producer_version;
  insert into public.image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, retry_after, error_class, http_status, input_fingerprint, detail)
  values (p_image_id, p_stage, v_producer, p_producer_version, p_outcome, v_attempt,
          case when p_outcome in ('unavailable', 'rate_limited') then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 300), 0), 86400)) end,
          p_error_class, p_http_status, p_input_fingerprint, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;

  -- availability signal: the stage ran = deployed; the stage was missing = not deployed
  if p_outcome = 'succeeded' then perform public.set_image_stage_availability(p_stage, true, false);
  elsif p_outcome = 'unavailable' then perform public.set_image_stage_availability(p_stage, false, false);
  end if;

  v_capped := p_outcome = 'rate_limited' and v_attempt >= v_max;
  -- close the open item; a rate limit that spent the receipt budget defers it (not done, not dead), bounded by deferrals
  update public.image_stage_work w set
         status = case when v_capped then public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) else 'done' end,
         dead_reason = case when v_capped and public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'dead' then 'max_attempts_exceeded' end,
         deferred_reason = case when v_capped and public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'deferred' then 'provider_rate_limited' end,
         finished_at = now(), lease_until = null
   where w.image_id = p_image_id and w.stage = p_stage and w.status in ('queued', 'claimed', 'deferred');
  if v_capped and not found and not exists (select 1 from public.image_stage_work w where w.image_id = p_image_id and w.stage = p_stage and w.status in ('deferred', 'dead')) then
    -- the receipt came from a path with no work item (the live orchestrator): park it so the cap is not an abandonment
    insert into public.image_stage_work (image_id, stage, target_version, reason, lane, status, deferred_reason, finished_at)
    values (p_image_id, p_stage, p_producer_version, 'retryable_outcome', 'backfill', 'deferred', 'provider_rate_limited', now());
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ gap finder: a deferred item owns its gap
create or replace function public.image_stage_gaps(p_image_ids uuid[])
returns table(image_id uuid, stage text, reason text, target_version integer, not_before timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select v.id, s.stage,
         case when c.image_id is null and public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key) then 'retryable_outcome'
              when c.image_id is null then 'missing'
              when c.producer_version < s.required_version then 'outdated'
              else 'retryable_outcome' end,
         s.required_version,
         greatest(now(), coalesce(c.retry_after, now()))
  from public.vehicle_images v
  join public.image_pipeline_stages s on s.required
  left join public.image_stage_current c on c.image_id = v.id and c.stage = s.stage
  where v.id = any (p_image_ids)
    and not exists (select 1 from public.image_stage_work d where d.image_id = v.id and d.stage = s.stage and d.status = 'dead' and d.target_version >= s.required_version)
    and not exists (select 1 from public.image_stage_work d where d.image_id = v.id and d.stage = s.stage and d.status = 'deferred')
    and (s.applies_when = 'always'
         or (s.applies_when = 'document_like' and coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') in ('receipt', 'document', 'invoice', 'text_document')))
    and (
      (c.image_id is null and (not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data)
                               or public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key)))
      or (c.producer_version < s.required_version and not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data))
      or (c.producer_version >= s.required_version and c.outcome in ('unavailable', 'rate_limited')
          and c.retry_after <= now()
          and c.attempt < s.max_attempts)
    )
$$;

-- ------------------------------------------------------------------ claim / lease expiry: cap -> deferred or dead
create or replace function public.claim_image_stage_work(p_stage text, p_limit integer default 8, p_lease_seconds integer default 300)
returns table(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  update public.image_stage_work w set
         status = public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals),
         dead_reason = case when public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'dead' then 'max_attempts_exceeded' end,
         deferred_reason = case when public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'deferred' then 'provider_rate_limited' end,
         finished_at = now(), lease_until = null
   from public.image_pipeline_stages s
   where s.stage = w.stage and w.stage = p_stage and w.status = 'queued' and w.attempts >= s.max_attempts;
  if p_stage = 'classifier' and exists (select 1 from public.photo_pipeline_provider_state p where p.provider = 'classifier' and p.blocked_until > now()) then return; end if;
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
    ), pick as (
      select d.id from due d order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
    ), locked as (
      select w.id from public.image_stage_work w where w.id in (select id from pick) and w.status = 'queued' for update skip locked
    ), upd as (
      update public.image_stage_work w set status = 'claimed', attempts = w.attempts + 1,
             lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
      from locked where w.id = locked.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id;
end $$;

create or replace function public.release_expired_image_stage_work()
returns integer language sql security definer set search_path = public, pg_temp as $$
  with r as (update public.image_stage_work w
                set status = case when w.attempts >= s.max_attempts then public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) else 'queued' end,
                    dead_reason = case when w.attempts >= s.max_attempts and public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'dead' then 'max_attempts_exceeded' end,
                    deferred_reason = case when w.attempts >= s.max_attempts and public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'deferred' then 'provider_rate_limited' end,
                    finished_at = case when w.attempts >= s.max_attempts then now() end,
                    lease_until = null
               from public.image_pipeline_stages s
              where s.stage = w.stage and w.status = 'claimed' and w.lease_until < now() returning 1)
  select count(*)::int from r
$$;

-- ------------------------------------------------------------------ image level: park instead of terminal on a spent rate-limit budget
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
    update public.photo_pipeline_provider_state set
           consecutive_failures = case when updated_at < now() - interval '30 minutes' then 1 else consecutive_failures + 1 end,
           max_concurrency = greatest(1, max_concurrency / 2),
           last_http_status = p_http_status, last_error_class = p_error_class, updated_at = now()
     where provider = 'classifier' returning consecutive_failures into v_cf;
    v_block := least(21600, (case when p_http_status = 402 then 1800 else 60 end) * power(2, least(v_cf, 8) - 1)) * (0.8 + random() * 0.4);
    v_block := least(21600, greatest(v_block, v_floor * (1 + random() * 0.25)));
    update public.photo_pipeline_provider_state set blocked_until = greatest(coalesce(blocked_until, now()), now() + make_interval(secs => v_block)),
           note = case when p_http_status = 402 then 'provider returned 402 (credits exhausted?) - owner action needed' else 'rate limited; requeued, backing off' end
     where provider = 'classifier';
    if v_rl_att >= 12 then
      -- rate-limit budget spent: DEFER (park, still pending, not failed). photo_pipeline_requeue_deferred reopens it.
      update public.photo_pipeline_retry_state set terminal = false, next_attempt_at = null, deferred_at = now() where image_id = p_image_id;
      return jsonb_build_object('status','deferred','transient',true,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',null);
    end if;
    v_terminal := false;
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

-- ------------------------------------------------------------------ recovery (1a): images
-- Reopens parked images, and rows the earlier code left terminal after the rate-limit budget (terminal + a rate-limit
-- cause + still pending), while the classifier provider has NO active cooldown. Bounded, staggered, idempotent.
create or replace function public.photo_pipeline_requeue_deferred(p_limit integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '20s' as $$
declare
  v_cfg jsonb; v_batch int; v_maxdef int; v_stagger int; v_conc int; v_blocked timestamptz; v_n int; v_exhausted int;
begin
  select config_value into v_cfg from public.platform_config where config_key = 'photo_pipeline_deferred_requeue';
  if v_cfg is not null and coalesce((v_cfg ->> 'enabled')::boolean, true) = false then return jsonb_build_object('skipped', 'disabled'); end if;
  select blocked_until, coalesce(max_concurrency, 8) into v_blocked, v_conc from public.photo_pipeline_provider_state where provider = 'classifier';
  if v_blocked > now() then return jsonb_build_object('skipped', 'provider_cooldown', 'blocked_until', v_blocked); end if;
  v_maxdef := coalesce((v_cfg ->> 'max_deferrals')::int, 3);
  v_stagger := greatest(coalesce((v_cfg ->> 'stagger_seconds')::int, 20), 1);
  -- half-open: never reopen more than the provider's current concurrency allowance times a few ticks of headroom
  v_batch := least(greatest(coalesce(p_limit, (v_cfg ->> 'batch')::int, 25), 0), 100, greatest(coalesce(v_conc, 8), 1) * 4);
  with locked as (
    select r.image_id, coalesce(r.deferred_at, r.updated_at) as parked_at
    from public.photo_pipeline_retry_state r
    join public.vehicle_images v on v.id = r.image_id and v.ai_processing_status = 'pending'
    where r.deferrals < v_maxdef
      and (r.deferred_at is not null
           or (r.terminal and (r.last_error_class in ('classifier_rate_limited','provider_cooldown','classifier_usage_budget_exceeded') or r.last_http_status in (429, 402))))
    order by coalesce(r.deferred_at, r.updated_at), r.image_id
    limit v_batch
    for update of r skip locked
  ), pick as (
    select image_id, row_number() over (order by parked_at, image_id) rn from locked
  )
  update public.photo_pipeline_retry_state r set
         terminal = false, deferred_at = null, deferrals = r.deferrals + 1, rate_limited_attempts = 0, attempts = 0,
         next_attempt_at = now() + make_interval(secs => pick.rn * v_stagger), updated_at = now()
    from pick where r.image_id = pick.image_id;
  get diagnostics v_n = row_count;
  select count(*)::int into v_exhausted from public.photo_pipeline_retry_state r
   where r.deferrals >= v_maxdef and (r.deferred_at is not null or r.terminal);
  return jsonb_build_object('requeued', v_n, 'exhausted_deferrals', v_exhausted);
end $$;

-- ------------------------------------------------------------------ recovery (1b): stage work items
create or replace function public.requeue_deferred_image_stage_work(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_blocked boolean; v_n int;
begin
  v_blocked := exists (select 1 from public.photo_pipeline_provider_state p where p.provider = 'classifier' and p.blocked_until > now());
  if v_blocked then return jsonb_build_object('skipped', 'provider_cooldown'); end if;
  with locked as (
    select w.id, w.created_at from public.image_stage_work w
    where w.status = 'deferred' and w.deferred_reason = 'provider_rate_limited'
      and not exists (select 1 from public.image_stage_work o where o.image_id = w.image_id and o.stage = w.stage and o.status in ('queued', 'claimed'))
    order by w.created_at, w.id
    limit least(greatest(p_limit, 0), 100)
    for update skip locked
  ), pick as (
    select id, row_number() over (order by created_at, id) rn from locked
  )
  update public.image_stage_work w set status = 'queued', deferred_reason = null, deferrals = w.deferrals + 1, attempts = 0,
         finished_at = null, lease_until = null, not_before = now() + make_interval(secs => pick.rn * 20)
    from pick where w.id = pick.id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('requeued', v_n);
end $$;

-- ------------------------------------------------------------------ recovery (2): stages that became available
create or replace function public.enqueue_available_stage_retries(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  with cand as (
    select r.image_id, r.stage, s.required_version
    from public.image_stage_receipts r
    join public.image_pipeline_stages s on s.stage = r.stage and s.available is true
    where r.outcome = 'unavailable' and r.producer_version >= s.required_version and r.attempt < s.max_attempts
      and not exists (select 1 from public.image_stage_receipts n where n.image_id = r.image_id and n.stage = r.stage
                       and (n.producer_version, n.attempt) > (r.producer_version, r.attempt))
      and not exists (select 1 from public.image_stage_work w where w.image_id = r.image_id and w.stage = r.stage and w.status in ('queued', 'claimed', 'deferred'))
      and not exists (select 1 from public.image_stage_work w where w.image_id = r.image_id and w.stage = r.stage and w.status = 'dead' and w.target_version >= s.required_version)
    order by r.observed_at, r.id
    limit least(greatest(p_limit, 0), 100)
  ), ins as (
    insert into public.image_stage_work (image_id, stage, target_version, reason, lane)
    select image_id, stage, required_version, 'retryable_outcome', 'backfill' from cand
    on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;
  return jsonb_build_object('enqueued', v_n);
end $$;

-- ------------------------------------------------------------------ one cron entry
create or replace function public.reconcile_image_pipeline(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cfg jsonb; v_out jsonb := '{}'::jsonb;
begin
  v_out := v_out || jsonb_build_object('images_deferred', public.photo_pipeline_requeue_deferred());
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return v_out || jsonb_build_object('stages', 'disabled'); end if;
  v_out := v_out || jsonb_build_object('work_deferred', public.requeue_deferred_image_stage_work(25),
                                       'available_retries', public.enqueue_available_stage_retries(25),
                                       'reconcile', public.reconcile_image_stages(p_limit));
  return v_out;
end $$;

-- ------------------------------------------------------------------ worker tick: also asks the worker to probe
create or replace function public.image_stage_worker_tick(p_stage text default 'classifier', p_limit integer default 4)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cfg jsonb; v_req bigint; v_probe bigint; v_need_probe boolean;
begin
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then
    return jsonb_build_object('skipped', 'disabled');
  end if;
  -- a stage seen unavailable (or marked so by #3024) is probed at most hourly: one OPTIONS per stage
  v_need_probe := exists (select 1 from public.image_pipeline_stages s
                           where s.available is not true and (s.available = false or s.legacy_unavailable_key is not null)
                             and (s.last_probed_at is null or s.last_probed_at < now() - interval '1 hour'));
  if v_need_probe then
    v_probe := net.http_post(
      url := public.get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || public.get_service_role_key_for_cron()),
      body := jsonb_build_object('action', 'probe_stages'),
      timeout_milliseconds := 30000);
  end if;
  if not exists (select 1 from public.image_stage_work where stage = p_stage and status = 'queued' and not_before <= now()) then
    return jsonb_build_object('skipped', 'queue_empty', 'probe', v_probe);
  end if;
  v_req := net.http_post(
    url := public.get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || public.get_service_role_key_for_cron()),
    body := jsonb_build_object('action', 'run_stage', 'stage', p_stage, 'limit', least(greatest(p_limit, 1), 8), 'deadline_ms', 100000),
    timeout_milliseconds := 120000);
  return jsonb_build_object('requested', v_req, 'stage', p_stage, 'probe', v_probe);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.set_image_stage_availability(text, boolean, boolean), public.image_stage_cap_outcome(uuid, text, integer),
  public.photo_pipeline_requeue_deferred(integer), public.requeue_deferred_image_stage_work(integer),
  public.enqueue_available_stage_retries(integer), public.reconcile_image_pipeline(integer) from public, anon, authenticated;
grant execute on function public.set_image_stage_availability(text, boolean, boolean), public.image_stage_cap_outcome(uuid, text, integer),
  public.photo_pipeline_requeue_deferred(integer), public.requeue_deferred_image_stage_work(integer),
  public.enqueue_available_stage_retries(integer), public.reconcile_image_pipeline(integer) to service_role;

-- reschedule the reconciler cron to the wrapper (same job name, same cadence)
select cron.schedule('image-stage-reconciler', '*/5 * * * *',
  $c$set statement_timeout = '30s'; select public.release_expired_image_stage_work(); select public.reconcile_image_pipeline(100)$c$);

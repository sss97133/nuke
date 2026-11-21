-- First read queued at landing: a photo whose owner has a stage reader is queued for that reader in the same
-- transaction that lands the photo, instead of after a provider call, a 15-minute grace period and a 10-minute tick.
--
-- Measured on production, 2026-11-20 (owner's phone, source capture_relay_ios, 59 photos with pixels):
--   * every on-arrival provider read answered HTTP 429 (classifier_rate_limited); the 51 photos of the 17:33-17:40
--     batch were read by the subscription reader 24.7 to 50.8 minutes after landing, median 37.1 (12 at 17:58, 20 at
--     18:10, 19 at 18:23 Pacific); the 8 that landed at 18:14 were still unqueued at 18:34;
--   * the on-arrival call itself started 0.3 to 6.1 s after landing for 25 photos and 31 to 102 s after landing for
--     the other 34 (capture_analysis_events, first step by photo-pipeline-orchestrator). Why those 34 started late
--     is not established: 7 rows in net._http_response at 18:15 read "Timeout of 5000 ms reached" with the whole 5 s
--     spent on DNS, but they were not tied to these photos' requests, and the every-minute drain is the other caller
--     that could have started them;
--   * while the breaker is open the drain claims nothing, so no failure is noted and nothing but the reconciler's
--     grace period brings a reader to the photo;
--   * each reading the subscription reader supplied reset the provider breaker to healthy (consecutive_failures 51 at
--     17:52, 16 at 18:16, 4 at 18:29), after which the drain called the provider that had just refused.
--
-- What changes (all behind image_stage_reconciler.first_read_at_landing; false or absent = behaviour before this file):
--   1. enqueue_first_read(image): one open classifier item for a photo that has a first-read gap, whose user is named
--      in image_stage_reconciler.user_ids, under the reconciler's own eligibility and max_open. Never raises.
--   2. trigger_photo_pipeline_orchestrator (AFTER INSERT on vehicle_images): calls it first. A photo it queued is not
--      also posted to the provider path (one reader per photo). A photo it did not queue (switch off, user has no
--      reader, queue full, not eligible) and a photo the orchestrator settles without any model (the phone scored it 0
--      with labels) take the post exactly as before.
--   3. photo_pipeline_note_failure: a failed provider read queues the first read at once, whoever started it.
--   4. photo_pipeline_clear_retry: a reading a stage reader supplied (classifier model 'reader:...') no longer closes
--      the provider's breaker; a provider reading still does.
--   5. claim_photo_pipeline_batch (the drain): leaves a photo that holds an open classifier item to the stage reader
--      while a reader holds a lease on the item, or the item is younger than
--      image_stage_reconciler.provider_fallback_after_minutes (30); after that the provider path may take it, so a
--      reader that is off does not strand the photo.
-- The reconciler, its grace period and the reader's claim are unchanged: they remain the net under all of this.
--
-- Depends on 20261120184500 being live first, and refuses to apply until it is. A photo queued here waits for its
-- reader without the provider's stand-in answer (image_type 'other'), which is what kept an unread photo out of capture
-- sets; that migration's rule (no image type; pending, processing or failed = in no set) keeps it out now.
-- Other callers of the provider path are unchanged: the web uploader posts a photo itself right after an upload, and
-- the batch drain posts what it claims. The phone and the Mac library sync post nothing; they rely on this trigger.
--
-- Known cost: the orchestrator's cross-sweep duplicate check runs before its model call, so a photo queued here that
-- turns out to be such a duplicate is found only when the reader hands its reading in, one read later. Measured: 0 of
-- the owner's 1,596 photos of the last 45 days were settled that way (vehicle_images.ai_scan_metadata ->> 'skipped').
-- No DDL on vehicle_images, no index, no trigger added, dropped or re-created (the trigger's function body changes).
-- Revert: supabase/sql/revert_20261120183500_first_read_queued_at_landing.sql.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '3s';

-- The replaced bodies are the ones read from production on 2026-11-20; refuse to replace a body someone changed since.
-- A replay finds this migration's own bodies and passes (the second md5 of each pair).
do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.trigger_photo_pipeline_orchestrator()', '7f4ca0dd8c113e4ad3e0b598a309d9dd', 'd1c9f863d032d4165bbcef4ab51cf87e'),
      ('public.photo_pipeline_note_failure(uuid,text,integer,text)', '67c780fd9014369409c30f632cd10756', 'cc355c2f54ef36a0200dbaa812e1f71a'),
      ('public.photo_pipeline_clear_retry(uuid)', '224bf3fc0d48429dea2dbd802903342b', 'ea40463ac96e59b6613a454f34cffb69'),
      ('public.claim_photo_pipeline_batch(integer,integer)', 'fdc2cfcaa4afaa53c94f33b383224e22', '0c3285789eed70d1a52315d719262df6')) as t(fn, md5_before, md5_after) loop
    -- a function that is missing is refused too (a null md5 would otherwise pass "not in")
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') not in (r.md5_before, r.md5_after) then
      raise exception '% is not the body this migration replaces (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
  -- 20261120184500 must be live: both functions it patches carry its marker. Without its rule a photo that waits
  -- here, holding no stand-in answer, could be admitted to a capture set before anyone had read it.
  if (select count(distinct p.proname) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('capture_sets_score', 'capture_landing_plan_step')
         and position('(20261120184500)' in p.prosrc) > 0) <> 2 then
    raise exception '20261120184500 (an unread photo joins no capture set) must be live before this migration';
  end if;
end $guard$;

-- ===== 0. the switch and the hand-back time, on the stage ledger's own config row (an operator's value is kept)
update public.platform_config
   set config_value = jsonb_build_object('first_read_at_landing', true, 'provider_fallback_after_minutes', 30) || config_value
 where config_key = 'image_stage_reconciler' and jsonb_typeof(config_value) = 'object';

-- ===== 1. one open first-read item for one photo, now
create or replace function public.enqueue_first_read(p_image_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cfg jsonb; v_user uuid; v_created timestamptz; v_meta jsonb; v_fast boolean; v_max int; v_open int; v_lane text; v_n int := 0;
begin
  if p_image_id is null then return 0; end if;
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  -- no stage ledger, or the switch is not on: the caller keeps the path it had
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return 0; end if;
  if v_cfg -> 'first_read_at_landing' is distinct from 'true'::jsonb then return 0; end if;
  -- Only a user NAMED as having a reader. The reconciler reads a missing list as "every user"; here that would hold a
  -- photo back from the provider path for a reader nobody runs, so a missing list queues nothing.
  if jsonb_typeof(v_cfg -> 'user_ids') is distinct from 'array' then return 0; end if;

  -- The photo, under the reconciler's own row eligibility. Its "a run is in flight" test is left to the claim, which
  -- keeps the item queued until the run ends: a failed provider read calls this while its own run still holds the photo.
  select v.user_id, v.created_at, v.ai_scan_metadata into v_user, v_created, v_meta
    from public.vehicle_images v
   where v.id = p_image_id
     and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true
     and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal';
  if not found or v_user is null
     or not exists (select 1 from jsonb_array_elements_text(v_cfg -> 'user_ids') x where x::uuid = v_user) then
    return 0;
  end if;
  -- The cap is max_open open FIRST READS. The reconciler gives each reading stage its own room inside max_open so that
  -- a reading backlog cannot stop first reads being queued; counting every stage here would undo that, and a full
  -- reading queue would send each new photo back to the provider path with no sign of it.
  v_max := coalesce((v_cfg ->> 'max_open')::int, 300);
  select count(*) into v_open from public.image_stage_work where stage = 'classifier' and status in ('queued', 'claimed');
  if v_open >= v_max then return 0; end if;
  v_lane := case when v_created >= now() - make_interval(days => coalesce((v_cfg ->> 'live_days')::int, 2)) then 'live' else 'backfill' end;

  -- Nothing has read this photo by the ledger's own rules (image_stage_legacy_version finds no reading in its metadata,
  -- nothing is flagged unavailable) and it has no classifier receipt. By the gap finder's rules that is the 'missing'
  -- first read at the stage's required version, due now. A phone photo lands exactly like this (its metadata is the
  -- column default '{}'; 0 of the 1,193 phone rows of the 30 days to 2026-11-20 held NULL), so the insert that lands a
  -- photo does not pay for the general finder (measured 21 ms a photo on production; this reads the stage row and one
  -- index entry). Anything else, and a classifier stage that carries a contract, is the finder's to judge. The reader's
  -- claim judges the gap again with image_stage_gaps before a read is spent.
  v_fast := public.image_stage_legacy_version('classifier', v_meta) is null
            and not exists (select 1 from public.image_stage_receipts r where r.image_id = p_image_id and r.stage = 'classifier')
            and exists (select 1 from public.image_pipeline_stages s
                         where s.stage = 'classifier' and s.required and s.applies_when = 'always' and s.contract is null
                           and not public.image_stage_legacy_unavailable(v_meta, s.legacy_unavailable_key));
  if v_fast then
    insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
    select p_image_id, s.stage, s.required_version, 'missing', v_lane, now()
      from public.image_pipeline_stages s
     where s.stage = 'classifier' and s.required and s.applies_when = 'always'
    on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing;
  else
    insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
    select g.image_id, g.stage, g.target_version, g.reason, v_lane, g.not_before
      from public.image_stage_gaps(array[p_image_id]) g
     where g.stage = 'classifier'
    on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
exception when others then
  raise warning 'enqueue_first_read failed for %: %', p_image_id, sqlerrm;
  return 0;
end $function$;
comment on function public.enqueue_first_read(uuid) is
  'Queues the first read (stage classifier) of one photo for its owner''s stage reader now: one open item, only when image_stage_reconciler is enabled with first_read_at_landing true, the photo''s user is named in user_ids, the photo has a first-read gap, is eligible as the reconciler judges it and the queue is under max_open. Returns the number of items created (0 or 1). Never raises: it runs inside the insert that lands a photo.';

-- ===== 2. the insert trigger's function: queue first, post only what the queue did not take
create or replace function public.trigger_photo_pipeline_orchestrator()
 returns trigger
 language plpgsql
 security definer
as $function$
BEGIN
  IF NEW.ai_processing_status = 'pending' AND NEW.image_url IS NOT NULL THEN
    -- First read at landing (20261120183500). A photo whose user has a stage reader is queued for that reader here, in
    -- the transaction that lands the photo, and is not also posted to the provider path: one reader per photo, and no
    -- wait on an outgoing call that on 2026-11-20 started 31 to 102 s late for 34 of 59 photos. Still posted: a photo
    -- the orchestrator settles without any model (the phone scored it 0 and labelled it), and every photo the queue
    -- did not take (switch off, no reader named for this user, queue full, not eligible).
    IF NOT (NEW.vehicle_score IS NOT NULL AND NEW.vehicle_score = 0 AND coalesce(array_length(NEW.apple_ml_labels, 1), 0) > 0)
       AND public.enqueue_first_read(NEW.id) > 0 THEN
      RETURN NEW;
    END IF;
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

-- ===== 3. a failed provider read queues the first read at once
create or replace function public.photo_pipeline_note_failure(p_image_id uuid, p_error_class text, p_http_status integer default null, p_fallback_error_class text default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
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
  -- First read at landing (20261120183500): the provider did not read this photo, so its owner's stage reader is asked
  -- now instead of after the reconciler's grace period. The reader's claim leaves the item queued while this run still
  -- holds the photo. Nothing is queued when the switch is off, the user has no reader, or an item is already open.
  perform public.enqueue_first_read(p_image_id);
  if v_terminal then
    update public.photo_pipeline_retry_state set terminal = true, next_attempt_at = null where image_id = p_image_id;
    return jsonb_build_object('status','failed','transient',v_transient,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',null);
  end if;
  v_next := now() + make_interval(secs => v_delay);
  update public.photo_pipeline_retry_state set next_attempt_at = v_next, terminal = false where image_id = p_image_id;
  return jsonb_build_object('status','pending','transient',true,'attempts',v_att,'rate_limited_attempts',v_rl_att,'next_attempt_at',v_next);
end $function$;

-- ===== 4. only a provider reading closes the provider's breaker
create or replace function public.photo_pipeline_clear_retry(p_image_id uuid)
returns void language plpgsql security definer set search_path = public as $function$
begin
  delete from public.photo_pipeline_retry_state where image_id = p_image_id;
  -- A reading a stage reader supplied says nothing about the provider (20261120183500: each one reset the breaker to
  -- healthy and the drain called the provider again). The orchestrator labels such a reading 'reader:<name>' in the
  -- receipt it writes to the photo before it calls this.
  if exists (select 1 from public.vehicle_images v
              where v.id = p_image_id
                and coalesce(v.ai_scan_metadata #>> '{photo_pipeline,receipt,classifier_model}',
                             v.ai_scan_metadata #>> '{classification,classifier_receipt,model}', '') like 'reader:%') then
    return;
  end if;
  update public.photo_pipeline_provider_state set consecutive_failures = 0, blocked_until = null, note = 'healthy', updated_at = now()
   where provider = 'classifier' and (consecutive_failures > 0 or blocked_until is not null);
end $function$;

-- ===== 5. the drain leaves a queued photo to its stage reader while the item is leased or fresh
create or replace function public.claim_photo_pipeline_batch(p_limit integer default 8, p_lease_seconds integer default 300)
returns table(id uuid, image_url text, vehicle_id uuid, user_id uuid)
language plpgsql security definer set search_path = public as $function$
declare v_cfg jsonb; v_cut timestamptz := '-infinity'; v_wait int;
begin
  -- circuit breaker: while the provider is cooling down nobody claims (no hammering, no attempts burnt)
  if exists (select 1 from public.photo_pipeline_provider_state s where s.provider = 'classifier' and s.blocked_until > now()) then return; end if;
  select config_value into v_cfg from public.platform_config where config_key = 'photo_pipeline_backlog';
  if v_cfg is not null and coalesce((v_cfg->>'enabled')::boolean, true) = false then
    v_cut := now() - make_interval(days => coalesce((v_cfg->>'recent_days')::int, 14));
  end if;
  -- How long an open first-read item keeps this path off its photo (20261120183500): a JSON number of minutes from 0
  -- up on the stage ledger's config row; anything else (absent, negative, text) is read as 30.
  select case when jsonb_typeof(c.config_value -> 'provider_fallback_after_minutes') = 'number'
                   and (c.config_value ->> 'provider_fallback_after_minutes')::numeric between 0 and 100000
              then floor((c.config_value ->> 'provider_fallback_after_minutes')::numeric)::int end
    into v_wait from public.platform_config c where c.config_key = 'image_stage_reconciler';
  v_wait := coalesce(v_wait, 30);
  return query
  with cand as (
    select v.id from public.vehicle_images v
    where v.ai_processing_status = 'pending' and v.user_id is not null and v.is_duplicate = false and v.image_url is not null
      and v.created_at >= v_cut
      and not exists (select 1 from public.photo_pipeline_retry_state r
                       where r.image_id = v.id and (r.terminal or r.next_attempt_at is null or r.next_attempt_at > now()))
      -- one reader per photo: a photo queued for its owner's stage reader is that reader's while the reader holds a
      -- lease on the item, or the item is younger than the hand-back time
      and not exists (select 1 from public.image_stage_work w
                       where w.image_id = v.id and w.stage = 'classifier'
                         and ((w.status = 'claimed' and w.lease_until > now())
                              or (w.status in ('queued', 'claimed') and w.created_at > now() - make_interval(mins => v_wait))))
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

-- ===== grants: the new function is the service role's; the replaced ones keep theirs (create or replace keeps an ACL)
revoke all on function public.enqueue_first_read(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_first_read(uuid) to service_role;

commit;

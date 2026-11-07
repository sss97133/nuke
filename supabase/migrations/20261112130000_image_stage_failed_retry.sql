-- Retryable post-classifier failures (follow-up to #3032).
--
-- 'filing' and 'evidence' receipts are written 'failed' when a step AFTER a successful classification throws. Until now
-- a failed receipt was terminal: not a gap, so nothing re-ran the step. Now, for stages flagged retries_failed:
--   * a failed receipt carries retry_after, an exponential backoff from the stage attempt (5 min * 2^(attempt-1), max 24 h);
--   * image_stage_gaps lists the image again once retry_after has passed and attempt < max_attempts;
--   * the stage runner re-runs only the post-classifier steps from the saved classification, never the paid classifier.
-- Stages with retries_failed = false keep the old rule (failed is terminal, retry_after stays NULL).
-- Receipts written before this migration have no retry_after: they are due 5 minutes after observed_at (no row is rewritten).
-- Filing/evidence are not 'required': a stage that never ran has no gap; only a failed receipt opens one.

set local statement_timeout = '60s';
set local lock_timeout = '10s';

alter table public.image_pipeline_stages add column if not exists retries_failed boolean not null default false;
comment on column public.image_pipeline_stages.retries_failed is 'true: a failed receipt on this stage is retried with exponential backoff until max_attempts. The runner must not call a paid provider.';
update public.image_pipeline_stages set retries_failed = true where stage in ('filing', 'evidence');

alter table public.image_stage_receipts drop constraint if exists stage_receipt_retry_only_retryable;
alter table public.image_stage_receipts add constraint stage_receipt_retry_only_retryable
  check (retry_after is null or outcome in ('unavailable', 'rate_limited', 'failed'));

-- ------------------------------------------------------------------ receipt writer: backoff for failed receipts
create or replace function public.record_image_stage_receipt(
  p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text,
  p_error_class text default null, p_http_status integer default null, p_retry_after_seconds integer default null,
  p_input_fingerprint text default null, p_detail jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_producer text; v_max int; v_retries_failed boolean; v_attempt int; v_id bigint; v_capped boolean; v_retry timestamptz;
begin
  select producer, max_attempts, retries_failed into v_producer, v_max, v_retries_failed from public.image_pipeline_stages where stage = p_stage;
  if v_producer is null then raise exception 'unknown stage %', p_stage; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_image_id::text || ':' || p_stage || ':' || p_producer_version, 0));
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.image_stage_receipts
   where image_id = p_image_id and stage = p_stage and producer_version = p_producer_version;
  v_retry := case
    when p_outcome in ('unavailable', 'rate_limited') then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 300), 0), 86400))
    -- failed + retryable stage: the server picks the backoff (a caller cannot shorten it): 300 s, 600 s, 1200 s ... capped at 24 h
    when p_outcome = 'failed' and v_retries_failed then now() + make_interval(secs => least(300 * power(2, least(v_attempt - 1, 10)), 86400))
  end;
  insert into public.image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, retry_after, error_class, http_status, input_fingerprint, detail)
  values (p_image_id, p_stage, v_producer, p_producer_version, p_outcome, v_attempt, v_retry,
          p_error_class, p_http_status, p_input_fingerprint, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;

  if p_outcome = 'succeeded' then perform public.set_image_stage_availability(p_stage, true, false);
  elsif p_outcome = 'unavailable' then perform public.set_image_stage_availability(p_stage, false, false);
  end if;

  v_capped := p_outcome = 'rate_limited' and v_attempt >= v_max;
  update public.image_stage_work w set
         status = case when v_capped then public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) else 'done' end,
         dead_reason = case when v_capped and public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'dead' then 'max_attempts_exceeded' end,
         deferred_reason = case when v_capped and public.image_stage_cap_outcome(w.image_id, w.stage, w.deferrals) = 'deferred' then 'provider_rate_limited' end,
         finished_at = now(), lease_until = null
   where w.image_id = p_image_id and w.stage = p_stage and w.status in ('queued', 'claimed', 'deferred');
  if v_capped and not found and not exists (select 1 from public.image_stage_work w where w.image_id = p_image_id and w.stage = p_stage and w.status in ('deferred', 'dead')) then
    insert into public.image_stage_work (image_id, stage, target_version, reason, lane, status, deferred_reason, finished_at)
    values (p_image_id, p_stage, p_producer_version, 'retryable_outcome', 'backfill', 'deferred', 'provider_rate_limited', now());
  end if;
  return v_id;
end $$;
revoke all on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb) to service_role;

-- ------------------------------------------------------------------ gap finder: failed receipts of retries_failed stages
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
  join public.image_pipeline_stages s on s.required or s.retries_failed
  left join public.image_stage_current c on c.image_id = v.id and c.stage = s.stage
  where v.id = any (p_image_ids)
    and not exists (select 1 from public.image_stage_work d where d.image_id = v.id and d.stage = s.stage and d.status = 'dead' and d.target_version >= s.required_version)
    and not exists (select 1 from public.image_stage_work d where d.image_id = v.id and d.stage = s.stage and d.status = 'deferred')
    and (s.applies_when = 'always'
         or (s.applies_when = 'document_like' and coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') in ('receipt', 'document', 'invoice', 'text_document')))
    and (
      (s.required and c.image_id is null and (not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data)
                               or public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key)))
      or (s.required and c.producer_version < s.required_version and not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data))
      or (s.required and c.producer_version >= s.required_version and c.outcome in ('unavailable', 'rate_limited')
          and c.retry_after <= now()
          and c.attempt < s.max_attempts)
      -- a failed post-classifier step: due at its backoff time (receipts older than this migration have none: 5 min after observed_at)
      or (s.retries_failed and c.producer_version >= s.required_version and c.outcome = 'failed'
          and coalesce(c.retry_after, c.observed_at + interval '5 minutes') <= now()
          and c.attempt < s.max_attempts)
    )
$$;

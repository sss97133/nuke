-- Follow-up to #3032: the hourly janitor must not re-pay for a classification that already succeeded.
--
-- reset_stuck_photo_pipeline_images() flips vehicle_images failed -> pending, and claim_photo_pipeline_batch then runs the
-- full paid classifier again. Since #3032 an image can sit in 'failed' only because the filing/evidence stage failed AFTER a
-- saved classification; those stages retry on their own (image_stage_gaps / image_stage_work, from the saved classification,
-- never the paid provider). So the failed -> pending branch now skips an image whose classifier stage already succeeded:
--   * a succeeded 'classifier' receipt in image_stage_receipts, or
--   * legacy evidence of a saved classification (image_stage_legacy_evidence, the same test the reconciler uses).
-- Everything else is the definition from 20261109000500_photo_pipeline_backoff.sql, verbatim.
set local statement_timeout = '60s';
set local lock_timeout = '10s';

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

  -- 'failed' -> 'pending' only when: provider healthy, the retry state is not terminal and its backoff window has elapsed,
  -- and the classifier has not already succeeded (those are left to the filing/evidence stage runners)
  if not v_blocked then
    with retryable as (
      select v.id from vehicle_images v
      where v.ai_processing_status = 'failed' and v.updated_at < now() - interval '10 minutes' and v.updated_at > now() - interval '7 days'
        and v.ai_retry_count < 3 and v.is_duplicate is not true and v.image_url is not null
        and not exists (select 1 from photo_pipeline_retry_state r where r.image_id = v.id and (r.terminal or r.next_attempt_at > now()))
        and not exists (select 1 from image_stage_receipts sr where sr.image_id = v.id and sr.stage = 'classifier' and sr.outcome = 'succeeded')
        and not public.image_stage_legacy_evidence('classifier', v.ai_scan_metadata, v.exif_data)
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

-- Revert of 20261113110000_image_stage_receipts_reconciler.sql. Refuses while receipts exist: a receipt is a record of
-- work done and is not dropped by a revert. Disable instead (platform_config image_stage_reconciler.enabled = false).
-- One transaction: when the guard raises, nothing below it runs.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
do $$
declare j bigint;
begin
  if to_regclass('public.image_stage_receipts') is not null and exists (select 1 from public.image_stage_receipts) then
    raise exception 'image_stage_receipts holds rows; disable the reconciler instead of reverting';
  end if;
  if to_regnamespace('cron') is not null then
    for j in select jobid from cron.job where jobname = 'image-stage-reconciler' loop perform cron.unschedule(j); end loop;
  end if;
end $$;
drop function if exists public.image_stage_coverage();
drop function if exists public.release_expired_image_stage_work();
drop function if exists public.claim_image_stage_work(text, integer, integer, uuid);
drop function if exists public.reconcile_image_stages(integer);
drop function if exists public.image_stage_gaps(uuid[]);
drop function if exists public.image_stage_legacy_unavailable(jsonb, text);
drop function if exists public.image_stage_legacy_evidence(text, jsonb, jsonb, text);
drop function if exists public.image_stage_legacy_version(text, jsonb);
drop function if exists public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb);
drop view if exists public.image_stage_current;
drop table if exists public.image_stage_reconciler_state;
drop table if exists public.image_stage_work;
drop table if exists public.image_stage_receipts;
drop table if exists public.image_pipeline_stages;
delete from public.platform_config where config_key = 'image_stage_reconciler';
commit;

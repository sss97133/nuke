-- Widen the deep_reading / keyed_values scope from the 1966 Mustang canary
-- (67127bcb) to every filed photo of the same owner, with the existing queue
-- room and daily cap as the rate limit. Does not enqueue work and does not
-- run any reader.
--
-- Why. platform_config image_stage_deep_reading is on, but vehicle_ids lists
-- only 67127bcb-1f2b-4472-ae4f-a2b86825027b, so image_stage_scope_ok answers
-- false for every other car (measured 2026-11-23). image_stage_scope_ok already
-- treats a missing vehicle_ids key as "every vehicle of the listed owners,
-- minus exclude_vehicle_ids" (20261120130000). This migration drops
-- vehicle_ids and raises max_open from 1 to 5 so the existing stage room can
-- hold a small batch. The deep_reading backfill_daily_cap stays 150
-- (image_pipeline_stages). The subscription reader is unchanged; it already
-- claims from the stage ledger with --deep-limit / --keyed-limit.
--
-- What this does not do. It does not call enqueue_image_stage_work, does not
-- land photos, does not touch photo_land_classification or the a08 trigger,
-- does not re-arm #3700, does not change automatic.admits, does not write
-- GPS, and does not assert ownership. Privacy holds (empty image_url),
-- sensitive, rejected_personal, documents, unfiled rows, 9cf5b7a4, and the
-- two excluded vehicles stay out through the existing eligibility and
-- exclude_vehicle_ids rules. The change is not applied by this pull request;
-- it stays draft until it is shown and approved.
--
-- Revert: 20261123220001_deep_reading_scope_owner_filed_revert.sql
-- Contract: supabase/sql/test_deep_reading_scope_owner_filed.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $do$
declare
  v_old jsonb;
  v_from constant jsonb := '{"enabled": true, "max_open": 1,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "vehicle_ids": ["67127bcb-1f2b-4472-ae4f-a2b86825027b"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
  v_to constant jsonb := '{"enabled": true, "max_open": 5,
    "user_ids": ["0b9f107a-d124-49de-9ded-94698f63c1c4"],
    "exclude_vehicle_ids": ["7b0e02b9-42af-4998-b27d-69e3459b452b", "1e9fdf16-b453-44a9-8b74-46bbe886625a"]}';
begin
  if to_regprocedure('public.image_stage_scope_ok(jsonb,uuid,uuid)') is null then
    raise exception 'image_stage_scope_ok(jsonb,uuid,uuid) is not live (20261120130000 must be applied first)';
  end if;
  select config_value into v_old from public.platform_config
    where config_key = 'image_stage_deep_reading' for update;
  if not found then
    raise exception 'platform_config image_stage_deep_reading is missing (20261120130000 must be applied first)';
  end if;
  if v_old = v_to then
    raise notice 'deep-reading scope already covers the owner''s filed photos; left as it is: %', v_old;
  elsif v_old is distinct from v_from then
    raise exception 'platform_config image_stage_deep_reading is not the first-car row this migration was written against; refusing to replace it: %', v_old;
  else
    update public.platform_config
       set config_value = v_to, updated_at = now()
     where config_key = 'image_stage_deep_reading';
    raise notice 'deep-reading scope now covers the owner''s filed photos; max_open=5; daily cap unchanged';
  end if;
end $do$;

commit;

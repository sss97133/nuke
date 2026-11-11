-- Switch the stage reconciler on for the account whose Mac runs the subscription reader: first pass.
--
-- Owner, 2026-11-10: "I want all the photos on my phone analyzed and put in the right places", and on switching the
-- queue on: "My call ... ok I'm calling".
--
-- First pass = photos that hold no reading at all. The classifier stage's contract is set to NULL, so any finished
-- reading on the row stands in for a receipt (image_stage_legacy_evidence) and the reconciler queues only photos with
-- no classification, or with a failed stand-in. A first landing writes into empty keys, so it cannot leave a mix of
-- old and new rows in the normalized tables.
-- Second pass (not this file): contract 'v98', which also queues photos whose only reading predates the current
-- classifier (6,737 of the 26,941 owner images in the 2026-11-03 yield snapshot). It waits for the landing fold to
-- supersede what an earlier reading landed; today the fold is first-write-wins.
--
-- What happens on deploy: within 10 minutes cron image-stage-reconciler queues up to 300 of this user's eligible
-- photos (http URL; not duplicate, sensitive, external, superseded or rejected as personal), oldest first plus the
-- newest uploads. The subscription frame reader on the owner's Mac sees the switch on its next fire, claims 20 at a
-- time and writes one typed receipt per photo. Nothing here calls a provider or reads an image.
-- Two things are tightened before the switch, both from review of 20261113110000 after it merged:
--  * claim_image_stage_work leaves an item queued while a pipeline run is in flight on its photo (status 'processing',
--    started under 30 minutes ago), as the reconciler already does. Without it the paid drain and the subscription
--    reader could read the same photo at once. Only that predicate is added; the function is otherwise unchanged
--    (guarded by the md5 of the body it replaces).
--  * scan_per_lane goes from 1000 to 200. The reader takes 20 photos per fire, so a run needs to find about 20 new
--    gaps; reading 2,000 rows of ai_scan_metadata every 10 minutes for that is waste on a database that hung under
--    its own scheduled work on 2026-11-08 and again on 2026-11-10.
-- Watch: select public.image_stage_coverage(); the alarm is assay_photo_reading_flow (20261113120000).
-- Revert: supabase/sql/revert_20261113130000_image_stage_reconciler_first_pass.sql (switches it off; receipts stay).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $$
begin
  if to_regprocedure('public.reconcile_image_stages(integer)') is null or to_regclass('public.image_stage_work') is null then
    raise exception 'the stage ledger (20261113110000) is not deployed';
  end if;
  if not exists (select 1 from public.platform_config where config_key = 'image_stage_reconciler') then
    raise exception 'platform_config has no image_stage_reconciler row';
  end if;
  if not exists (select 1 from public.image_pipeline_stages where stage = 'classifier' and required) then
    raise exception 'the classifier stage is not registered as required';
  end if;
end $$;

do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.claim_image_stage_work(text,integer,integer,uuid)'::regprocedure)
       not in ('bddcc4c3061ef09e3f6a5fa7661aa12c', md5($new$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  update public.image_stage_work d set status = 'dropped', finished_at = now(), lease_until = null
   where d.id in (
     select w.id from public.image_stage_work w
     left join public.vehicle_images v on v.id = w.image_id
     where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
       and (p_user_id is null or v.user_id = p_user_id or v.id is null)
       and not coalesce(v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal', false)
     order by w.id limit 200 for update of w skip locked);
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    join public.vehicle_images v on v.id = w.image_id
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
      and (p_user_id is null or v.user_id = p_user_id)
      and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
      -- a pipeline run is in flight on the photo (the reconciler's own rule): leave the item queued until it ends or goes stale
      and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes')
    ), pick as (
      -- interleave: live #1, backfill #1, live #2, ... ; a lane with nothing due simply yields to the other
      select d.id from due d order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
    ), locked as (
      select w.id, w.image_id from public.image_stage_work w where w.id in (select id from pick) and w.status = 'queued' for update skip locked
    ), still as (
      -- another path may have read the photo while the item waited (the paid drain, a hand run, a receipt that was
      -- written after its lease ran out): judge the gap again on the few picked rows, so a read is never spent twice
      select g.image_id from public.image_stage_gaps(array(select l.image_id from locked l)) g where g.stage = p_stage
    ), upd as (
      update public.image_stage_work w
         set status = case when l.image_id in (select s.image_id from still s) then 'claimed' else 'dropped' end,
             lease_until = case when l.image_id in (select s.image_id from still s) then now() + make_interval(secs => greatest(p_lease_seconds, 30)) end,
             finished_at = case when l.image_id in (select s.image_id from still s) then null else now() end
      from locked l where w.id = l.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id
  where u.status = 'claimed';
end $new$)) then
    raise exception 'claim_image_stage_work is not the body 20261113110000 defined; review before replacing it';
  end if;
end $guard$;

create or replace function public.claim_image_stage_work(p_stage text, p_limit integer default 8, p_lease_seconds integer default 300, p_user_id uuid default null)
returns table(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  update public.image_stage_work d set status = 'dropped', finished_at = now(), lease_until = null
   where d.id in (
     select w.id from public.image_stage_work w
     left join public.vehicle_images v on v.id = w.image_id
     where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
       and (p_user_id is null or v.user_id = p_user_id or v.id is null)
       and not coalesce(v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal', false)
     order by w.id limit 200 for update of w skip locked);
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    join public.vehicle_images v on v.id = w.image_id
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
      and (p_user_id is null or v.user_id = p_user_id)
      and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
      -- a pipeline run is in flight on the photo (the reconciler's own rule): leave the item queued until it ends or goes stale
      and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes')
    ), pick as (
      -- interleave: live #1, backfill #1, live #2, ... ; a lane with nothing due simply yields to the other
      select d.id from due d order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
    ), locked as (
      select w.id, w.image_id from public.image_stage_work w where w.id in (select id from pick) and w.status = 'queued' for update skip locked
    ), still as (
      -- another path may have read the photo while the item waited (the paid drain, a hand run, a receipt that was
      -- written after its lease ran out): judge the gap again on the few picked rows, so a read is never spent twice
      select g.image_id from public.image_stage_gaps(array(select l.image_id from locked l)) g where g.stage = p_stage
    ), upd as (
      update public.image_stage_work w
         set status = case when l.image_id in (select s.image_id from still s) then 'claimed' else 'dropped' end,
             lease_until = case when l.image_id in (select s.image_id from still s) then now() + make_interval(secs => greatest(p_lease_seconds, 30)) end,
             finished_at = case when l.image_id in (select s.image_id from still s) then null else now() end
      from locked l where w.id = l.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id
  where u.status = 'claimed';
end $$;
comment on function public.claim_image_stage_work(text, integer, integer, uuid) is
  'Leases due work for a stage worker, optionally for one user. Hands out only photos that are still eligible, still a gap, and have no pipeline run in flight; drops items whose photo stopped being eligible or whose gap closed. Service role only. Migrations 20261113110000, 20261113130000.';

update public.image_pipeline_stages set contract = null where stage = 'classifier';

update public.platform_config
   set config_value = config_value || jsonb_build_object('enabled', true, 'scan_per_lane', 200, 'user_ids', jsonb_build_array('0b9f107a-d124-49de-9ded-94698f63c1c4'))
 where config_key = 'image_stage_reconciler';

commit;

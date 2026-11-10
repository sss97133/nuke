-- Stage reconciler: refill the queue in batches, and stop the backfill cursor where the queueing stopped.
--
-- Read from production 2026-11-10 19:08 UTC, the first two runs after the switch (20261113130000): 8.97 s and 13.21 s
-- each (cron.job_run_details), and each scanned 200 candidates and queued 100.
--
-- 1. Batches. Once the queue is near its cap a tick only has room for the 20 photos the reader just took, but it still
--    scans 200 candidates and reads their ai_scan_metadata to find them, every 10 minutes, on a database that hung
--    under its own scheduled work on 2026-11-08 and 2026-11-10. New setting image_stage_reconciler.refill_below: while
--    at least that many items are open, a tick returns {"skipped":"queue_ok"} without scanning. Set to 100 here, so
--    the queue runs between about 100 and 200 open and the scan happens once per 100 photos read instead of every
--    tick. Absent, the function refills whenever there is room, as before.
-- 2. Cursor. The backfill cursor moved past everything scanned, including gaps the budget had no room to queue; those
--    photos then waited for the cursor to finish a whole pass. It now stops at the last photo queued whenever more
--    gaps were found than queued. The cursor is reset here so the photos passed over on 2026-11-10 come first.
-- 3. A skipped tick (queue_ok or queue_full) stamps last_run_at, so the watch in assay_photo_reading_flow does not read
--    a full or healthy queue as a stopped reconciler.
-- The replaced body is checked by md5.
-- Revert: supabase/sql/revert_20261113140000_image_stage_reconciler_refill.sql.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

do $guard$
begin
  if to_regprocedure('public.reconcile_image_stages(integer)') is null then
    raise exception 'the stage ledger (20261113110000) is not deployed';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.reconcile_image_stages(integer)'::regprocedure)
       not in ('034f5feb71467b31feda531da34a7b47', md5($new$
declare
  v_cfg jsonb; v_open int; v_budget int; v_live_budget int; v_back_budget int; v_users uuid[];
  v_lane text; v_lane_budget int; v_scan int; v_cand uuid[]; v_ids uuid[]; v_last record; v_enq int;
  v_gaps int; v_taken_id uuid; v_taken_at timestamptz;
  v_out jsonb := '{}'::jsonb; v_carry int := 0; v_total int := 0;
begin
  -- one reconciler at a time; a second caller is a no-op rather than a queue of waiters
  if not pg_try_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0)) then return jsonb_build_object('skipped', 'already_running'); end if;
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return jsonb_build_object('skipped', 'disabled'); end if;
  -- users who have a reader; absent or not an array = every user
  if jsonb_typeof(v_cfg -> 'user_ids') = 'array' then
    select coalesce(array_agg(x::uuid), '{}') into v_users from jsonb_array_elements_text(v_cfg -> 'user_ids') x;
  end if;

  select count(*) into v_open from public.image_stage_work where status in ('queued', 'claimed');
  -- Refill in batches, not on every tick: while at least refill_below items are open there is nothing to do, and the
  -- scan (which reads each candidate's ai_scan_metadata) is skipped. Absent = max_open: refill whenever there is room.
  if greatest(p_limit, 0) > 0
     and v_open >= least(coalesce((v_cfg ->> 'refill_below')::int, 2147483647), coalesce((v_cfg ->> 'max_open')::int, 300)) then
    -- a tick that had nothing to do still ran: the watch on last_run_at must not read it as a stopped reconciler
    update public.image_stage_reconciler_state set last_run_at = now();
    return jsonb_build_object('skipped', case when v_open >= coalesce((v_cfg ->> 'max_open')::int, 300) then 'queue_full' else 'queue_ok' end, 'open', v_open);
  end if;
  v_budget := least(greatest(p_limit, 0), greatest(coalesce((v_cfg ->> 'max_open')::int, 300) - v_open, 0), 500);
  if v_budget = 0 then return jsonb_build_object('skipped', 'queue_full', 'open', v_open); end if;
  -- fair split: new uploads always get their share; whatever live does not use rolls to the backfill
  v_back_budget := floor(v_budget * least(greatest(coalesce((v_cfg ->> 'backfill_share')::numeric, 0.5), 0), 1));
  v_live_budget := v_budget - v_back_budget;
  v_scan := least(greatest(coalesce((v_cfg ->> 'scan_per_lane')::int, 1000), 1), 5000);

  foreach v_lane in array array['live', 'backfill'] loop
    v_lane_budget := case v_lane when 'live' then v_live_budget else v_back_budget + v_carry end;
    -- Two steps, read from production's plan on 2026-11-10: (1) candidate ids by (created_at, id) from the partial index
    -- idx_vehicle_images_capture_ledger (user_id IS NOT NULL, INCLUDE id, created_at: an index-only scan of ~32k entries),
    -- (2) eligibility judged on at most v_scan rows by primary key. The cursor advances over candidates, not over the
    -- eligible subset, so ineligible rows are never rescanned.
    if v_lane = 'live' then
      -- newest uploads past the grace period, inside the live window
      select coalesce(array_agg(x.id), '{}') into v_cand from (
        select c.id from public.vehicle_images c
        where c.user_id is not null and (v_users is null or c.user_id = any (v_users))
          and c.created_at >= now() - make_interval(days => coalesce((v_cfg ->> 'live_days')::int, 2))
          and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
        order by c.created_at desc, c.id desc limit v_scan) x;
    else
      -- everything past the grace period, oldest first, by cursor; overlaps the live window on purpose so a bulk upload
      -- larger than the live scan is still reached within one pass (the one-open-item index prevents double queuing)
      select coalesce(array_agg(x.id), '{}') into v_cand from (
        select c.id from public.vehicle_images c, public.image_stage_reconciler_state st
        where st.lane = 'backfill'
          and c.user_id is not null and (v_users is null or c.user_id = any (v_users))
          and (st.cursor_created_at is null or (c.created_at, c.id) > (st.cursor_created_at, st.cursor_id))
          and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
        order by c.created_at asc, c.id asc limit v_scan) x;
    end if;
    select coalesce(array_agg(v.id), '{}') into v_ids
      from public.vehicle_images v
     where v.id = any (v_cand)
       and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
       and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes');

    -- every gap among the scanned rows, in the lane's order; the first v_lane_budget are queued
    with gaps as materialized (
      select g.image_id, g.stage, g.target_version, g.reason, g.not_before, v.created_at,
             row_number() over (order by case when v_lane = 'live' then extract(epoch from v.created_at) else -extract(epoch from v.created_at) end desc, v.id, g.stage) as rn
        from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
       where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
    ), ins as (
      insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
      select image_id, stage, target_version, reason, v_lane, not_before from gaps where rn <= v_lane_budget
      on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
      returning 1
    ) select (select count(*) from ins), (select count(*) from gaps),
             (select g2.image_id from gaps g2 where g2.rn <= v_lane_budget order by g2.rn desc limit 1),
             (select g2.created_at from gaps g2 where g2.rn <= v_lane_budget order by g2.rn desc limit 1)
        into v_enq, v_gaps, v_taken_id, v_taken_at;

    -- Advance the backfill cursor, wrap at the end. When every gap found was queued, the cursor passes everything
    -- scanned (so pages of ineligible or already-read rows are never rescanned). When more gaps were found than the
    -- budget could queue, it stops at the last photo queued, so the rest are the first thing the next scan sees
    -- instead of waiting for a whole pass (on 2026-11-10 two runs scanned 200 and queued 100 each).
    if v_lane = 'backfill' then
      if coalesce(array_length(v_cand, 1), 0) = 0 then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = 0, last_enqueued = v_enq where lane = 'backfill';
      elsif v_gaps > greatest(v_lane_budget, 0) then
        if v_taken_id is not null then
          -- the last photo queued by this run, in backfill order (oldest first). With one required stage a photo is
          -- one gap; with several, a photo's later stage can be left for the next pass.
          update public.image_stage_reconciler_state set cursor_created_at = v_taken_at, cursor_id = v_taken_id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        else
          -- no budget this tick: the cursor stays where it is
          update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        end if;
      else
        select v.created_at, v.id into v_last from public.vehicle_images v where v.id = any (v_cand) order by v.created_at desc, v.id desc limit 1;
        update public.image_stage_reconciler_state set cursor_created_at = v_last.created_at, cursor_id = v_last.id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
      end if;
    else
      update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = coalesce(array_length(v_cand, 1), 0), last_enqueued = v_enq where lane = 'live';
      v_carry := greatest(v_lane_budget - v_enq, 0);
    end if;
    v_out := v_out || jsonb_build_object(v_lane, jsonb_build_object('scanned', coalesce(array_length(v_cand, 1), 0), 'eligible', coalesce(array_length(v_ids, 1), 0), 'enqueued', v_enq, 'budget', v_lane_budget));
    v_total := v_total + v_enq;
  end loop;
  return v_out || jsonb_build_object('enqueued', v_total, 'open_before', v_open, 'users', coalesce(to_jsonb(v_users), 'null'::jsonb));
end $new$)) then
    raise exception 'reconcile_image_stages is not the body 20261113110000 defined; review before replacing it';
  end if;
end $guard$;

create or replace function public.reconcile_image_stages(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg jsonb; v_open int; v_budget int; v_live_budget int; v_back_budget int; v_users uuid[];
  v_lane text; v_lane_budget int; v_scan int; v_cand uuid[]; v_ids uuid[]; v_last record; v_enq int;
  v_gaps int; v_taken_id uuid; v_taken_at timestamptz;
  v_out jsonb := '{}'::jsonb; v_carry int := 0; v_total int := 0;
begin
  -- one reconciler at a time; a second caller is a no-op rather than a queue of waiters
  if not pg_try_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0)) then return jsonb_build_object('skipped', 'already_running'); end if;
  select config_value into v_cfg from public.platform_config where config_key = 'image_stage_reconciler';
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return jsonb_build_object('skipped', 'disabled'); end if;
  -- users who have a reader; absent or not an array = every user
  if jsonb_typeof(v_cfg -> 'user_ids') = 'array' then
    select coalesce(array_agg(x::uuid), '{}') into v_users from jsonb_array_elements_text(v_cfg -> 'user_ids') x;
  end if;

  select count(*) into v_open from public.image_stage_work where status in ('queued', 'claimed');
  -- Refill in batches, not on every tick: while at least refill_below items are open there is nothing to do, and the
  -- scan (which reads each candidate's ai_scan_metadata) is skipped. Absent = max_open: refill whenever there is room.
  if greatest(p_limit, 0) > 0
     and v_open >= least(coalesce((v_cfg ->> 'refill_below')::int, 2147483647), coalesce((v_cfg ->> 'max_open')::int, 300)) then
    -- a tick that had nothing to do still ran: the watch on last_run_at must not read it as a stopped reconciler
    update public.image_stage_reconciler_state set last_run_at = now();
    return jsonb_build_object('skipped', case when v_open >= coalesce((v_cfg ->> 'max_open')::int, 300) then 'queue_full' else 'queue_ok' end, 'open', v_open);
  end if;
  v_budget := least(greatest(p_limit, 0), greatest(coalesce((v_cfg ->> 'max_open')::int, 300) - v_open, 0), 500);
  if v_budget = 0 then return jsonb_build_object('skipped', 'queue_full', 'open', v_open); end if;
  -- fair split: new uploads always get their share; whatever live does not use rolls to the backfill
  v_back_budget := floor(v_budget * least(greatest(coalesce((v_cfg ->> 'backfill_share')::numeric, 0.5), 0), 1));
  v_live_budget := v_budget - v_back_budget;
  v_scan := least(greatest(coalesce((v_cfg ->> 'scan_per_lane')::int, 1000), 1), 5000);

  foreach v_lane in array array['live', 'backfill'] loop
    v_lane_budget := case v_lane when 'live' then v_live_budget else v_back_budget + v_carry end;
    -- Two steps, read from production's plan on 2026-11-10: (1) candidate ids by (created_at, id) from the partial index
    -- idx_vehicle_images_capture_ledger (user_id IS NOT NULL, INCLUDE id, created_at: an index-only scan of ~32k entries),
    -- (2) eligibility judged on at most v_scan rows by primary key. The cursor advances over candidates, not over the
    -- eligible subset, so ineligible rows are never rescanned.
    if v_lane = 'live' then
      -- newest uploads past the grace period, inside the live window
      select coalesce(array_agg(x.id), '{}') into v_cand from (
        select c.id from public.vehicle_images c
        where c.user_id is not null and (v_users is null or c.user_id = any (v_users))
          and c.created_at >= now() - make_interval(days => coalesce((v_cfg ->> 'live_days')::int, 2))
          and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
        order by c.created_at desc, c.id desc limit v_scan) x;
    else
      -- everything past the grace period, oldest first, by cursor; overlaps the live window on purpose so a bulk upload
      -- larger than the live scan is still reached within one pass (the one-open-item index prevents double queuing)
      select coalesce(array_agg(x.id), '{}') into v_cand from (
        select c.id from public.vehicle_images c, public.image_stage_reconciler_state st
        where st.lane = 'backfill'
          and c.user_id is not null and (v_users is null or c.user_id = any (v_users))
          and (st.cursor_created_at is null or (c.created_at, c.id) > (st.cursor_created_at, st.cursor_id))
          and c.created_at <= now() - make_interval(mins => coalesce((v_cfg ->> 'min_age_minutes')::int, 15))
        order by c.created_at asc, c.id asc limit v_scan) x;
    end if;
    select coalesce(array_agg(v.id), '{}') into v_ids
      from public.vehicle_images v
     where v.id = any (v_cand)
       and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and v.is_external is not true and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
       and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes');

    -- every gap among the scanned rows, in the lane's order; the first v_lane_budget are queued
    with gaps as materialized (
      select g.image_id, g.stage, g.target_version, g.reason, g.not_before, v.created_at,
             row_number() over (order by case when v_lane = 'live' then extract(epoch from v.created_at) else -extract(epoch from v.created_at) end desc, v.id, g.stage) as rn
        from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
       where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
    ), ins as (
      insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
      select image_id, stage, target_version, reason, v_lane, not_before from gaps where rn <= v_lane_budget
      on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
      returning 1
    ) select (select count(*) from ins), (select count(*) from gaps),
             (select g2.image_id from gaps g2 where g2.rn <= v_lane_budget order by g2.rn desc limit 1),
             (select g2.created_at from gaps g2 where g2.rn <= v_lane_budget order by g2.rn desc limit 1)
        into v_enq, v_gaps, v_taken_id, v_taken_at;

    -- Advance the backfill cursor, wrap at the end. When every gap found was queued, the cursor passes everything
    -- scanned (so pages of ineligible or already-read rows are never rescanned). When more gaps were found than the
    -- budget could queue, it stops at the last photo queued, so the rest are the first thing the next scan sees
    -- instead of waiting for a whole pass (on 2026-11-10 two runs scanned 200 and queued 100 each).
    if v_lane = 'backfill' then
      if coalesce(array_length(v_cand, 1), 0) = 0 then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = 0, last_enqueued = v_enq where lane = 'backfill';
      elsif v_gaps > greatest(v_lane_budget, 0) then
        if v_taken_id is not null then
          -- the last photo queued by this run, in backfill order (oldest first). With one required stage a photo is
          -- one gap; with several, a photo's later stage can be left for the next pass.
          update public.image_stage_reconciler_state set cursor_created_at = v_taken_at, cursor_id = v_taken_id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        else
          -- no budget this tick: the cursor stays where it is
          update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        end if;
      else
        select v.created_at, v.id into v_last from public.vehicle_images v where v.id = any (v_cand) order by v.created_at desc, v.id desc limit 1;
        update public.image_stage_reconciler_state set cursor_created_at = v_last.created_at, cursor_id = v_last.id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
      end if;
    else
      update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = coalesce(array_length(v_cand, 1), 0), last_enqueued = v_enq where lane = 'live';
      v_carry := greatest(v_lane_budget - v_enq, 0);
    end if;
    v_out := v_out || jsonb_build_object(v_lane, jsonb_build_object('scanned', coalesce(array_length(v_cand, 1), 0), 'eligible', coalesce(array_length(v_ids, 1), 0), 'enqueued', v_enq, 'budget', v_lane_budget));
    v_total := v_total + v_enq;
  end loop;
  return v_out || jsonb_build_object('enqueued', v_total, 'open_before', v_open, 'users', coalesce(to_jsonb(v_users), 'null'::jsonb));
end $$;
comment on function public.reconcile_image_stages(integer) is
  'Finds images missing a required stage, at an outdated version or contract, or with a retryable receipt, and enqueues only that stage. Idempotent (one open item per image+stage), bounded (scan_per_lane, max_open, p_limit<=500), fair (live lane first, backfill oldest-first by cursor, unused live budget rolls over), scoped to platform_config image_stage_reconciler.user_ids when set. Refills in batches: skips the scan while refill_below or more items are open. The backfill cursor never passes a gap it did not queue. No provider calls, no status writes, no dependence on the paid drain''s state. Gated by image_stage_reconciler.enabled. Migrations 20261113110000, 20261113140000.';

update public.platform_config
   set config_value = config_value || '{"refill_below": 100}'::jsonb
 where config_key = 'image_stage_reconciler';
-- start the pass again from the oldest photo: read photos hold receipts and are not gaps, so only the ones passed over are queued
update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null where lane = 'backfill';

commit;

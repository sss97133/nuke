-- Revert of 20261113160000_image_stage_capture_order.sql: the backfill goes back to upload-time order
-- (reconcile_image_stages as 20261113140000, claim_image_stage_work as 20261113130000) and the pass restarts.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '25s';
select pg_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0));
set local lock_timeout = '3s';
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.reconcile_image_stages(integer)'::regprocedure) not in ('ecc3d3ed7c93eff04c1febf6863d32db', '8ed142748a00047ab8cbc7ac7053d064') then
    raise exception 'reconcile_image_stages is neither the 20261113140000 nor the 20261113160000 body; review before reverting';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.claim_image_stage_work(text,integer,integer,uuid)'::regprocedure) not in ('f0f94d7e84a2907789c89099eb33a2e7', 'f394a12b4167ddc16a721f2cd0a805c2') then
    raise exception 'claim_image_stage_work is neither the 20261113130000 nor the 20261113160000 body; review before reverting';
  end if;
end $guard$;
create or replace function public.reconcile_image_stages(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg jsonb; v_open int; v_budget int; v_live_budget int; v_back_budget int; v_users uuid[];
  v_lane text; v_lane_budget int; v_scan int; v_cand uuid[]; v_ids uuid[]; v_last record; v_enq int;
  v_ready int; v_mark int; v_max int; v_gaps int; v_taken_id uuid; v_taken_at timestamptz;
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

  v_max := coalesce((v_cfg ->> 'max_open')::int, 300);
  -- refill mark: a JSON number of 1 or more; anything else (absent, 0, negative, text) means "refill whenever there is room"
  v_mark := case when jsonb_typeof(v_cfg -> 'refill_below') = 'number' and (v_cfg ->> 'refill_below')::numeric >= 1
                      and (v_cfg ->> 'refill_below')::numeric < 2147483647 then floor((v_cfg ->> 'refill_below')::numeric)::int end;
  -- open = everything queued or claimed (the cap); ready = what a reader could claim now (the refill mark)
  select count(*), count(*) filter (where status = 'queued' and not_before <= now()) into v_open, v_ready
    from public.image_stage_work where status in ('queued', 'claimed');
  v_budget := least(greatest(p_limit, 0), greatest(v_max - v_open, 0), 500);
  if v_budget = 0 then
    -- a tick at a real cap still ran: the watch on last_run_at must not read a full queue as a stopped reconciler
    if p_limit > 0 and v_max > 0 then update public.image_stage_reconciler_state set last_run_at = now(); end if;
    return jsonb_build_object('skipped', 'queue_full', 'open', v_open);
  end if;
  -- fair split: new uploads always get their share; whatever live does not use rolls to the backfill
  v_back_budget := floor(v_budget * least(greatest(coalesce((v_cfg ->> 'backfill_share')::numeric, 0.5), 0), 1));
  v_live_budget := v_budget - v_back_budget;
  v_scan := least(greatest(coalesce((v_cfg ->> 'scan_per_lane')::int, 1000), 1), 5000);

  foreach v_lane in array array['live', 'backfill'] loop
    v_lane_budget := case v_lane when 'live' then v_live_budget else v_back_budget + v_carry end;
    -- The backfill refills in batches: while a reader still has refill_below items it could claim, the scan (which reads
    -- each candidate's ai_scan_metadata) is skipped. The live lane above runs on every tick, so a new upload never
    -- waits for the backlog to drain.
    if v_lane = 'backfill' and v_mark is not null and v_ready >= v_mark then
      update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = 0, last_enqueued = 0 where lane = 'backfill';
      v_out := v_out || jsonb_build_object('backfill', jsonb_build_object('skipped', 'queue_ok', 'ready', v_ready, 'refill_below', v_mark));
      continue;
    end if;
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

    -- every gap among the scanned rows, in the lane's order (live: newest first; backfill: oldest first, as the scan
    -- and the cursor order them); the first v_lane_budget are queued
    with gaps as materialized (
      select g.image_id, g.stage, g.target_version, g.reason, g.not_before, v.created_at,
             row_number() over (order by case when v_lane = 'live' then v.created_at end desc nulls last,
                                         case when v_lane = 'live' then null else v.created_at end asc nulls last,
                                         v.id, g.stage) as rn
        from public.image_stage_gaps(v_ids) g join public.vehicle_images v on v.id = g.image_id
       where not exists (select 1 from public.image_stage_work w where w.image_id = g.image_id and w.stage = g.stage and w.status in ('queued', 'claimed'))
    ), ins as (
      insert into public.image_stage_work (image_id, stage, target_version, reason, lane, not_before)
      select image_id, stage, target_version, reason, v_lane, not_before from gaps where rn <= v_lane_budget
      on conflict (image_id, stage) where status in ('queued', 'claimed') do nothing
      returning 1
    ), taken as (
      -- the last photo all of whose gaps fit in the budget
      select g2.image_id, g2.created_at from gaps g2 group by g2.image_id, g2.created_at
      having max(g2.rn) <= v_lane_budget order by max(g2.rn) desc limit 1
    ) select (select count(*) from ins), (select count(*) from gaps), (select image_id from taken), (select created_at from taken)
        into v_enq, v_gaps, v_taken_id, v_taken_at;

    -- Advance the backfill cursor.
    --   nothing left to scan, or a short scan with every gap queued: the pass is over, start again from the oldest
    --   more gaps found than queued: stop at the last photo whose gaps were all queued, so the rest are the first thing
    --     the next scan sees instead of waiting for a whole pass (2026-11-10: two runs scanned 200 and queued 100 each)
    --   otherwise: pass everything scanned, so pages of ineligible or already-read rows are never rescanned
    if v_lane = 'backfill' then
      if coalesce(array_length(v_cand, 1), 0) = 0 then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = 0, last_enqueued = v_enq where lane = 'backfill';
      elsif v_gaps > greatest(v_lane_budget, 0) then
        if v_taken_id is not null then
          update public.image_stage_reconciler_state set cursor_created_at = v_taken_at, cursor_id = v_taken_id, last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        else
          -- no room for even the first photo's gaps: the cursor stays where it is
          update public.image_stage_reconciler_state set last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
        end if;
      elsif array_length(v_cand, 1) < v_scan then
        update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null, wrapped_at = now(), last_run_at = now(), last_scanned = array_length(v_cand, 1), last_enqueued = v_enq where lane = 'backfill';
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

update public.image_stage_reconciler_state set cursor_created_at = null, cursor_id = null where lane = 'backfill';
update public.platform_config set config_value = config_value - 'order' where config_key = 'image_stage_reconciler';
commit;

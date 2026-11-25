-- Revert of 20261126091500_image_stage_one_daily_cap.sql: puts back the five bodies production held on 2026-11-26
-- (20261125070000's claim and cap helpers, 20261113110000's receipt writer), the two plain cap columns with the numbers
-- production held (deep_reading live_daily_cap 150, backfill_daily_cap 150), and drops daily_cap, live_min_reserved,
-- image_stage_work.day_claims and the three new helpers. Receipts and work items written meanwhile stay (they are the
-- ledger's history); a receipt's detail.claim stays on it, and items carried to the next day keep their not_before.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '25s';
select pg_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0));
set local lock_timeout = '10s';

-- the old columns as production held them: plain, written once here
do $g$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'image_pipeline_stages'
               and column_name = 'live_daily_cap' and is_generated = 'ALWAYS') then
    alter table public.image_pipeline_stages drop column live_daily_cap;
    alter table public.image_pipeline_stages add column live_daily_cap integer;
    alter table public.image_pipeline_stages add constraint image_pipeline_stages_live_daily_cap_check check (live_daily_cap is null or live_daily_cap >= 0);
    update public.image_pipeline_stages set live_daily_cap = 150 where stage = 'deep_reading';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'image_pipeline_stages'
               and column_name = 'backfill_daily_cap' and is_generated = 'ALWAYS') then
    alter table public.image_pipeline_stages drop column backfill_daily_cap;
    alter table public.image_pipeline_stages add column backfill_daily_cap integer;
    alter table public.image_pipeline_stages add constraint image_pipeline_stages_backfill_daily_cap_check check (backfill_daily_cap is null or backfill_daily_cap >= 0);
    update public.image_pipeline_stages set backfill_daily_cap = 150 where stage = 'deep_reading';
  end if;
end $g$;
comment on column public.image_pipeline_stages.live_daily_cap is
  'Live-lane claims a day (America/Los_Angeles) for this stage, counted by claim_image_stage_work on image_stage_work.claimed_at; null = uncapped. Overflow stays queued with not_before at the next midnight PT, never dropped. Set where a stage spends a model call on the owner''s subscription (20261125070000).';
comment on column public.image_pipeline_stages.backfill_daily_cap is
  'Most work items of this stage the backfill lane may create per day (America/Los_Angeles day, counting every row not dropped). Null = no cap. The live lane is never capped.';

CREATE OR REPLACE FUNCTION public.claim_image_stage_work(p_stage text, p_limit integer DEFAULT 8, p_lease_seconds integer DEFAULT 300, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n int := least(greatest(p_limit, 1), 25); v_live_left int;
begin
  -- The live lane's daily cap (image_pipeline_stages.live_daily_cap, 20261125070000), counted on the claim: a reading
  -- stage runs on the owner's subscription and two hosts claim from this queue (the Mac reader and the photo-keys
  -- workflow), so the count and the pick are one critical section per capped stage. The lock is taken first, before any
  -- row lock, so two claimers can never wait on each other in the other order. An uncapped stage takes no lock.
  if exists (select 1 from public.image_pipeline_stages s where s.stage = p_stage and s.live_daily_cap is not null) then
    perform pg_advisory_xact_lock(hashtextextended('claim_image_stage_work:live_cap:' || p_stage, 0));
    v_live_left := public.image_stage_live_cap_left(p_stage);
    if v_live_left = 0 then
      -- the day's live claims are used: what is due in the live lane carries to the next day (America/Los_Angeles),
      -- queued, never dropped; the reconciler and the flow watch read it as not yet due
      update public.image_stage_work c set not_before = public.image_stage_next_day_start()
       where c.id in (select w.id from public.image_stage_work w
                       where w.stage = p_stage and w.lane = 'live' and w.status = 'queued' and w.not_before <= now()
                       for update skip locked);
    end if;
  end if;
  update public.image_stage_work d set status = 'dropped', finished_at = now(), lease_until = null
   where d.id in (
     select w.id from public.image_stage_work w
     left join public.vehicle_images v on v.id = w.image_id
     where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
       and (p_user_id is null or v.user_id = p_user_id or v.id is null)
       and not coalesce(v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and (v.is_external is not true or (v.vehicle_id is not null and not public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data))) and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal', false)
     order by w.id limit 200 for update of w skip locked);
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    join public.vehicle_images v on v.id = w.image_id
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
      and (p_user_id is null or v.user_id = p_user_id)
      and v.is_duplicate is not true and v.image_url ~ '^https?://' and v.is_sensitive is not true and (v.is_external is not true or (v.vehicle_id is not null and not public.image_stage_custody_external(v.is_external, v.user_id, v.source, v.exif_data))) and coalesce(v.is_superseded, false) = false and coalesce(v.vision_gate_status::text, '') <> 'rejected_personal'
      -- a pipeline run is in flight on the photo (the reconciler's own rule): leave the item queued until it ends or goes stale
      and not (coalesce(v.ai_processing_status, '') = 'processing' and coalesce(v.ai_processing_started_at, '-infinity'::timestamptz) > now() - interval '30 minutes')
    ), pick as (
      -- interleave: live #1, backfill #1, live #2, ... ; a lane with nothing due simply yields to the other
      -- (a capped live lane hands out at most what is left of today's cap; the backfill keeps its own cap at the enqueue)
      select d.id from due d where d.lane <> 'live' or v_live_left is null or d.rn <= v_live_left
       order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
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
             finished_at = case when l.image_id in (select s.image_id from still s) then null else now() end,
             claimed_at = case when l.image_id in (select s.image_id from still s) then now() else w.claimed_at end
      from locked l where w.id = l.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id
  where u.status = 'claimed';
end $function$


;

CREATE OR REPLACE FUNCTION public.record_image_stage_receipt(p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text, p_error_class text DEFAULT NULL::text, p_http_status integer DEFAULT NULL::integer, p_retry_after_seconds integer DEFAULT NULL::integer, p_input_fingerprint text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_producer text; v_attempt int; v_id bigint;
begin
  select producer into v_producer from public.image_pipeline_stages where stage = p_stage;
  if v_producer is null then raise exception 'unknown stage %', p_stage; end if;
  -- serialize attempts for one (image, stage, version) so concurrent producers get distinct attempt numbers
  perform pg_advisory_xact_lock(hashtextextended(p_image_id::text || ':' || p_stage || ':' || p_producer_version, 0));
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.image_stage_receipts
   where image_id = p_image_id and stage = p_stage and producer_version = p_producer_version;
  insert into public.image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, retry_after, error_class, http_status, input_fingerprint, detail)
  values (p_image_id, p_stage, v_producer, p_producer_version, p_outcome, v_attempt,
          case when p_outcome in ('unavailable', 'rate_limited') then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 300), 0), 86400)) end,
          p_error_class, p_http_status, p_input_fingerprint, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  -- close the open work item for this stage, if any
  update public.image_stage_work set status = 'done', finished_at = now(), lease_until = null
   where image_id = p_image_id and stage = p_stage and status in ('queued', 'claimed');
  -- a finished or deliberately closed stage can make the next one due (a reading landed: keyed values)
  if p_outcome in ('succeeded', 'policy_skip') then
    begin
      perform public.enqueue_image_stage_work(array[p_image_id]);
    exception when others then
      raise warning 'record_image_stage_receipt: enqueue_image_stage_work failed for %: %', p_image_id, sqlerrm;
    end;
  end if;
  return v_id;
end $function$


;

CREATE OR REPLACE FUNCTION public.image_stage_live_claimed_today(p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(*)::int from public.image_stage_work w
   where w.stage = p_stage and w.lane = 'live'
     and w.claimed_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' $function$


;

CREATE OR REPLACE FUNCTION public.image_stage_live_cap_left(p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when s.live_daily_cap is null then null
              else greatest(s.live_daily_cap - public.image_stage_live_claimed_today(s.stage), 0) end
    from public.image_pipeline_stages s where s.stage = p_stage $function$


;

CREATE OR REPLACE FUNCTION public.image_stage_backfill_cap_left(p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when s.backfill_daily_cap is null then null
              else greatest(s.backfill_daily_cap - (
                select count(*) from public.image_stage_work w
                 where w.stage = s.stage and w.lane = 'backfill' and w.status <> 'dropped'
                   and w.created_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'), 0)::int end
    from public.image_pipeline_stages s where s.stage = p_stage $function$


;

drop function if exists public.image_stage_cap_left(text, text);
drop function if exists public.image_stage_claimed_today(text, text);
drop function if exists public.image_stage_day_start();
alter table public.image_pipeline_stages drop constraint if exists image_pipeline_stages_live_min_reserved_check;
alter table public.image_pipeline_stages drop constraint if exists image_pipeline_stages_daily_cap_check;
alter table public.image_pipeline_stages drop column if exists live_min_reserved;
alter table public.image_pipeline_stages drop column if exists daily_cap;
alter table public.image_stage_work drop column if exists day_claims;

comment on function public.claim_image_stage_work(text, integer, integer, uuid) is
  'Leases due work for a stage worker, optionally for one user. Hands out only photos that are still eligible, still a gap, and have no pipeline run in flight; drops items whose photo stopped being eligible or whose gap closed. Service role only. Migrations 20261113110000, 20261113130000. A stage with image_pipeline_stages.live_daily_cap hands at most that many live items a day (America/Los_Angeles, counted on claimed_at, under a per-stage advisory lock); once it is used, live items due now carry to the next midnight PT (not_before), queued, never dropped (20261125070000).';
comment on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb) is null;
comment on function public.image_stage_backfill_cap_left(text) is null;

commit;

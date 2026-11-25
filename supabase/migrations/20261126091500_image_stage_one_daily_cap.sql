-- One daily cap per reading stage, covering both lanes and both hosts, counted at the claim; a deep reading receipt that
-- answers no claimed work item is refused.
--
-- Measured 2026-11-26 on production, after 20261125070000 (the ta-skeptic follow-up to #3861, ordered by the lead):
-- (1) Two numbers, not one. image_pipeline_stages held live_daily_cap 150 (counted at the claim) and backfill_daily_cap 150
--     (counted at the enqueue, on created rows). Deep reading's real ceiling was 150 + 150 = 300 a day.
-- (2) A row is not a claim. image_stage_live_claimed_today counted rows by claimed_at. A row whose lease ran out
--     (release_expired_image_stage_work) and was claimed again the same day counted once.
-- Usage behind the number. deep_reading receipts per Pacific day, image_stage_receipts, 2026-11-12..25:
--   0 on every day until 11-20; then 11-20: 1, 11-21: 3, 11-22: 2, 11-23: 112, 11-24: 83, 11-25: 63 (11-25 is a partial day,
--   last receipt 04:33 PT).
-- deep_reading work rows by lane, image_stage_work by created_at:
--   live: 14 (all on 11-24, the first and only day the live lane queued deep reading);
--   backfill: at most 117 (11-23).
-- The cap stays 150 a day for both lanes together, above every measured day (112 receipts, 117 work rows). The live lane
-- keeps 30 of them (about twice its one measured day, 14). So the backfill can take at most 120 a day, above its measured
-- 117.
--
-- 1. image_pipeline_stages.daily_cap: claims a day (America/Los_Angeles) for the stage, both lanes. Null = uncapped.
--    image_pipeline_stages.live_min_reserved: how many of them only the live lane may take. The live lane may take every
--    slot left. The backfill may take only what is left beyond the live lane's unused reserve:
--      total today <= daily_cap
--      backfill today <= daily_cap - live_min_reserved
--    deep_reading: 150 and 30. Every other stage stays null and 0.
-- 2. The old columns stay readable but cannot be written. live_daily_cap and backfill_daily_cap become generated columns:
--    daily_cap, and daily_cap - live_min_reserved. They are kept because the flow watch (assay_photo_reading_flow, live
--    9451a128, and the open #3882's body) reads live_daily_cap. A generated column cannot hold a number that disagrees
--    with the one cap.
-- 3. image_stage_work.day_claims: how many times the item was claimed on the Pacific day of claimed_at. A claim on a new
--    day starts it at 1, and a claim again the same day (after a lease ran out) adds 1. The day's count is the sum, so
--    every hand-out counts.
-- 4. claim_image_stage_work counts the cap under the stage's advisory lock (the key is unchanged from 20261125070000), so the
--    Mac reader and the photo-keys workflow cannot both take the last slots.
--    - The pick is held to the total left and the backfill to its share.
--    - After each claim: when the total is used, everything due carries to the next midnight PT (not_before): queued,
--      never dropped.
--    - When only the backfill's share is used, the backfill items due carry the same way.
--    - An uncapped stage takes no lock, as before.
-- 5. image_stage_backfill_cap_left (the backfill enqueue's pace, read by reconcile_image_stages and
--    enqueue_image_stage_work) is what the backfill may still claim today, less the backfill items already queued.
--    - The enqueue no longer counts created rows against a second number.
--    - It never queues a backfill item that cannot be claimed today. So the stage room (image_stage_deep_reading
--      max_open) is not filled by backfill items that would hold the live reserve's photos out until midnight.
-- 6. record_image_stage_receipt, for a capped stage:
--    - It refuses a receipt that answers no claimed work item (stage_receipt_unclaimed), keyed on daily_cap, not on the
--      stage's name.
--    - Accepted: the open item is claimed; or its lease ran out and it was handed back today and is not carried (claimed
--      since the day's start, not_before passed); or no item is open and one claimed item finished in the last 15 minutes
--      (a retry after a lost answer). An item handed back on an earlier day, or carried to tomorrow by the cap, is not
--      counted today, so a reading of it is refused.
--    - It stamps detail.claim (work_id, lane, status, claimed_at), so a receipt says which lane paid for it.
--    - Uncapped stages are unchanged, including the reconciler's keyed_values eligibility skips.
-- Unchanged: reconcile_image_stages, enqueue_image_stage_work, image_stage_gaps, assay_photo_reading_flow (its
-- 'live_cap_reached' wording reads the total cap as the live lane's: the follow-up waits for #3882), the stage room, the
-- event enqueue, the next-day helper. No DDL on vehicle_images. No row of a testimony table: receipts are written by
-- record_image_stage_receipt.
-- Contract: supabase/sql/test_image_stage_one_daily_cap.sql.
-- Revert: supabase/sql/revert_20261126091500_image_stage_one_daily_cap.sql.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '25s';   -- long enough to wait out one reconciler run
select pg_advisory_xact_lock(hashtextextended('reconcile_image_stages', 0));
set local lock_timeout = '10s';

-- The replaced bodies are the ones read from production on 2026-11-26 (20261125070000's, and 20261113110000's receipt
-- writer); refuse a body changed since. A replay finds this migration's own bodies and passes (the second md5 of each pair).
-- The two new helpers must be absent or this migration's own.
do $guard$
declare r record;
begin
  for r in select * from (values
      ('public.claim_image_stage_work(text,integer,integer,uuid)', '9413d19eb78423b1969934f9a930244d', '7c8f56b6722a6e456aa77037f3afd01a'),
      ('public.image_stage_live_cap_left(text)', 'c2d2ecc234608a31b703ad680d915dc8', '5fd7f72da5c21f441644e7a12040eefc'),
      ('public.image_stage_live_claimed_today(text)', 'c4d524ae98b14934595337d9a66307d8', '6056e6af3734eb3067721e9cf09f75a1'),
      ('public.image_stage_backfill_cap_left(text)', '70cc2ecb0b9608f650f03178c4d3d1d2', '25993cd30333bbc2803a8947d2bd5cec'),
      ('public.record_image_stage_receipt(uuid,text,integer,text,text,integer,integer,text,jsonb)', 'c0c1e66fd6a9b41c126c8b3c4807c719', '0327e91f8595817c927e09f9b70c4900'),
      ('public.image_stage_day_start()', 'missing', 'e64e4a66792aa124a7b01621cd092fa5'),
      ('public.image_stage_claimed_today(text,text)', 'missing', '6b45bb4f69eb743551deeac536e8cdb2'),
      ('public.image_stage_cap_left(text,text)', 'missing', 'c5b52aace401ceeb6a7f5882bf221611')) as t(fn, md5_before, md5_after) loop
    if coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing') not in (r.md5_before, r.md5_after) then
      raise exception '% is not the body this migration replaces (md5 %); review before applying', r.fn,
        coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure(r.fn)), 'missing');
    end if;
  end loop;
end $guard$;

-- ===== 1. the one cap and the lane split
alter table public.image_pipeline_stages add column if not exists daily_cap integer;
alter table public.image_pipeline_stages add column if not exists live_min_reserved integer not null default 0;
do $c$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.image_pipeline_stages'::regclass and conname = 'image_pipeline_stages_daily_cap_check') then
    alter table public.image_pipeline_stages add constraint image_pipeline_stages_daily_cap_check
      check (daily_cap is null or daily_cap >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.image_pipeline_stages'::regclass and conname = 'image_pipeline_stages_live_min_reserved_check') then
    alter table public.image_pipeline_stages add constraint image_pipeline_stages_live_min_reserved_check
      check (live_min_reserved >= 0 and (daily_cap is null or live_min_reserved <= daily_cap));
  end if;
end $c$;
comment on column public.image_pipeline_stages.daily_cap is
  'Claims a day (America/Los_Angeles) for this stage, both lanes and every host together, counted by claim_image_stage_work under the stage''s advisory lock (sum of image_stage_work.day_claims). Null = uncapped. Overflow stays queued with not_before at the next midnight PT, never dropped. deep_reading 150: above every measured day (112 receipts on 2026-11-23). 20261126091500.';
comment on column public.image_pipeline_stages.live_min_reserved is
  'Of daily_cap, the claims only the live lane may take: the backfill takes at most daily_cap - live_min_reserved a day, and less once the live lane has used past its reserve; the live lane may take every slot left. deep_reading 30 (its one measured live day: 14 work rows, 2026-11-24). 20261126091500.';

-- the first apply sets deep reading's numbers; a replay or a later hand change is left alone. Any other stage holding
-- an old cap would be a number this migration does not carry over: refuse.
do $v$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'image_pipeline_stages'
               and column_name = 'live_daily_cap' and is_generated = 'NEVER') then
    if exists (select 1 from public.image_pipeline_stages where stage <> 'deep_reading' and (live_daily_cap is not null or backfill_daily_cap is not null)) then
      raise exception 'a stage other than deep_reading holds live_daily_cap or backfill_daily_cap; carry it to daily_cap by hand in the migration';
    end if;
    update public.image_pipeline_stages set daily_cap = 150, live_min_reserved = 30 where stage = 'deep_reading' and daily_cap is null;
  end if;
end $v$;

-- ===== 2. the old names, derived from the one cap
do $g$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'image_pipeline_stages'
               and column_name = 'live_daily_cap' and is_generated = 'NEVER') then
    alter table public.image_pipeline_stages drop column live_daily_cap;
    alter table public.image_pipeline_stages add column live_daily_cap integer generated always as (daily_cap) stored;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'image_pipeline_stages'
               and column_name = 'backfill_daily_cap' and is_generated = 'NEVER') then
    alter table public.image_pipeline_stages drop column backfill_daily_cap;
    alter table public.image_pipeline_stages add column backfill_daily_cap integer generated always as (daily_cap - live_min_reserved) stored;
  end if;
end $g$;
comment on column public.image_pipeline_stages.live_daily_cap is
  'Read-only: equals daily_cap, the stage''s one cap, which the live lane may use whole (generated, 20261126091500; was its own number in 20261125070000).';
comment on column public.image_pipeline_stages.backfill_daily_cap is
  'Read-only: daily_cap - live_min_reserved, the most the backfill lane may claim in a day (generated, 20261126091500; was a count of created rows in 20261120130000).';

-- ===== 3. every hand-out counts
alter table public.image_stage_work add column if not exists day_claims integer not null default 0;
comment on column public.image_stage_work.day_claims is
  'How many times claim_image_stage_work handed this item out on the America/Los_Angeles day of claimed_at: 1 on a new day, +1 for a claim again the same day after a lease ran out. image_stage_claimed_today sums it (20261126091500).';
-- today's claims made before the column existed count once each (20261125070000 stamped claimed_at)
update public.image_stage_work set day_claims = 1
 where day_claims = 0 and claimed_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';

CREATE OR REPLACE FUNCTION public.image_stage_day_start()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' $function$;

CREATE OR REPLACE FUNCTION public.image_stage_claimed_today(p_stage text, p_lane text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(w.day_claims), 0)::int from public.image_stage_work w
   where w.stage = p_stage and (p_lane is null or w.lane = p_lane)
     and w.claimed_at >= public.image_stage_day_start() $function$;

-- What a lane may still claim today: the live lane, every slot left; the backfill, what is left beyond the live lane's
-- unused reserve. Null when the stage has no cap.
CREATE OR REPLACE FUNCTION public.image_stage_cap_left(p_stage text, p_lane text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when s.daily_cap is null then null
              when p_lane = 'live' then greatest(s.daily_cap - u.total, 0)
              else greatest(s.daily_cap - u.total - greatest(s.live_min_reserved - u.live, 0), 0) end
    from public.image_pipeline_stages s
    cross join lateral (select coalesce(sum(w.day_claims), 0)::int as total,
                               coalesce(sum(w.day_claims) filter (where w.lane = 'live'), 0)::int as live
                          from public.image_stage_work w
                         where w.stage = s.stage and w.claimed_at >= public.image_stage_day_start()) u
   where s.stage = p_stage $function$;

-- the two names the flow watch and 20261125070000 read, over the one count
CREATE OR REPLACE FUNCTION public.image_stage_live_claimed_today(p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.image_stage_claimed_today(p_stage, 'live') $function$;

CREATE OR REPLACE FUNCTION public.image_stage_live_cap_left(p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.image_stage_cap_left(p_stage, 'live') $function$;

-- The backfill enqueue's pace: what the backfill may still claim today, less what it already holds queued. Null when the
-- stage has no cap.
CREATE OR REPLACE FUNCTION public.image_stage_backfill_cap_left(p_stage text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when s.daily_cap is null then null
              else greatest(public.image_stage_cap_left(s.stage, 'backfill') - (
                select count(*) from public.image_stage_work w
                 where w.stage = s.stage and w.lane = 'backfill' and w.status = 'queued')::int, 0) end
    from public.image_pipeline_stages s where s.stage = p_stage $function$;

revoke all on function public.image_stage_day_start(), public.image_stage_claimed_today(text, text), public.image_stage_cap_left(text, text)
  from public, anon, authenticated;
grant execute on function public.image_stage_day_start(), public.image_stage_claimed_today(text, text), public.image_stage_cap_left(text, text)
  to service_role;

-- ===== 4. the claim
CREATE OR REPLACE FUNCTION public.claim_image_stage_work(p_stage text, p_limit integer DEFAULT 8, p_lease_seconds integer DEFAULT 300, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n int := least(greatest(p_limit, 1), 25); v_live_left int; v_back_left int;
begin
  -- One cap per stage, both lanes (image_pipeline_stages.daily_cap and live_min_reserved, 20261126091500), counted on the
  -- claim. A reading stage runs on the owner's subscription and two hosts claim from this queue (the Mac reader and the
  -- photo-keys workflow), so the count and the pick are one critical section per capped stage. The lock is taken first,
  -- before any row lock, so two claimers can never wait on each other in the other order. An uncapped stage takes no lock.
  if exists (select 1 from public.image_pipeline_stages s where s.stage = p_stage and s.daily_cap is not null) then
    perform pg_advisory_xact_lock(hashtextextended('claim_image_stage_work:live_cap:' || p_stage, 0));
    v_live_left := public.image_stage_cap_left(p_stage, 'live');    -- every slot left today
    v_back_left := public.image_stage_cap_left(p_stage, 'backfill'); -- the slots left beyond the live lane's unused reserve
    v_n := least(v_n, v_live_left);
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
      -- interleave: live #1, backfill #1, live #2, ... ; a lane with nothing due simply yields to the other.
      -- A capped stage hands out at most what is left today in all (v_n), the backfill at most its share (v_back_left).
      select d.id from due d
       where v_live_left is null or (d.lane = 'live' and d.rn <= v_live_left) or (d.lane <> 'live' and d.rn <= v_back_left)
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
             claimed_at = case when l.image_id in (select s.image_id from still s) then now() else w.claimed_at end,
             -- every hand-out counts: a claim again the same day (a lease ran out) adds one
             day_claims = case when l.image_id not in (select s.image_id from still s) then w.day_claims
                               when w.claimed_at >= public.image_stage_day_start() then w.day_claims + 1 else 1 end
      from locked l where w.id = l.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id
  where u.status = 'claimed';
  if v_live_left is not null then
    -- after this claim, a lane with nothing left today carries what it has due to the next day (America/Los_Angeles):
    -- queued, never dropped; the reconciler and the flow watch read it as not yet due
    v_live_left := public.image_stage_cap_left(p_stage, 'live');
    v_back_left := public.image_stage_cap_left(p_stage, 'backfill');
    if v_live_left = 0 or v_back_left = 0 then
      update public.image_stage_work c set not_before = public.image_stage_next_day_start()
       where c.id in (select w.id from public.image_stage_work w
                       where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
                         and (case when w.lane = 'live' then v_live_left else v_back_left end) = 0
                       for update skip locked);
    end if;
  end if;
end $function$
;

-- ===== 6. the receipt writer
CREATE OR REPLACE FUNCTION public.record_image_stage_receipt(p_image_id uuid, p_stage text, p_producer_version integer, p_outcome text, p_error_class text DEFAULT NULL::text, p_http_status integer DEFAULT NULL::integer, p_retry_after_seconds integer DEFAULT NULL::integer, p_input_fingerprint text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_producer text; v_cap int; v_attempt int; v_id bigint; v_detail jsonb := coalesce(p_detail, '{}'::jsonb); v_w record;
begin
  select producer, daily_cap into v_producer, v_cap from public.image_pipeline_stages where stage = p_stage;
  if v_producer is null then raise exception 'unknown stage %', p_stage; end if;
  -- serialize attempts for one (image, stage, version) so concurrent producers get distinct attempt numbers
  perform pg_advisory_xact_lock(hashtextextended(p_image_id::text || ':' || p_stage || ':' || p_producer_version, 0));
  -- A capped stage spends the owner's subscription (image_pipeline_stages.daily_cap, 20261126091500): its receipt must
  -- answer a work item that claim_image_stage_work handed out. The open item while it is claimed, or after its lease ran
  -- out only when it was claimed today and is not carried to tomorrow (a hand-out counted today); else, with no item
  -- open, one that was claimed and finished in the last 15 minutes (a retry after a lost answer). Anything else is a
  -- reading made around the cap: refused, and the item stays as it is.
  if v_cap is not null then
    select w.id, w.lane, w.status, w.claimed_at into v_w from public.image_stage_work w
     where w.image_id = p_image_id and w.stage = p_stage and w.status in ('queued', 'claimed')
       and (w.status = 'claimed' or (w.claimed_at >= public.image_stage_day_start() and w.not_before <= now()));
    if v_w.id is null then
      select w.id, w.lane, w.status, w.claimed_at into v_w from public.image_stage_work w
       where w.image_id = p_image_id and w.stage = p_stage and w.status = 'done' and w.claimed_at is not null
         and w.finished_at >= now() - interval '15 minutes'
       order by w.finished_at desc, w.id desc limit 1;
    end if;
    if v_w.id is null or v_w.claimed_at is null then
      raise exception 'stage_receipt_unclaimed: a % receipt for image % answers no claimed image_stage_work item', p_stage, p_image_id
        using errcode = '42501', hint = 'claim the photo with claim_image_stage_work first (20261126091500)';
    end if;
    -- which lane paid for it, on the receipt
    if jsonb_typeof(v_detail) = 'object' then
      v_detail := v_detail || jsonb_build_object('claim', jsonb_build_object('work_id', v_w.id, 'lane', v_w.lane, 'status', v_w.status, 'claimed_at', v_w.claimed_at));
    end if;
  end if;
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.image_stage_receipts
   where image_id = p_image_id and stage = p_stage and producer_version = p_producer_version;
  insert into public.image_stage_receipts (image_id, stage, producer, producer_version, outcome, attempt, retry_after, error_class, http_status, input_fingerprint, detail)
  values (p_image_id, p_stage, v_producer, p_producer_version, p_outcome, v_attempt,
          case when p_outcome in ('unavailable', 'rate_limited') then now() + make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 300), 0), 86400)) end,
          p_error_class, p_http_status, p_input_fingerprint, v_detail)
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

comment on function public.claim_image_stage_work(text, integer, integer, uuid) is
  'Leases due work for a stage worker, optionally for one user. Hands out only photos that are still eligible, still a gap, and have no pipeline run in flight; drops items whose photo stopped being eligible or whose gap closed. Service role only. Migrations 20261113110000, 20261113130000. A stage with image_pipeline_stages.daily_cap hands out at most that many items a day in both lanes together (America/Los_Angeles, the sum of image_stage_work.day_claims, under a per-stage advisory lock), the backfill at most daily_cap - live_min_reserved and less once the live lane has used past its reserve; a lane with nothing left carries its due items to the next midnight PT (not_before), queued, never dropped (20261125070000, 20261126091500).';
comment on function public.record_image_stage_receipt(uuid, text, integer, text, text, integer, integer, text, jsonb) is
  'Writes one typed receipt for (image, stage, producer version), closes the open work item and enqueues the next stage on a succeeded or policy_skip outcome. For a stage with image_pipeline_stages.daily_cap the receipt must answer a claimed work item (the open item while claimed, or handed back after a claim counted today and not carried, or one finished in the last 15 minutes) or it is refused with stage_receipt_unclaimed (42501), and it carries detail.claim (work_id, lane, status, claimed_at). Migrations 20261113110000, 20261126091500.';
comment on function public.image_stage_backfill_cap_left(text) is
  'The backfill enqueue''s pace for a capped stage: image_stage_cap_left(stage, ''backfill'') less the backfill items already queued; null when the stage has no daily_cap (20261120130000, 20261126091500).';

commit;

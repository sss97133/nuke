-- Attempt cap on image_stage_work (follow-up to #3027, stacked on it) + post-classifier stage attribution registry rows.
--
-- Risk: a work item could be claimed again and again (lease expiry after a crash, a runner that never writes a receipt)
-- and each claim can pay the classifier. Receipt counts do not bound that, because the failing path writes no receipt.
-- Fix: the counter lives on the work item and is bumped AT CLAIM. At image_pipeline_stages.max_attempts the item is
-- marked status='dead', dead_reason='max_attempts_exceeded' and never claimed again. The reconciler (image_stage_gaps)
-- skips an image+stage that has a dead item at the current required_version; bumping required_version re-opens it.
-- A trigger refuses a re-insert over a dead item at the same target_version, so a racing reconciler cannot revive it.
-- Also registers 'filing' and 'evidence' (not required) so a failure AFTER a successful classification is receipted on
-- its own stage and the reconciler never re-pays the classifier for it.

set local statement_timeout = '60s';
set local lock_timeout = '10s';

alter table public.image_stage_work add column if not exists attempts integer not null default 0 check (attempts >= 0);
alter table public.image_stage_work add column if not exists dead_reason text;
alter table public.image_stage_work drop constraint if exists image_stage_work_status_check;
alter table public.image_stage_work add constraint image_stage_work_status_check check (status in ('queued', 'claimed', 'done', 'dropped', 'dead'));
alter table public.image_stage_work drop constraint if exists image_stage_work_dead_typed;
alter table public.image_stage_work add constraint image_stage_work_dead_typed check ((status = 'dead') = (dead_reason is not null) and (dead_reason is null or dead_reason in ('max_attempts_exceeded')));
comment on column public.image_stage_work.attempts is 'Claims of this item, bumped inside claim_image_stage_work. Independent of receipts. At the stage max_attempts the item goes dead.';
comment on column public.image_stage_work.dead_reason is 'Typed reason for status=dead (max_attempts_exceeded). A dead item blocks re-enqueue until the stage required_version moves past its target_version.';

insert into public.image_pipeline_stages (stage, producer, required_version, required, applies_when, description) values
  ('filing',   'photo-pipeline-orchestrator', 1, false, 'always', 'Vehicle resolution and filing after a successful classification. A failure here is receipted here, not on the classifier.'),
  ('evidence', 'photo-pipeline-orchestrator', 1, false, 'always', 'Route handlers, observation and field-evidence writes after a successful classification. A failure here is receipted here, not on the classifier.')
on conflict (stage) do nothing;

-- ---- a dead item cannot be revived by an insert at the same or an older target version
create or replace function public.image_stage_work_no_revive() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.image_stage_work d where d.image_id = new.image_id and d.stage = new.stage and d.status = 'dead' and d.target_version >= new.target_version) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists image_stage_work_no_revive on public.image_stage_work;
create trigger image_stage_work_no_revive before insert on public.image_stage_work for each row execute function public.image_stage_work_no_revive();

-- ---- gap finder: skips dead items (otherwise dead gaps would eat the reconciler budget every run)
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
  join public.image_pipeline_stages s on s.required
  left join public.image_stage_current c on c.image_id = v.id and c.stage = s.stage
  where v.id = any (p_image_ids)
    -- dead item at this (or a newer) target version: no re-enqueue until required_version moves past it
    and not exists (select 1 from public.image_stage_work d where d.image_id = v.id and d.stage = s.stage and d.status = 'dead' and d.target_version >= s.required_version)
    and (s.applies_when = 'always'
         or (s.applies_when = 'document_like' and coalesce(v.ai_scan_metadata #>> '{classification,image_type}', '') in ('receipt', 'document', 'invoice', 'text_document')))
    and (
      (c.image_id is null and (not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data)
                               or public.image_stage_legacy_unavailable(v.ai_scan_metadata, s.legacy_unavailable_key)))
      or (c.producer_version < s.required_version and not public.image_stage_legacy_evidence(s.stage, v.ai_scan_metadata, v.exif_data))
      or (c.producer_version >= s.required_version and c.outcome in ('unavailable', 'rate_limited')
          and c.retry_after <= now()
          and c.attempt < s.max_attempts)
    )
$$;

-- ---- claim: kill exhausted items first, then count this claim
create or replace function public.claim_image_stage_work(p_stage text, p_limit integer default 8, p_lease_seconds integer default 300)
returns table(work_id bigint, image_id uuid, image_url text, user_id uuid, vehicle_id uuid, lane text, reason text, target_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int := least(greatest(p_limit, 1), 25);
begin
  update public.image_stage_work w set status = 'dead', dead_reason = 'max_attempts_exceeded', finished_at = now(), lease_until = null
   from public.image_pipeline_stages s
   where s.stage = w.stage and w.stage = p_stage and w.status = 'queued' and w.attempts >= s.max_attempts;
  if p_stage = 'classifier' and exists (select 1 from public.photo_pipeline_provider_state p where p.provider = 'classifier' and p.blocked_until > now()) then return; end if;
  return query
  with due as (
    select w.id, w.lane,
           row_number() over (partition by w.lane order by case when w.lane = 'live' then -extract(epoch from w.created_at) else extract(epoch from w.created_at) end, w.id) rn
    from public.image_stage_work w
    where w.stage = p_stage and w.status = 'queued' and w.not_before <= now()
    ), pick as (
      select d.id from due d order by d.rn, case when d.lane = 'live' then 0 else 1 end limit v_n
    ), locked as (
      select w.id from public.image_stage_work w where w.id in (select id from pick) and w.status = 'queued' for update skip locked
    ), upd as (
      update public.image_stage_work w set status = 'claimed', attempts = w.attempts + 1,
             lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
      from locked where w.id = locked.id returning w.*
    )
  select u.id, u.image_id, i.image_url, i.user_id, i.vehicle_id, u.lane, u.reason, u.target_version
  from upd u join public.vehicle_images i on i.id = u.image_id;
end $$;

-- expired leases return to the queue unless the item is out of attempts, then it is dead
create or replace function public.release_expired_image_stage_work()
returns integer language sql security definer set search_path = public, pg_temp as $$
  with r as (update public.image_stage_work w
                set status = case when w.attempts >= s.max_attempts then 'dead' else 'queued' end,
                    dead_reason = case when w.attempts >= s.max_attempts then 'max_attempts_exceeded' end,
                    finished_at = case when w.attempts >= s.max_attempts then now() end,
                    lease_until = null
               from public.image_pipeline_stages s
              where s.stage = w.stage and w.status = 'claimed' and w.lease_until < now() returning 1)
  select count(*)::int from r
$$;

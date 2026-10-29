-- Compact per-listing photo summary for valuation and the advisor, filled from vehicle_image_listing_resolved.
-- Why: per-listing photo facts and source coverage counts through the resolver time out at the 55s pooler cap.
-- Grain: one row per (vehicle, normalized listing URL) of auction_events, including listings with 0 photos.
-- Fill: refresh_listing_photo_summary(vehicle_ids, run_id) upserts a batch; drain_listing_photo_summary_queue() works
-- the dirty queue in 50-vehicle chunks for at most ~40s per call (pg_cron every minute). Statement triggers on
-- vehicle_images, auction_events, vehicle_image_listing_links and vehicle_image_nonvehicle_flags enqueue vehicles.
-- No long index builds: only primary keys on new, empty tables. shot_counts stays NULL until CLIP shot features exist.
-- Revert: supabase/rollbacks/20261028073000_listing_photo_summary_rollback.sql (retires rows by run_id; no deletes).

create table if not exists public.vehicle_listing_photo_summary (
  vehicle_id        uuid not null,
  listing_key       text not null,
  auction_event_id  uuid not null,
  listing_url       text not null,
  source            text not null,
  n_photos          integer not null default 0,
  n_high            integer not null default 0,
  n_medium          integer not null default 0,
  n_stored          integer not null default 0,
  n_implied         integer not null default 0,
  basis_mix         jsonb not null default '{}'::jsonb,
  shot_counts       jsonb,
  computed_at       timestamptz not null default now(),
  run_id            text not null,
  retired_at        timestamptz,
  retired_reason    text,
  retired_run_id    text,
  primary key (vehicle_id, listing_key)
);
comment on table public.vehicle_listing_photo_summary is
  'Per-listing photo facts from vehicle_image_listing_resolved: counts by confidence, stored vs single_listing_implied, basis_mix = method -> count, shot_counts (NULL until CLIP shot types exist). listing_key = lower(url without query/trailing slash). Readers filter retired_at is null. Retired rows are not refreshed.';
alter table public.vehicle_listing_photo_summary enable row level security;

create table if not exists public.vehicle_listing_photo_summary_queue (
  vehicle_id   uuid primary key,
  run_id       text not null,
  enqueued_at  timestamptz not null default now()
);
comment on table public.vehicle_listing_photo_summary_queue is
  'Dirty queue for vehicle_listing_photo_summary. Rows are removed once refreshed (queue bookkeeping, not data).';
alter table public.vehicle_listing_photo_summary_queue enable row level security;

create or replace function public.refresh_listing_photo_summary(p_vehicle_ids uuid[], p_run_id text)
returns integer language sql volatile set search_path = public as $$
  with l as (
    select distinct on (a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')))
           a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')) as lkey, a.id as event_id, a.source_url,
           case when a.source_url ilike '%bringatrailer.com%' then 'BaT' when a.source_url ilike '%mecum.com%' then 'Mecum'
                when a.source_url ilike '%barrett-jackson.com%' then 'B-J' when a.source_url ilike '%carsandbids.com%' then 'C&B'
                when a.source_url ilike '%rmsothebys.com%' then 'RM' else 'other' end as src
      from auction_events a
     where a.vehicle_id = any(p_vehicle_ids) and a.source_url is not null
     order by a.vehicle_id, lower(rtrim(split_part(a.source_url,'?',1),'/')), (a.auction_end_date is null), a.created_at, a.id
  ), r as materialized (
    select vehicle_id, lower(rtrim(split_part(listing_url,'?',1),'/')) as lkey, confidence, basis, method
      from vehicle_image_listing_resolved(p_vehicle_ids)
  ), m as (
    select vehicle_id, lkey, jsonb_object_agg(method, c) as mix
      from (select vehicle_id, lkey, method, count(*) c from r group by 1,2,3) z group by 1,2
  ), agg as (
    select vehicle_id, lkey, count(*) n, count(*) filter (where confidence='high') nh,
           count(*) filter (where confidence='medium') nm, count(*) filter (where basis='stored') ns,
           count(*) filter (where basis='single_listing_implied') ni
      from r group by 1,2
  ), up as (
    insert into vehicle_listing_photo_summary as s (vehicle_id, listing_key, auction_event_id, listing_url, source,
           n_photos, n_high, n_medium, n_stored, n_implied, basis_mix, computed_at, run_id)
    select l.vehicle_id, l.lkey, l.event_id, l.source_url, l.src, coalesce(agg.n,0), coalesce(agg.nh,0), coalesce(agg.nm,0),
           coalesce(agg.ns,0), coalesce(agg.ni,0), coalesce(m.mix,'{}'::jsonb), now(), p_run_id
      from l left join agg using (vehicle_id, lkey) left join m using (vehicle_id, lkey)
    on conflict (vehicle_id, listing_key) do update set
           auction_event_id = excluded.auction_event_id, listing_url = excluded.listing_url, source = excluded.source,
           n_photos = excluded.n_photos, n_high = excluded.n_high, n_medium = excluded.n_medium, n_stored = excluded.n_stored,
           n_implied = excluded.n_implied, basis_mix = excluded.basis_mix, computed_at = excluded.computed_at, run_id = excluded.run_id
     where s.retired_at is null
    returning 1
  ), gone as (
    update vehicle_listing_photo_summary s set retired_at = now(), retired_reason = 'listing_gone', retired_run_id = p_run_id
     where s.vehicle_id = any(p_vehicle_ids) and s.retired_at is null
       and not exists (select 1 from l where l.vehicle_id = s.vehicle_id and l.lkey = s.listing_key)
    returning 1
  )
  select count(*)::int from up;  -- data-modifying CTE "gone" runs regardless
$$;
comment on function public.refresh_listing_photo_summary(uuid[], text) is
  'Upsert vehicle_listing_photo_summary for the given vehicles from vehicle_image_listing_resolved; retires rows whose listing no longer exists. Retired rows are left alone. Keep batches small (<=50 BaT vehicles per call is safe under 55s).';

create or replace function public.drain_listing_photo_summary_queue(p_chunk integer default 50, p_budget_s integer default 40)
returns integer language plpgsql volatile set search_path = public as $$
declare
  t0 timestamptz := clock_timestamp();
  ids uuid[]; rid text; done int := 0;
begin
  loop
    exit when clock_timestamp() - t0 > make_interval(secs => p_budget_s);
    select run_id into rid from vehicle_listing_photo_summary_queue order by enqueued_at limit 1;
    exit when rid is null;
    select array_agg(vehicle_id) into ids from (
      select vehicle_id from vehicle_listing_photo_summary_queue where run_id = rid
       order by enqueued_at limit p_chunk for update skip locked) z;
    exit when ids is null;
    perform refresh_listing_photo_summary(ids, rid);
    delete from vehicle_listing_photo_summary_queue q where q.vehicle_id = any(ids) and q.run_id = rid;
    done := done + coalesce(array_length(ids,1),0);
  end loop;
  return done;
end $$;
comment on function public.drain_listing_photo_summary_queue(integer, integer) is
  'Refresh queued vehicles in chunks until the queue is empty or the time budget (seconds) is spent. Returns vehicles refreshed.';

create or replace function public.enqueue_listing_photo_summary_rows()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP in ('INSERT','UPDATE') then
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, 'listing_photo_summary_trigger' from new_rows where vehicle_id is not null
    on conflict (vehicle_id) do nothing;
  end if;
  if TG_OP in ('DELETE','UPDATE') then
    insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
    select distinct vehicle_id, 'listing_photo_summary_trigger' from old_rows where vehicle_id is not null
    on conflict (vehicle_id) do nothing;
  end if;
  return null;
end $$;

revoke all on function public.refresh_listing_photo_summary(uuid[], text) from public, anon, authenticated;
revoke all on function public.drain_listing_photo_summary_queue(integer, integer) from public, anon, authenticated;
revoke all on function public.enqueue_listing_photo_summary_rows() from public, anon, authenticated;

create or replace function public.enqueue_listing_photo_summary_move()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into vehicle_listing_photo_summary_queue (vehicle_id, run_id)
  select x.id, 'listing_photo_summary_trigger' from (values (OLD.vehicle_id), (NEW.vehicle_id)) x(id) where x.id is not null
  on conflict (vehicle_id) do nothing;
  return null;
end $$;
revoke all on function public.enqueue_listing_photo_summary_move() from public, anon, authenticated;

-- Triggers. Our link/flag tables: statement level for insert/update/delete. vehicle_images and auction_events
-- (busy tables): statement level for insert/delete, and a row trigger only when vehicle_id or the URL changes,
-- so ordinary updates on those tables do no extra work. lock_timeout keeps the migration from queueing behind
-- live writers; a table whose triggers could not be added is reported as a WARNING (flag for Skylar), the
-- deploy continues, and the table's sub-block is rolled back as a whole.
do $$
declare t text; op text;
begin
  perform set_config('lock_timeout', '5s', true);
  foreach t in array array['vehicle_image_listing_links','vehicle_image_nonvehicle_flags','auction_events','vehicle_images'] loop
    begin
      foreach op in array array['insert','update','delete'] loop
        execute format('drop trigger if exists trg_listing_photo_summary_%s on public.%I', op, t);
      end loop;
      execute format('create trigger trg_listing_photo_summary_insert after insert on public.%I referencing new table as new_rows for each statement execute function public.enqueue_listing_photo_summary_rows()', t);
      execute format('create trigger trg_listing_photo_summary_delete after delete on public.%I referencing old table as old_rows for each statement execute function public.enqueue_listing_photo_summary_rows()', t);
      if t in ('vehicle_image_listing_links','vehicle_image_nonvehicle_flags') then
        execute format('create trigger trg_listing_photo_summary_update after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.enqueue_listing_photo_summary_rows()', t);
      else
        execute format('create trigger trg_listing_photo_summary_update after update of vehicle_id, %s on public.%I for each row when (old.vehicle_id is distinct from new.vehicle_id or old.%s is distinct from new.%s) execute function public.enqueue_listing_photo_summary_move()',
          case t when 'vehicle_images' then 'image_url' else 'source_url' end, t,
          case t when 'vehicle_images' then 'image_url' else 'source_url' end, case t when 'vehicle_images' then 'image_url' else 'source_url' end);
      end if;
    exception when lock_not_available then
      raise warning 'listing photo summary: triggers on % not added (lock timeout) - add later, flag for Skylar', t;
    end;
  end loop;
end $$;

-- Every minute, at most ~40s of refresh work.
select cron.schedule('drain-listing-photo-summary-queue', '* * * * *',
  $c$select public.drain_listing_photo_summary_queue(50, 40)$c$);

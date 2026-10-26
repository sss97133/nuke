-- Cross-vehicle duplicate listing guard (additive, reversible).
-- The existing unique index idx_vehicle_events_dedup_url is per vehicle_id, so the same
-- source listing could be attached to two vehicle records and counted twice in comps
-- (found 2026-10-25: Mecum 4,545, Barrett-Jackson 1,825, Gooding 421).
-- This trigger does not block inserts; it quarantines a new event whose listing URL
-- (www/trailing-slash variants) already exists, un-quarantined, on a different vehicle.
-- Revert: drop trigger trg_vehicle_events_xveh_dup_guard on public.vehicle_events;
--         drop function public.vehicle_events_xveh_dup_guard();
create or replace function public.vehicle_events_xveh_dup_guard() returns trigger
language plpgsql as $$
declare base text; v text[]; other uuid;
begin
  if new.source_url is null then return new; end if;
  base := regexp_replace(new.source_url, '^(https?://)(www\.)?', '\1');
  base := regexp_replace(base, '/+$', '');
  v := array[base, base || '/', regexp_replace(base, '^(https?://)', '\1www.'), regexp_replace(base, '^(https?://)', '\1www.') || '/'];
  select e.id into other from public.vehicle_events e
   where e.source_url = any(v) and e.vehicle_id is distinct from new.vehicle_id and e.id <> new.id
     and not exists (select 1 from public.record_quarantine q where q.row_id = e.id and q.released_at is null)
   limit 1;
  if other is not null then
    insert into public.record_quarantine(tbl, row_id, reason, run_id)
    values ('vehicle_events', new.id, 'xveh_dup_guard_v1:same_listing_other_vehicle:' || other, 'xveh_dup_guard_v1');
  end if;
  return new;
end $$;
drop trigger if exists trg_vehicle_events_xveh_dup_guard on public.vehicle_events;
create trigger trg_vehicle_events_xveh_dup_guard after insert on public.vehicle_events
  for each row execute function public.vehicle_events_xveh_dup_guard();

-- Rehome log vs supersede: (a) supersede_vehicle_event_episode re-ids events (delete + insert), and the log's FK on
-- event_id made it fail on any rehomed event. The log is history: it keeps the id the event had, so the FK goes
-- (same convention as sale_price_basis_v1 / price_basis_observation). (b) revert_vehicle_event_rehome failed on a
-- rehome whose from_vehicle no longer exists (vehicles FK on write); it now skips that row and records why instead.
-- Revert: supabase/rollbacks/20261024100000_rehome_log_supersede_safe_down.sql
alter table public.vehicle_event_rehome_log drop constraint if exists vehicle_event_rehome_log_event_id_fkey;
alter table public.vehicle_event_rehome_log add column if not exists revert_note text;
comment on column public.vehicle_event_rehome_log.event_id is 'vehicle_events.id at rehome time. No FK: supersede re-ids events; the log keeps the historical id.';

create or replace function public.revert_vehicle_event_rehome(p_run_id text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; n integer := 0;
begin
  for r in select * from vehicle_event_rehome_log where run_id = p_run_id and reverted_at is null order by id desc loop
    if r.from_vehicle_id is not null and not exists (select 1 from vehicles where id = r.from_vehicle_id) then
      update vehicle_event_rehome_log set revert_note = 'skipped ' || now()::text || ': from_vehicle ' || r.from_vehicle_id || ' does not exist (dangling at rehome time); event left on ' || r.to_vehicle_id
       where id = r.id;
      continue;
    end if;
    if not exists (select 1 from vehicle_events where id = r.event_id) then
      update vehicle_event_rehome_log set revert_note = 'skipped ' || now()::text || ': event ' || r.event_id || ' no longer exists (superseded or re-id''d)'
       where id = r.id;
      continue;
    end if;
    update vehicle_events set vehicle_id = r.from_vehicle_id,
           merged_from_vehicle_id = case when merged_from_vehicle_id = r.from_vehicle_id then null else merged_from_vehicle_id end,
           metadata = metadata - 'rehome', updated_at = now()
     where id = r.event_id and vehicle_id = r.to_vehicle_id;
    update vehicle_event_rehome_log set reverted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $function$;

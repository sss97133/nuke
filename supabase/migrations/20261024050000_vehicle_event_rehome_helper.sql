-- Reversible helper to move a vehicle_event onto another (live) vehicle.
-- Used for sold events whose vehicle row was hard-deleted: the listing URL matches a live vehicle,
-- so the sale belongs there. Every move is logged with its prior vehicle_id and evidence, and can be undone.

create table if not exists public.vehicle_event_rehome_log (
  id bigserial primary key,
  event_id uuid not null references public.vehicle_events(id),
  from_vehicle_id uuid,
  to_vehicle_id uuid not null references public.vehicles(id),
  run_id text not null,
  evidence jsonb not null,
  moved_at timestamptz not null default now(),
  reverted_at timestamptz
);
create index if not exists vehicle_event_rehome_log_event_idx on public.vehicle_event_rehome_log(event_id);
create index if not exists vehicle_event_rehome_log_run_idx on public.vehicle_event_rehome_log(run_id);
alter table public.vehicle_event_rehome_log enable row level security;

create or replace function public.rehome_vehicle_event(p_event_id uuid, p_to_vehicle_id uuid, p_run_id text, p_evidence jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_log bigint;
begin
  if p_run_id is null or p_evidence is null or p_evidence = '{}'::jsonb then
    raise exception 'rehome_vehicle_event: run_id and evidence are required';
  end if;
  perform 1 from vehicles where id = p_to_vehicle_id and deleted_at is null and merged_into_vehicle_id is null;
  if not found then raise exception 'rehome_vehicle_event: target % is not a live vehicle', p_to_vehicle_id; end if;
  select vehicle_id into v_from from vehicle_events where id = p_event_id for update;
  if not found then raise exception 'rehome_vehicle_event: event % not found', p_event_id; end if;
  if v_from is not distinct from p_to_vehicle_id then return null; end if;
  insert into vehicle_event_rehome_log(event_id, from_vehicle_id, to_vehicle_id, run_id, evidence)
    values (p_event_id, v_from, p_to_vehicle_id, p_run_id, p_evidence) returning id into v_log;
  update vehicle_events
     set vehicle_id = p_to_vehicle_id,
         merged_from_vehicle_id = coalesce(merged_from_vehicle_id, v_from),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('rehome', jsonb_build_object(
           'log_id', v_log, 'run_id', p_run_id, 'from_vehicle_id', v_from, 'evidence', p_evidence, 'at', now())),
         updated_at = now()
   where id = p_event_id;
  return v_log;
end $$;

-- Undo every move in a run, newest first. The prior vehicle_id may point at a deleted vehicle again (that was the original state).
create or replace function public.revert_vehicle_event_rehome(p_run_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select * from vehicle_event_rehome_log where run_id = p_run_id and reverted_at is null order by id desc loop
    update vehicle_events set vehicle_id = r.from_vehicle_id,
           merged_from_vehicle_id = case when merged_from_vehicle_id = r.from_vehicle_id then null else merged_from_vehicle_id end,
           metadata = metadata - 'rehome', updated_at = now()
     where id = r.event_id and vehicle_id = r.to_vehicle_id;
    update vehicle_event_rehome_log set reverted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.rehome_vehicle_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.revert_vehicle_event_rehome(text) from public, anon, authenticated;
grant execute on function public.rehome_vehicle_event(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.revert_vehicle_event_rehome(text) to service_role;

-- Revert 20261024100000_rehome_log_supersede_safe. FK re-added NOT VALID so log rows for superseded events stay.
alter table public.vehicle_event_rehome_log add constraint vehicle_event_rehome_log_event_id_fkey foreign key (event_id) references public.vehicle_events(id) not valid;
create or replace function public.revert_vehicle_event_rehome(p_run_id text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
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
end $function$;
alter table public.vehicle_event_rehome_log drop column if exists revert_note;

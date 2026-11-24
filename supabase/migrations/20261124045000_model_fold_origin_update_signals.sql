-- Model fold: origin update signals (20261124045000)
-- Why: an observation superseded/edited/moved or field evidence rejected/edited/moved withdraws a reading's origin, but only
-- inserts signalled, so the vehicle was not re-folded. Row-level triggers with column lists + WHEN fire only on real changes.
-- Apply in a quiet window: vehicle_observations / field_evidence are busy with spec landing; creating triggers waits behind it.
-- Revert: drop the two model_fold_signal_upd triggers and model_fold_origin_update_signal().

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Withdrawn or moved origins: an observation superseded/edited/moved or evidence rejected/moved re-queues its vehicle.
-- Row-level with column lists and WHEN, so only real changes to these columns fire.
create or replace function public.model_fold_origin_update_signal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.model_fold_signal_ids(array_remove(array[old.vehicle_id, new.vehicle_id], null), tg_table_name || '_update');
  exception when others then
    raise warning 'model_fold signal skipped (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.model_fold_origin_update_signal() from public, anon, authenticated;

drop trigger if exists model_fold_signal_upd on public.vehicle_observations;
create trigger model_fold_signal_upd after update of is_superseded, content_text, vehicle_id on public.vehicle_observations
  for each row when (old.is_superseded is distinct from new.is_superseded or old.content_text is distinct from new.content_text
                     or old.vehicle_id is distinct from new.vehicle_id)
  execute function public.model_fold_origin_update_signal();
drop trigger if exists model_fold_signal_upd on public.field_evidence;
create trigger model_fold_signal_upd after update of status, proposed_value, vehicle_id on public.field_evidence
  for each row when (old.status is distinct from new.status or old.proposed_value is distinct from new.proposed_value
                     or old.vehicle_id is distinct from new.vehicle_id)
  execute function public.model_fold_origin_update_signal();

commit;

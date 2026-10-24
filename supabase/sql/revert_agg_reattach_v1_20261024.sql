-- Revert run agg_reattach_v1_20261024: put each moved event back on its old vehicle with its old flags, and retire the run's marks.
-- Moving an event back onto a vehicle its chassis does not match is exactly what trg_guard_aggregator_event_attach refuses, so this
-- revert restores the pre-run state with session_replication_role = replica (owner-only; skips row triggers for this transaction).
begin;
set local session_replication_role = replica;
update public.vehicle_events e set vehicle_id = b.from_vehicle_id, source_suspect = b.old_source_suspect,
  source_suspect_reason = b.old_source_suspect_reason, source_suspect_run_id = b.old_source_suspect_run_id,
  source_suspect_at = b.old_source_suspect_at,
  metadata = case when b.old_attach_basis is null then e.metadata - 'attach_basis' else e.metadata || jsonb_build_object('attach_basis', b.old_attach_basis) end
from public.backup_agg_reattach_v1_20261024 b
where e.id = b.event_id and e.vehicle_id = b.to_vehicle_id and e.source_suspect_run_id = 'agg_reattach_v1_20261024';
update public.vehicle_sale_price_untrusted_marks set retired_at = now() where run_id = 'agg_reattach_v1_20261024' and retired_at is null;
commit;
-- the backup table is kept (never deleted)

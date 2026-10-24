-- Revert run agg_attach_audit_v1_20261024: restore each flagged event's source_suspect fields from the backup.
update public.vehicle_events e set source_suspect = b.old_source_suspect, source_suspect_reason = b.old_source_suspect_reason,
  source_suspect_run_id = b.old_source_suspect_run_id, source_suspect_at = b.old_source_suspect_at
from public.backup_agg_attach_audit_v1_20261024 b
where e.id = b.event_id and e.source_suspect_run_id = 'agg_attach_audit_v1_20261024';
-- the backup table is kept (never deleted)

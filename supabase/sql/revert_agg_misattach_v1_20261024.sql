-- revert run agg_misattach_v1_20261024 (restores the state just before it, i.e. after dup_agg_v1)
update public.vehicle_events e set sale_truth_role=b.sale_truth_role, duplicate_of_event_id=b.duplicate_of_event_id,
  source_suspect=b.source_suspect, source_suspect_reason=b.source_suspect_reason, source_suspect_run_id=b.source_suspect_run_id, source_suspect_at=b.source_suspect_at
from public.backup_agg_misattach_v1_20261024 b where e.id=b.id and e.source_suspect_run_id='agg_misattach_v1_20261024';

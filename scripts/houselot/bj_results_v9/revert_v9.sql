-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
set local statement_timeout='55s'; set local lock_timeout='5s';
-- Revert run agg_houselot_v9_20261024 without deleting anything:
-- 1) cc events back to their from-vehicle with original suspect fields/metadata (from backup); 2) untrusted marks retired;
-- 3) the inserted B-J house events are retracted in place (event_status 'cancelled', source_suspect vehicle_id, reason) - rows kept;
-- 4) staging rows unlinked. Staging table and backup are kept (rename to retired_* if wanted).
set local session_replication_role = replica;
update public.vehicle_events e set vehicle_id=b.from_vehicle_id, source_suspect=b.old_source_suspect, source_suspect_reason=b.old_source_suspect_reason,
  source_suspect_run_id=b.old_source_suspect_run_id, source_suspect_at=b.old_source_suspect_at, metadata=b.old_metadata
from public.backup_agg_houselot_v9_20261024 b where e.id=b.event_id and e.source_suspect_run_id='agg_houselot_v9_20261024';
update public.vehicle_sale_price_untrusted_marks set retired_at=now() where run_id='agg_houselot_v9_20261024' and retired_at is null;
update public.vehicle_events e set event_status='cancelled', source_suspect=array['vehicle_id'], source_suspect_reason='retracted: revert of run agg_houselot_v9_20261024',
  source_suspect_run_id='revert_agg_houselot_v9_20261024', source_suspect_at=now()
from public.backup_agg_houselot_v9_20261024 b where e.id=b.house_event_id and e.extraction_run_id='agg_houselot_v9_20261024';
update public.bj_results_stage_v1_20261024 set inserted_house_event_id=null, attached_cc_event_id=null, note='reverted agg_houselot_v9_20261024' where note='agg_houselot_v9_20261024 attached';


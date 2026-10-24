-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert run mecum_lot_from_sli_v1_20261024: clear only the lot columns this run wrote (provenance table kept). Run in small batches.
set local statement_timeout='50s'; set local lock_timeout='5s';
update public.vehicle_events e set lot_number=null, lot_number_source_url=null, lot_number_run_id=null, lot_number_read_at=null
from public.mecum_lot_from_sli_v1_20261024 p where e.id=p.event_id and e.lot_number_run_id=p.run_id and p.batch between :lo and :hi;


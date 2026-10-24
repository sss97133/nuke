-- Revert run mecum_lot_read_v1_20261024 (lot columns only)
begin; set local statement_timeout='50s'; set local lock_timeout='5s';
update public.vehicle_events set lot_number=null, lot_number_source_url=null, lot_number_run_id=null, lot_number_read_at=null where lot_number_run_id='mecum_lot_read_v1_20261024';
commit;

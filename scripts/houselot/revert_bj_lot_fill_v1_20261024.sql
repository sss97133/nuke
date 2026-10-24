-- Revert run bj_lot_fill_v1_20261024: clear only the lot numbers that run wrote (they were null before; nothing else changes).
begin;
set local statement_timeout = '50s';
update public.vehicle_events set lot_number = null, lot_number_source_url = null, lot_number_run_id = null, lot_number_read_at = null
where lot_number_run_id = 'bj_lot_fill_v1_20261024';
commit;

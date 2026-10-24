-- Rollback for 20261026100000_vehicle_sale_fx_consistency_check.
set lock_timeout = '5s';
alter table public.vehicles drop constraint if exists vehicles_sale_price_fx_consistent;

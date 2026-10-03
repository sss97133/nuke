-- Validate image_coverage_by_vehicle_vehicle_id_fkey on public.image_coverage_by_vehicle against existing rows (declared NOT VALID in 20261003200000).
-- The deploy runs psql without a transaction, so the timeouts sit inside an explicit one.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '900s';
alter table public.image_coverage_by_vehicle validate constraint image_coverage_by_vehicle_vehicle_id_fkey;
commit;

-- Revert vehicle_category_unknown_default_v1. Contains no transaction-ending statement; run inside your own transaction.
-- Restores DEFAULT 'car'. Rows inserted while the default was absent keep NULL (not guessed);
-- they are listed in vehicle_category_change_log 'revert' counts. The log table is kept for audit.
set local lock_timeout = '5s';
drop view if exists public.vehicle_category_resolved;
alter table public.vehicles alter column vehicle_category set default 'car'::text;
comment on column public.vehicles.vehicle_category is null;
insert into public.vehicle_category_change_log(run_id, phase, column_default, counts)
select 'vehicle_category_unknown_default_v1_20261025', 'revert', 'car',
  jsonb_build_object('null_rows', (select count(*) from public.vehicles where vehicle_category is null));

set local statement_timeout='55s';
update public.vehicle_identity_evidence set retired_at=null, issues=coalesce((select array_agg(i) from unnest(issues) i where i not like 'excluded:vin_mismatch_v1_20261025%'),'{}') where exists (select 1 from unnest(issues) i where i like 'excluded:vin_mismatch_v1_20261025%');
drop table if exists public.vehicle_vin_mismatch;
insert into public.vehicle_category_change_log(run_id,phase,counts) values ('vin_mismatch_v1_20261025','revert','{}'::jsonb);

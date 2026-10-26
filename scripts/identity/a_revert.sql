set local statement_timeout='55s';
update public.vehicle_identity_evidence set retired_at=null, issues=coalesce((select array_agg(i) from unnest(issues) i where i not like 'retired:lex_contam_v1_20261025%'),'{}') where exists (select 1 from unnest(issues) i where i like 'retired:lex_contam_v1_20261025%');
insert into public.vehicle_category_change_log(run_id,phase,counts) values ('lex_contam_v1_20261025','revert','{}'::jsonb);

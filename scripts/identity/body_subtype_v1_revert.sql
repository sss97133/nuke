-- revert for bodysub_v1_20261025, camper_v1_20261025, rv_chassis_resolve_20261025. Run top to bottom; no COMMIT.
set local statement_timeout='55s';
update public.vehicle_identity_evidence set body_subtype=null,body_subtype_rule=null,body_subtype_cite=null,body_subtype_run_id=null where body_subtype_run_id='rv_chassis_resolve_20261025';
update public.vehicle_identity_evidence set conflict=true where exists (select 1 from unnest(issues) i where i like 'resolved:rv_on_van_chassis_20261025%prior_conflict:true');
update public.vehicle_identity_evidence set issues=coalesce((select array_agg(i) from unnest(issues) i where i not like 'resolved:rv_on_van_chassis_20261025%'),'{}') where exists (select 1 from unnest(issues) i where i like 'resolved:rv_on_van_chassis_20261025%');
insert into public.vehicle_category_change_log(run_id,phase,counts) values ('rv_chassis_resolve_20261025','revert','{}'::jsonb);
set local statement_timeout='55s';
update public.vehicle_identity_evidence set retired_at=now(), issues=issues||array['retired:revert_camper_v1_20261025'] where run_id='camper_v1_20261025' and extractor='identity_camper_v1' and retired_at is null;
update public.vehicle_identity_evidence set retired_at=null, issues=array_remove(issues,'retired:camper_v1_20261025 superseded by identity_camper_v1 trailer_rv') where 'retired:camper_v1_20261025 superseded by identity_camper_v1 trailer_rv'=any(issues);
update public.vehicle_identity_evidence set conflict=true where exists (select 1 from unnest(issues) i where i like 'resolved:rv_on_van_chassis_20261025%prior_conflict:true');
update public.vehicle_identity_evidence set issues=coalesce((select array_agg(i) from unnest(issues) i where i not like 'resolved:rv_on_van_chassis_20261025%'),'{}') where exists (select 1 from unnest(issues) i where i like 'resolved:rv_on_van_chassis_20261025%');
insert into public.vehicle_category_change_log(run_id,phase,counts) values ('camper_v1_20261025','revert','{}'::jsonb);
set local statement_timeout='55s';
update public.vehicle_identity_evidence set body_subtype=null,body_subtype_rule=null,body_subtype_cite=null,body_subtype_run_id=null where body_subtype_run_id in ('bodysub_v1_20261025','camper_v1_20261025');
-- finally, only if dropping the feature:
-- alter table public.vehicle_identity_evidence drop constraint if exists vie_body_subtype_cited_chk, drop constraint if exists vie_body_subtype_chk,
--   drop column if exists body_subtype_run_id, drop column if exists body_subtype_rule, drop column if exists body_subtype_cite, drop column if exists body_subtype;

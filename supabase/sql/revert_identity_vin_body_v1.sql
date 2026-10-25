-- Revert identity_vin_body_v1_20261025 (no COMMIT; run inside a transaction you control). Retires, never deletes.
update public.vehicle_identity_evidence set retired_at=now()
 where run_id='identity_vin_body_v1_20261025' and retired_at is null;
insert into public.vehicle_category_change_log(run_id,phase,counts)
values ('identity_vin_body_v1_20261025','revert',jsonb_build_object('note','vin body-class evidence retired'));

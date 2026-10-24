-- Revert rm_makefix_v1_20261024
begin; set local statement_timeout='50s';
update public.vehicles v set make=b.old_make, model=b.old_model, canonical_make_id=b.old_canonical_make_id, make_source=b.old_make_source, model_source=b.old_model_source, updated_at=now()
from public.backup_rm_makefix_v1_20261024 b where v.id=b.vehicle_id and v.make is not distinct from b.new_make and v.model is not distinct from b.new_model;
commit;

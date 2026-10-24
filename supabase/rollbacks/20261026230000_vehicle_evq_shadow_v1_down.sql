-- never hard-delete: retire shadow tables, drop only the shadow functions (code, recreatable from the migration)
drop function if exists public.vehicle_evq_shadow_refresh(uuid[], text);
drop function if exists public.compute_vehicle_evq_shadow(uuid);
drop function if exists public.vehicle_evq_shadow_evidence(uuid);
alter table if exists public.vehicle_evq_shadow rename to retired_vehicle_evq_shadow_v1;
alter table if exists public.vehicle_evidence_source_types rename to retired_vehicle_evidence_source_types_v1;

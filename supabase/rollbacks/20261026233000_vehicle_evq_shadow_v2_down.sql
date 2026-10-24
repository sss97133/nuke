-- never hard-delete data: retire v2 tables, drop only v2 functions; v2 columns on vehicle_evq_shadow are left (nullable, shadow-only)
drop function if exists public.vehicle_evq_shadow_rescore(text);
drop function if exists public.vehicle_evq_shadow_refresh_v2(uuid[], text, text);
drop function if exists public.vehicle_evq_calib_sample_refresh(jsonb, text);
drop function if exists public.vehicle_evq_score_from_components(jsonb, text);
drop function if exists public.vehicle_evq_components_v2(uuid, timestamptz);
drop function if exists public.vehicle_evq_shadow_evidence_v2(uuid, timestamptz);
alter table if exists public.vehicle_evq_calibration rename to retired_vehicle_evq_calibration_v2;
alter table if exists public.vehicle_evq_calib_sample rename to retired_vehicle_evq_calib_sample_v2;
update public.vehicle_evidence_source_types set basis_ref = split_part(basis_ref, ' | v2:', 1),
  evidence_query = 'vehicle_event_listing_mileage on the vehicle''s events, validation not rejected' where source_type = 'odometer';

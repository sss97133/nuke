-- Revert 20261122081000 replica / byok fold.
DROP FUNCTION IF EXISTS public.gap_vs_build_replica_components(uuid, boolean);
DROP FUNCTION IF EXISTS public.read_vehicle_image_group(uuid, text);
DROP FUNCTION IF EXISTS public.vehicle_replica_accuracy(uuid);
DROP FUNCTION IF EXISTS public.decide_replica_components(uuid, boolean);
DROP FUNCTION IF EXISTS public.fold_byok_component_observations(uuid, boolean);
DROP FUNCTION IF EXISTS public.vehicle_build_phase_windows(uuid);
DROP FUNCTION IF EXISTS public.group_vehicle_images_for_reading(uuid, boolean);
DROP FUNCTION IF EXISTS public.byok_real_capture_at(jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.byok_infer_image_area(text);
DROP FUNCTION IF EXISTS public.byok_normalize_build_phase(text, text, jsonb);
DROP FUNCTION IF EXISTS public.normalize_byok_component_label(text);
DROP TABLE IF EXISTS public.vehicle_replica_component_decisions;
DROP TABLE IF EXISTS public.vehicle_image_groups;
DROP TABLE IF EXISTS public.replica_target_specs;
-- observation_properties rows left in place (registry).

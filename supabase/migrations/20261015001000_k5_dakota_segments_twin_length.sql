-- K5 harness: four PDM30 -> Dakota VHX segments re-planned from the twin's routed path. Case ledger 13.12.3.
--
-- The geometry check (v_harness_segment_geometry, RSI pass 7) found four live K5 segments planned shorter than the
-- straight line between their plugs in the twin, 3.59 ft: #119 and #120 at 1.5 ft and #71 and #39 at 3.5 ft, all
-- "whole-wire zone estimate from the legacy row (cut list v4.2 basis)". Measured read-only 2026-10-14. The twin routes
-- this run as landmark L18, PDM30 -> DASH_CLUSTER (the headlight-switch dash region, where the Dakota VHX box is
-- anchored): 43.4 in = 3.62 ft along the routed polyline (docs/wiring/output/K5_landmarks_blender_derived.yaml;
-- nuke_frontend/src/components/wiring/k5LandmarkPaths.ts L18), rounded up to 3.7 ft. The registry generator carries the
-- same value and basis (docs/wiring/calc-data/reconcile_v5.py, k5_registry.json in this commit); the 15 % body cut pad
-- (K5_WIRING_STATE.md row 33) is applied downstream, as for every planned length. The PDM30 position is the twin's
-- assertion A2 (state section 4). Not taped on the truck.
--
-- Segments are the harness model's planned-length predictions (derived rows); the legacy vehicle_custom_circuits rows
-- keep the zone estimate until the registry loader next supersedes them.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regclass('public.v_harness_segment_geometry') IS NULL THEN
    RAISE EXCEPTION 'the geometry check (20261014173000) has not run';
  END IF;
END $guard$;

UPDATE public.harness_segments s
SET planned_length_ft = 3.7,
    planned_length_method = 'twin route: landmark L18 PDM30 -> DASH_CLUSTER, 43.4 in along the routed polyline, rounded up to 0.1 ft (K5_landmarks_blender_derived.yaml; k5LandmarkPaths.ts); was the cut list v4.2 zone estimate, shorter than the 3.59 ft straight line; the 15 % body pad applies downstream; PDM30 position is twin assertion A2; not taped'
FROM public.vehicle_custom_circuits c
WHERE c.id = s.vehicle_custom_circuit_id
  AND s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT s.is_superseded
  AND c.circuit_code IN ('119', '120', '71', '39')
  AND s.planned_length_ft < 3.7;

DO $check$
DECLARE short int; fixed int;
BEGIN
  SELECT count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft = 3.7)
    INTO short, fixed
  FROM public.v_harness_segment_geometry g
  WHERE g.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND g.circuit_code IN ('119', '120', '71', '39');
  IF short > 0 THEN
    RAISE EXCEPTION '% PDM30 -> Dakota segments are still planned shorter than the straight line', short;
  END IF;
  RAISE NOTICE 'Dakota re-plan: % segments at 3.7 ft, none shorter than the straight line', fixed;
END $check$;

COMMIT;

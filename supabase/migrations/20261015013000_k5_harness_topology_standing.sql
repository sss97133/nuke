-- RSI pass 12 on the harness model: the route graph lands in the model, and each of its points says whether it still
-- stands. Case ledger 13.12.3.
--
-- The dimension layer had tables and no rows: harness_topology_nodes 0, vehicle_harness_landmarks 0 (the 2026-06-10
-- ingest receipt says 30 were written; the live table holds none), harness_routings 0. The graph existed only in two
-- repo files: docs/wiring/output/K5_landmarks_blender_derived.yaml (30 branch lengths, 2026-06-09, re-derived L14/L15
-- 2026-06-10) and nuke_frontend/src/components/wiring/k5LandmarkPaths.ts (the 29 anchors and the 30 polylines that
-- produced those lengths; every polyline reproduces its length within 0.05 in). The registry loader copies anchor
-- coordinates onto plugs as text (load_map_rows.py ANCHORS), so the scoreboard counted 132 segments with both plugs
-- positioned.
--
-- The record overtook ten of those anchors after 2026-06-09 (docs/wiring/K5_WIRING_STATE.md):
--   FWG_MAIN  -> the one 61-pin at the original fuse-box hole, driver kick panel (owner call, row 0ah, 2026-09-29;
--                receipts/2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md). Its coordinates are derived the way the
--                twin derived H3: objectTraits.ts FB lateral and height at the probed firewall plane y = -1.46 m.
--   M130, PDM30 -> "follow the 61-pin to the driver side; the spot waits" (same receipt; mounts.yaml status open).
--   COIL1, COIL2 -> all eight coils on the DEL-Stributor central mount, rear centre behind the intake (row 0ag h, i:
--                "re-derive for the central DEL-Stributor").
--   CKP       -> Gen IV 58x CKP is in the block above the starter, right rear (row 0ag f).
--   BAT, K5H_Battery -> passenger firewall corner, the owner's working position (state section 4, 2026-06-10); it
--                conflicts with the retained A/C box (row 0ag d).
--   ALT, K5H_Alternator -> Holley Mid-Mount installed 2026-09-24 (state section 4); its side is not modelled.
--   O2_L, O2_R -> LTCD sensors at least 1 m downstream of the ports, under the cab (row 0ag 4; LTC manual pp. 4-5).
-- A successor point with no coordinates is the honest state: the place is decided or open, and nobody has measured or
-- derived it. Every branch that ends on a fallen point is superseded with it: 24 of the 30 twin branches, plus the
-- 2026-06-10 L14 (its CVF alternator was replaced on 2026-09-24).
--
-- This pass:
--   1. vehicle_harness_landmarks gains is_superseded and polyline_m, a public-read policy like its sibling tables,
--      and loses the table-wide anon/authenticated write grants (RLS with no policy was the only thing stopping them).
--   2. The K5 graph: 29 twin anchors, the 25 twin objects plugs sit on, 9 successors; 32 branches with polylines.
--   3. harness_endpoints.topology_node_id keys each plug to its live point. key_harness_endpoints_to_topology(vehicle)
--      reads the anchor or object the loader wrote into pos_source and follows supersession to the live point; the
--      loader calls it after every run (same PR). Idempotent; service role.
--   4. v_harness_segment_geometry measures straight lines between the plugs' live points, not the copied text
--      coordinates, so a refuted anchor stops counting as a position.
--   5. The scoreboard: "segments with both plugs positioned" becomes "segments with both plugs at a standing
--      position"; new: "wire ends at a topology node" and "wire ends at a node not yet placed" (the placement backlog).
-- Routing waits for branches on standing points: today the standing branches join no two plugs.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.resync_harness_segments(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 11 (20261015003000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'harness_endpoints' AND column_name = 'topology_node_id') THEN
    RAISE EXCEPTION 'harness_endpoints.topology_node_id already exists';
  END IF;
END $guard$;

-- 1. Branches carry their standing and their geometry; the table reads like its siblings.
ALTER TABLE public.vehicle_harness_landmarks
  ADD COLUMN is_superseded boolean NOT NULL DEFAULT false,
  ADD COLUMN polyline_m jsonb CHECK (polyline_m IS NULL OR jsonb_typeof(polyline_m) = 'array');
CREATE UNIQUE INDEX vehicle_harness_landmarks_live_key ON public.vehicle_harness_landmarks (vehicle_id, landmark_code) WHERE NOT is_superseded;
CREATE POLICY "Public read for public vehicles" ON public.vehicle_harness_landmarks FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_harness_landmarks.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
REVOKE ALL ON public.vehicle_harness_landmarks FROM anon, authenticated;
GRANT SELECT ON public.vehicle_harness_landmarks TO anon, authenticated;
GRANT ALL ON public.vehicle_harness_landmarks TO service_role;
COMMENT ON COLUMN public.vehicle_harness_landmarks.is_superseded IS 'True when the branch no longer describes the plan: one of its points fell, or a later derivation replaced it (superseded_by). Kept, never deleted.';
COMMENT ON COLUMN public.vehicle_harness_landmarks.polyline_m IS 'The branch as drawn: [[x,y,z],...] in metres, twin frame (x driver+, y front-, z up). Its length reproduces distance_in.';

ALTER TABLE public.harness_endpoints ADD COLUMN topology_node_id uuid REFERENCES public.harness_topology_nodes(id);
CREATE INDEX harness_endpoints_topology_node ON public.harness_endpoints (topology_node_id) WHERE topology_node_id IS NOT NULL;
COMMENT ON COLUMN public.harness_endpoints.topology_node_id IS 'The live point on the vehicle''s route graph where this plug sits. Written by key_harness_endpoints_to_topology; the plug''s position is that point''s position, not the copied pos_x_m/pos_y_m/pos_z_m.';

-- 2. The K5 graph. Successors first, then the twin rows that point at them, so every write is an insert.
CREATE TEMP TABLE pass12_nodes (code text, kind text, x numeric, y numeric, z numeric, pos_source text, source text,
  method text, observed_at timestamptz, trust text, superseded_by_code text) ON COMMIT DROP;
INSERT INTO pass12_nodes
SELECT code, kind, NULL, NULL, NULL, pos_source, 'docs/wiring/K5_WIRING_STATE.md ' || src, 'placement decision record', obs::timestamptz, trust, NULL
FROM (VALUES
  ('M130', 'device', 'not placed: follows the 61-pin to the driver side; the spot is open', 'row 0ah; receipts/2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md; calc-data/catalog/mounts.yaml M130 (open)', '2026-09-29', 'open'),
  ('PDM30', 'device', 'not placed: follows the 61-pin to the driver side; the spot is open', 'row 0ah; receipts/2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md; calc-data/catalog/mounts.yaml PDM30 (open)', '2026-09-29', 'open'),
  ('DEL_STRIBUTOR', 'device', 'not placed in the twin: all eight coils on the DEL-Stributor central mount, rear centre behind the intake', 'row 0ag (h) and (i); Delmo order 2025-11-03', '2026-09-29', 'owner_decision'),
  ('CKP', 'device', 'not placed in the twin: the Gen IV 58x crank sensor is in the block above the starter, right rear', 'row 0ag (f)', '2026-09-29', 'model'),
  ('BAT', 'device', 'not placed: the passenger firewall corner, the owner''s working position; it conflicts with the retained A/C box; no tray installed', 'section 4 (2026-06-10); row 0ag (d)', '2026-06-10', 'open'),
  ('ALT', 'device', 'not placed: the Holley Mid-Mount (non-A/C) drive is installed; the alternator''s side follows it and is not modelled', 'section 4 (superseded 2026-09-24 by the owner)', '2026-09-24', 'owner_decision'),
  ('O2_L', 'device', 'not placed: the LTCD sensors sit at least 1 m downstream of the ports, under the cab; the exhaust is not built', 'row 0ag (4); calc-data/catalog/mounts.yaml LTCD; LTC manual pp. 4-5', '2026-09-29', 'proposed'),
  ('O2_R', 'device', 'not placed: the LTCD sensors sit at least 1 m downstream of the ports, under the cab; the exhaust is not built', 'row 0ag (4); calc-data/catalog/mounts.yaml LTCD; LTC manual pp. 4-5', '2026-09-29', 'proposed')
) s(code, kind, pos_source, src, obs, trust);
INSERT INTO pass12_nodes VALUES
  ('FIREWALL_61', 'bulkhead', 0.50, -1.46, 0.90,
   'objectTraits.ts FB (the original fuse-block punch-out, driver kick panel, 4 in) lateral and height at the probed firewall plane y = -1.46 m, the method the twin used for H3',
   'docs/wiring/K5_WIRING_STATE.md row 0ah; receipts/2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md; calc-data/catalog/mounts.yaml FIREWALL-61 (decided)',
   'derived from objectTraits.ts at the probed firewall plane', '2026-09-29', 'owner_decision', NULL);
-- The twin anchors (k5LandmarkPaths.ts DEFAULT_POSITIONS, the 2026-06-09 Blender derivation) and the twin objects the
-- loader puts plugs on (calc-data/twin_centers.json, bounding-box centres dumped 2026-09-28; same frame).
INSERT INTO pass12_nodes
SELECT code, kind, x, y, z, 'digital-twin anchor ' || code || ': ' || note || ' (k5LandmarkPaths.ts DEFAULT_POSITIONS)',
  'docs/wiring/output/K5_landmarks_blender_derived.yaml; nuke_frontend/src/components/wiring/k5LandmarkPaths.ts',
  'blender_polyline_derived_v2 anchor (K5_harness_workspace_v2.blend)', '2026-06-09', trust, fell
FROM (VALUES
  ('M130', 'device', -0.45, -1.44, 1.05, 'A1 passenger firewall (asserted)', 'asserted', 'M130'),
  ('PDM30', 'device', -0.45, -1.28, 0.82, 'A2 under dash, passenger (asserted)', 'asserted', 'PDM30'),
  ('FWG_MAIN', 'bulkhead', -0.35, -1.46, 0.90, 'A3 firewall hole H3 (A/C + ECU, passenger) at the probed firewall plane', 'derived', 'FIREWALL_61'),
  ('FLOOR_RR', 'grommet', 0.82, -0.30, 0.74, 'A6 driver seat rocker grommet (a choice)', 'asserted', NULL),
  ('BAT', 'device', 0.65, -2.25, 1.05, 'A4 driver-front battery placeholder', 'asserted', 'BAT'),
  ('ALT', 'device', -0.30, -2.06, 1.03, 'alternator stud (twin accessory drive)', 'model', 'ALT'),
  ('STARTER', 'device', -0.30, -1.45, 0.57, 'starter stud', 'model', NULL),
  ('FUEL_TANK', 'device', 0.15, 1.45, 0.62, 'tank sender and pump', 'model', NULL),
  ('TAIL_CLUSTER', 'device', 0.0, 1.78, 0.985, 'Tail_Lights_Main', 'model', NULL),
  ('DASH_CLUSTER', 'device', 0.62, -1.24, 1.05, 'headlight-switch dash region (real dash geometry)', 'model', NULL),
  ('VALLEY', 'breakout', 0.0, -1.655, 1.31, 'intake valley junction', 'model', NULL),
  ('COIL1', 'device', 0.065, -1.825, 1.31, 'cyl 1 coil, coils pitched along the banks', 'model', 'DEL_STRIBUTOR'),
  ('COIL2', 'device', -0.065, -1.825, 1.31, 'cyl 2 coil, coils pitched along the banks', 'model', 'DEL_STRIBUTOR'),
  ('THROTTLE_BODY', 'device', 0.0, -1.95, 0.984, '90 mm DBW throttle body', 'model', NULL),
  ('MAP_SENSOR', 'device', 0.0, -1.455, 1.28, 'MAP sensor port', 'model', NULL),
  ('REAR_JCT', 'breakout', 0.40, 0.81, 0.66, 'rear axle junction, driver C-channel', 'model', NULL),
  ('CKP', 'device', -0.12, -2.00, 0.65, 'crank sensor at the front timing cover', 'model', 'CKP'),
  ('CMP', 'device', 0.0, -1.97, 0.87, 'cam sensor at the front cover', 'model', NULL),
  ('KS1', 'device', 0.27, -1.655, 0.77, 'knock sensor, driver block', 'model', NULL),
  ('KS2', 'device', -0.27, -1.655, 0.77, 'knock sensor, passenger block', 'model', NULL),
  ('STEER_COL', 'device', 0.50, -1.20, 0.95, 'steering column (real Steering_Main)', 'model', NULL),
  ('BRAKE_SW', 'device', 0.42, -1.30, 0.70, 'brake pedal switch', 'model', NULL),
  ('DOOR_BOOT_L', 'grommet', 0.92, -1.13, 1.00, 'driver door boot (real hinge line)', 'model', NULL),
  ('DOOR_BOOT_R', 'grommet', -0.92, -1.13, 1.00, 'passenger door boot (real hinge line)', 'model', NULL),
  ('DOOR_IN_L', 'device', 0.97, -0.65, 0.95, 'in-door devices, driver', 'model', NULL),
  ('DOME', 'device', 0.0, 0.20, 1.88, 'dome light, headliner cavity', 'model', NULL),
  ('TUNNEL_6L90', 'grommet', 0.17, -0.95, 0.62, 'transmission switches via the tunnel grommet (TUNNEL_6L80E in the 2026-06-09 file)', 'model', NULL),
  ('O2_L', 'device', 0.36, -1.00, 0.53, 'driver exhaust O2 bung', 'model', 'O2_L'),
  ('O2_R', 'device', -0.36, -1.00, 0.53, 'passenger exhaust O2 bung', 'model', 'O2_R')
) a(code, kind, x, y, z, note, trust, fell);
INSERT INTO pass12_nodes
SELECT code, 'device', x, y, z, 'digital-twin object ' || code || ' centre (K5_harness_workspace_v2.blend, twin_centers.json)',
  'docs/wiring/calc-data/twin_centers.json', 'twin object bounding-box centre (dump 2026-09-28)', '2026-09-28', 'model', fell
FROM (VALUES
  ('K5H_CLT', 0.2, -1.91, 1.07, NULL), ('K5H_IAT', 0.1, -2.16, 1.05, NULL), ('K5H_OilPress', 0.0, -1.4, 1.09, NULL),
  ('K5H_OilTemp', 0.0, -1.655, 0.47, NULL), ('K5H_FuelPress', 0.18, -1.86, 1.25, NULL), ('K5H_Alternator', -0.3, -2.06, 1.03, 'ALT'),
  ('K5H_Starter', -0.3, -1.45, 0.57, NULL), ('K5H_Battery', 0.65, -2.25, 0.95, 'BAT'), ('K5H_RadFan_1', 0.19, -2.34, 0.95, NULL),
  ('K5H_AC_Compressor', 0.3, -2.06, 0.85, NULL), ('K5H_iBooster', 0.4, -1.52, 1.05, NULL), ('K5H_VSS', 0.0, -0.661, 0.55, NULL),
  ('K5H_EStopp_Actuator', 0.3, 0.95, 0.62, NULL), ('K5H_Subwoofer', 0.55, 1.45, 0.95, NULL), ('K5H_Amplifier', -0.55, 1.45, 0.85, NULL),
  ('K5H_TransferCase', 0.05, -0.491, 0.62, NULL), ('K5H_6L80E', 0.0, -0.956, 0.67, NULL),
  ('K5H_Injector_1', 0.155, -1.86, 1.17, NULL), ('K5H_Injector_2', -0.155, -1.86, 1.17, NULL),
  ('K5H_Injector_3', 0.155, -1.748, 1.17, NULL), ('K5H_Injector_4', -0.155, -1.748, 1.17, NULL),
  ('K5H_Injector_5', 0.155, -1.636, 1.17, NULL), ('K5H_Injector_6', -0.155, -1.636, 1.17, NULL),
  ('K5H_Injector_7', 0.155, -1.525, 1.17, NULL), ('K5H_Injector_8', -0.155, -1.525, 1.17, NULL)
) o(code, x, y, z, fell);

INSERT INTO public.harness_topology_nodes (vehicle_id, node_code, kind, pos_x_m, pos_y_m, pos_z_m, pos_source, source, method, observed_at, trust)
SELECT v.id, n.code, n.kind, n.x, n.y, n.z, n.pos_source, n.source, n.method, n.observed_at, n.trust
FROM pass12_nodes n JOIN public.vehicles v ON v.id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
WHERE n.superseded_by_code IS NULL;
INSERT INTO public.harness_topology_nodes (vehicle_id, node_code, kind, pos_x_m, pos_y_m, pos_z_m, pos_source, source, method, observed_at, trust, is_superseded, superseded_by)
SELECT s.vehicle_id, n.code, n.kind, n.x, n.y, n.z, n.pos_source, n.source, n.method, n.observed_at, n.trust, true, s.id
FROM pass12_nodes n JOIN public.harness_topology_nodes s
  ON s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND s.node_code = n.superseded_by_code AND NOT s.is_superseded
WHERE n.superseded_by_code IS NOT NULL;

-- Branch lengths from the YAML, polylines from k5LandmarkPaths.ts LANDMARK_WAYPOINTS resolved at DEFAULT_POSITIONS.
CREATE TEMP TABLE pass12_branches (code text, from_code text, to_code text, distance_in numeric, description text,
  assumptions text, polyline jsonb) ON COMMIT DROP;
INSERT INTO pass12_branches VALUES
  ('L01', 'M130', 'FWG_MAIN', 7.2, 'M130 to FWG-MAIN (H3)', 'A1, A3', '[[-0.45,-1.44,1.05],[-0.4,-1.46,0.98],[-0.35,-1.46,0.9]]'),
  ('L02', 'FWG_MAIN', 'VALLEY', 24.7, 'FWG-MAIN to the intake valley junction', 'A3, A5', '[[-0.35,-1.46,0.9],[-0.3,-1.55,1.1],[-0.15,-1.6,1.28],[0.0,-1.655,1.31]]'),
  ('L03', 'VALLEY', 'COIL1', 7.2, 'valley junction to the cyl 1 coil', NULL, '[[0.0,-1.655,1.31],[0.065,-1.825,1.31]]'),
  ('L04', 'COIL1', NULL, 4.3, 'coil-to-coil pitch, driver row (used n times for n pitches)', NULL, '[[0.065,-1.825,1.31],[0.065,-1.715,1.31]]'),
  ('L05', 'VALLEY', 'COIL2', 7.2, 'valley junction to the cyl 2 coil', NULL, '[[0.0,-1.655,1.31],[-0.065,-1.825,1.31]]'),
  ('L06', 'COIL2', NULL, 4.3, 'coil-to-coil pitch, passenger row (used n times for n pitches)', NULL, '[[-0.065,-1.825,1.31],[-0.065,-1.715,1.31]]'),
  ('L07', 'COIL1', NULL, 7.1, 'coil bracket to the injector at the same cylinder', NULL, '[[0.065,-1.825,1.31],[0.155,-1.85,1.22],[0.155,-1.86,1.17]]'),
  ('L08', 'VALLEY', 'THROTTLE_BODY', 17.5, 'valley junction to the throttle body (90 mm DBW)', NULL, '[[0.0,-1.655,1.31],[0.0,-1.8,1.1],[0.0,-1.95,0.984]]'),
  ('L09', 'VALLEY', 'MAP_SENSOR', 8.0, 'valley junction to the MAP sensor port', NULL, '[[0.0,-1.655,1.31],[0.0,-1.455,1.28]]'),
  ('L10', 'M130', 'CKP', 32.5, 'M130 B-connector to the CKP at the front timing cover', 'A1, A5', '[[-0.45,-1.44,1.05],[-0.45,-1.55,0.9],[-0.3,-1.9,0.72],[-0.12,-2.0,0.65]]'),
  ('L11', 'M130', 'CMP', 30.1, 'M130 B-connector to the CMP at the front cover', 'A1, A5', '[[-0.45,-1.44,1.05],[-0.35,-1.6,1.05],[-0.2,-1.9,0.95],[0.0,-1.97,0.87]]'),
  ('L12', 'M130', 'KS1', 44.2, 'M130 B-connector to knock sensor 1, driver block, around the engine rear', NULL, '[[-0.45,-1.44,1.05],[-0.4,-1.4,0.8],[-0.2,-1.36,0.7],[0.2,-1.45,0.7],[0.27,-1.655,0.77]]'),
  ('L13', 'M130', 'KS2', 21.5, 'M130 B-connector to knock sensor 2, passenger block', NULL, '[[-0.45,-1.44,1.05],[-0.4,-1.4,0.8],[-0.27,-1.655,0.77]]'),
  ('L14', 'BAT', 'ALT', 61.6, 'battery positive to the alternator stud, driver-front battery placeholder', 'A4', '[[0.65,-2.25,1.05],[0.55,-2.4,1.05],[0.3,-2.48,1.08],[-0.3,-2.48,1.08],[-0.45,-2.3,1.05],[-0.3,-2.06,1.03]]'),
  ('L15', 'BAT', 'STARTER', 68.7, 'battery positive to the starter stud, driver-front battery placeholder', 'A4', '[[0.65,-2.25,1.05],[0.45,-2.1,0.7],[0.4,-1.7,0.62],[0.4,-1.5,0.6],[-0.1,-1.46,0.57],[-0.3,-1.45,0.57]]'),
  ('L16', 'PDM30', 'FWG_MAIN', 8.7, 'PDM30 to FWG-MAIN, interior side', 'A2, A3', '[[-0.45,-1.28,0.82],[-0.4,-1.36,0.86],[-0.35,-1.46,0.9]]'),
  ('L17', 'PDM30', 'STEER_COL', 38.5, 'PDM30 to the steering column', 'A2', '[[-0.45,-1.28,0.82],[0.0,-1.26,0.8],[0.35,-1.22,0.88],[0.5,-1.2,0.95]]'),
  ('L18', 'PDM30', 'DASH_CLUSTER', 43.4, 'PDM30 to the headlight switch (real dash position)', 'A2', '[[-0.45,-1.28,0.82],[0.0,-1.26,0.85],[0.62,-1.24,1.05]]'),
  ('L19', 'PDM30', 'BRAKE_SW', 34.7, 'PDM30 to the brake pedal switch', 'A2', '[[-0.45,-1.28,0.82],[0.0,-1.26,0.78],[0.3,-1.28,0.72],[0.42,-1.3,0.7]]'),
  ('L20', 'PDM30', 'DOOR_BOOT_L', 55.2, 'PDM30 to the driver door boot (real hinge line)', 'A2', '[[-0.45,-1.28,0.82],[0.0,-1.26,0.8],[0.55,-1.2,0.9],[0.92,-1.13,1.0]]'),
  ('L21', 'DOOR_BOOT_L', 'DOOR_IN_L', 19.2, 'driver door boot to the in-door devices (real door cavity)', NULL, '[[0.92,-1.13,1.0],[0.95,-0.9,0.95],[0.97,-0.65,0.95]]'),
  ('L22', 'PDM30', 'DOOR_BOOT_R', 20.7, 'PDM30 to the passenger door boot', 'A2', '[[-0.45,-1.28,0.82],[-0.7,-1.2,0.9],[-0.92,-1.13,1.0]]'),
  ('L23', 'PDM30', 'DOME', 153.5, 'PDM30 to the dome light (A-pillar, headliner cavity)', 'A2', '[[-0.45,-1.28,0.82],[0.2,-1.26,0.85],[0.8,-1.22,1.25],[0.78,-1.05,1.8],[0.0,-0.95,1.93],[0.0,0.0,1.9],[0.0,0.2,1.88]]'),
  ('L24', 'PDM30', 'FLOOR_RR', 76.8, 'PDM30 to the FLOOR-RR grommet', 'A2, A6', '[[-0.45,-1.28,0.82],[0.0,-1.24,0.76],[0.75,-1.0,0.76],[0.82,-0.6,0.75],[0.82,-0.3,0.74]]'),
  ('L25', 'FLOOR_RR', 'REAR_JCT', 54.1, 'FLOOR-RR to the rear axle junction, inside the driver C-channel', 'A6', '[[0.82,-0.3,0.74],[0.5,-0.2,0.62],[0.42,0.4,0.62],[0.4,0.81,0.66]]'),
  ('L26', 'REAR_JCT', 'TAIL_CLUSTER', 50.3, 'rear junction to the tailgate cluster (real Tail_Lights_Main)', NULL, '[[0.4,0.81,0.66],[0.4,1.4,0.62],[0.2,1.7,0.8],[0.0,1.78,0.985]]'),
  ('L27', 'REAR_JCT', 'FUEL_TANK', 27.5, 'rear junction to the fuel tank sender and pump', NULL, '[[0.4,0.81,0.66],[0.3,1.2,0.6],[0.15,1.45,0.62]]'),
  ('L28', 'PDM30', 'TUNNEL_6L90', 35.6, 'PDM30 to the transmission switches via the tunnel grommet', 'A2', '[[-0.45,-1.28,0.82],[0.0,-1.24,0.78],[0.15,-1.05,0.8],[0.17,-1.0,0.7],[0.17,-0.95,0.62]]'),
  ('L29', 'M130', 'O2_L', 52.8, 'M130 to the driver exhaust O2 bung', 'A1', '[[-0.45,-1.44,1.05],[-0.42,-1.4,0.62],[0.1,-1.25,0.55],[0.36,-1.0,0.53]]'),
  ('L30', 'M130', 'O2_R', 33.4, 'M130 to the passenger exhaust O2 bung', 'A1', '[[-0.45,-1.44,1.05],[-0.42,-1.4,0.62],[-0.36,-1.0,0.53]]');

-- The 2026-06-10 re-derivations for a passenger-corner battery (receipts/2026-06-10_battery-corner-rederivation.md;
-- its waypoints are not in the repo). L14 ran to the CVF low-driver alternator, which the Holley Mid-Mount replaced on
-- 2026-09-24, so it falls; L15 stands, from a battery point that has no coordinates yet.
INSERT INTO public.vehicle_harness_landmarks (vehicle_id, landmark_code, description, distance_in, method, derived_on, derived_by,
  source_file, assumptions, notes, from_node_id, to_node_id, is_superseded)
SELECT v.id, b.code, b.description, b.distance_in, 'analytic_polyline_derived', '2026-06-10', 'K5 wiring session 2026-06-10',
  'docs/wiring/output/K5_landmarks_blender_derived.yaml; docs/wiring/receipts/2026-06-10_battery-corner-rederivation.md', 'A4 updated',
  b.notes, bat.id, b.to_id, b.code = 'L14'
FROM (VALUES
  ('L14', 'battery positive (passenger firewall corner) to the CVF alternator, low driver side, across the core support', 89.4,
   'The CVF drive was replaced by the Holley Mid-Mount on 2026-09-24 (state section 4); the alternator is not placed.', NULL::uuid),
  ('L15', 'battery positive (passenger firewall corner) to the starter stud, a short fender drop', 24.3,
   'The battery point has no coordinates yet (owner working position, state section 4).',
   (SELECT id FROM public.harness_topology_nodes WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND node_code = 'STARTER' AND NOT is_superseded))
) b(code, description, distance_in, notes, to_id)
JOIN public.vehicles v ON v.id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
JOIN public.harness_topology_nodes bat ON bat.vehicle_id = v.id AND bat.node_code = 'BAT' AND NOT bat.is_superseded;

-- The 2026-06-09 branches, each on the points it was drawn between. A branch on a fallen point falls with it.
INSERT INTO public.vehicle_harness_landmarks (vehicle_id, landmark_code, description, distance_in, method, derived_on, derived_by,
  source_file, assumptions, notes, from_node_id, to_node_id, polyline_m, is_superseded, superseded_by)
SELECT v.id, b.code, b.description, b.distance_in, 'blender_polyline_derived_v2', '2026-06-09', 'claude-fable-5 session 2026-06-09',
  'docs/wiring/output/K5_landmarks_blender_derived.yaml; nuke_frontend/src/components/wiring/k5LandmarkPaths.ts', b.assumptions,
  CASE WHEN fn.is_superseded OR tn.is_superseded
       THEN 'Drawn from ' || coalesce(fn.node_code, 'a fixed point') || ' to ' || coalesce(tn.node_code, 'a fixed point') || '; '
            || concat_ws(' and ', CASE WHEN fn.is_superseded THEN fn.node_code END, CASE WHEN tn.is_superseded THEN tn.node_code END)
            || ' fell (see the point''s successor).'
       WHEN b.code IN ('L14', 'L15') THEN 'Replaced by the 2026-06-10 passenger-corner derivation.' END,
  fn.id, tn.id, b.polyline,
  fn.is_superseded OR coalesce(tn.is_superseded, false) OR b.code IN ('L14', 'L15'),
  CASE WHEN b.code IN ('L14', 'L15') THEN (SELECT id FROM public.vehicle_harness_landmarks r WHERE r.vehicle_id = v.id AND r.landmark_code = b.code AND r.method = 'analytic_polyline_derived') END
FROM pass12_branches b
JOIN public.vehicles v ON v.id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
JOIN public.harness_topology_nodes fn ON fn.vehicle_id = v.id AND fn.node_code = b.from_code AND fn.method LIKE 'blender_polyline_derived_v2%'
LEFT JOIN public.harness_topology_nodes tn ON tn.vehicle_id = v.id AND tn.node_code = b.to_code AND tn.method LIKE 'blender_polyline_derived_v2%';

-- 3. Plugs keyed to their live point.
CREATE FUNCTION public.key_harness_endpoints_to_topology(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE changed int; keyed int; unkeyed int;
BEGIN
  WITH RECURSIVE eps AS (
    SELECT e.id, coalesce(substring(e.pos_source FROM '^digital-twin (?:anchor|object) ([A-Za-z0-9_]+)'), cur.node_code) AS code
    FROM public.harness_endpoints e
    LEFT JOIN public.harness_topology_nodes cur ON cur.id = e.topology_node_id
    WHERE NOT coalesce(e.is_superseded, false)
      AND EXISTS (SELECT 1 FROM public.wire_termination_specs t
                  WHERE t.endpoint_id = e.id AND t.vehicle_id = p_vehicle_id AND NOT coalesce(t.is_superseded, false))),
  chain(code, node_id, is_sup, next_id, depth) AS (
    SELECT n.node_code, n.id, n.is_superseded, n.superseded_by, 0
    FROM public.harness_topology_nodes n
    WHERE n.vehicle_id = p_vehicle_id AND n.node_code IN (SELECT code FROM eps)
    UNION ALL
    SELECT ch.code, n.id, n.is_superseded, n.superseded_by, ch.depth + 1
    FROM chain ch JOIN public.harness_topology_nodes n ON n.id = ch.next_id
    WHERE ch.is_sup AND ch.depth < 20),
  target AS (SELECT DISTINCT ON (code) code, node_id FROM chain WHERE NOT is_sup ORDER BY code, depth, node_id)
  UPDATE public.harness_endpoints e SET topology_node_id = t.node_id
  FROM eps JOIN target t ON t.code = eps.code
  WHERE e.id = eps.id AND e.topology_node_id IS DISTINCT FROM t.node_id;
  GET DIAGNOSTICS changed = ROW_COUNT;

  SELECT count(*) FILTER (WHERE n.id IS NOT NULL), count(*) FILTER (WHERE n.id IS NULL AND e.pos_x_m IS NOT NULL)
    INTO keyed, unkeyed
  FROM public.harness_endpoints e
  LEFT JOIN public.harness_topology_nodes n ON n.id = e.topology_node_id AND NOT n.is_superseded
  WHERE NOT coalesce(e.is_superseded, false)
    AND EXISTS (SELECT 1 FROM public.wire_termination_specs t
                WHERE t.endpoint_id = e.id AND t.vehicle_id = p_vehicle_id AND NOT coalesce(t.is_superseded, false));
  RETURN jsonb_build_object('plugs_rekeyed', changed, 'plugs_at_a_live_point', keyed, 'positioned_plugs_with_no_point', unkeyed);
END $fn$;
COMMENT ON FUNCTION public.key_harness_endpoints_to_topology(uuid) IS 'Keys each live plug on the vehicle''s wires to its live point on the route graph: the twin anchor or object named in pos_source (or the plug''s current point), following superseded_by to the point that stands. Idempotent; returns counts. The registry loader calls it after every run. RSI pass 12, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.key_harness_endpoints_to_topology(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_harness_endpoints_to_topology(uuid) TO service_role;

-- 4. Straight lines between live points.
CREATE OR REPLACE VIEW public.v_harness_segment_geometry AS
SELECT s.id AS segment_id, s.vehicle_id, s.net_id, c.circuit_code, ef.code AS from_plug, et.code AS to_plug,
  round(sqrt(power(nf.pos_x_m - nt.pos_x_m, 2) + power(nf.pos_y_m - nt.pos_y_m, 2) + power(nf.pos_z_m - nt.pos_z_m, 2)) * 3.28084, 2) AS straight_ft,
  s.planned_length_ft AS planned_ft, s.planned_length_method,
  nf.pos_source AS from_pos_source, nt.pos_source AS to_pos_source,
  nf.node_code AS from_point, nt.node_code AS to_point
FROM public.harness_segments s
JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public IS TRUE
LEFT JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
LEFT JOIN public.wire_termination_specs tf ON tf.id = s.from_termination_id
LEFT JOIN public.harness_endpoints ef ON ef.id = tf.endpoint_id
LEFT JOIN public.harness_topology_nodes nf ON nf.id = ef.topology_node_id AND NOT nf.is_superseded
LEFT JOIN public.wire_termination_specs tt ON tt.id = s.to_termination_id
LEFT JOIN public.harness_endpoints et ON et.id = tt.endpoint_id
LEFT JOIN public.harness_topology_nodes nt ON nt.id = et.topology_node_id AND NOT nt.is_superseded
WHERE NOT s.is_superseded;
COMMENT ON VIEW public.v_harness_segment_geometry IS 'Per live segment of a public vehicle: the straight line between the live route-graph points of its two plugs (feet), beside its planned length. A plug on a fallen or unplaced point has no straight line. RSI passes 7 and 12, case ledger 13.12.3.';

-- 5. The scoreboard.
CREATE OR REPLACE VIEW public.v_harness_coverage AS
SELECT x.vehicle_id, x.layer, x.measure, x.numerator, x.denominator, g.grain
FROM (
  WITH seg AS (SELECT s.* FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
               WHERE NOT s.is_superseded AND v.is_public IS TRUE),
  ends AS (SELECT t.* FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id
           WHERE NOT coalesce(t.is_superseded, false) AND v.is_public IS TRUE
             AND EXISTS (SELECT 1 FROM seg WHERE t.id IN (seg.from_termination_id, seg.to_termination_id))),
  nets AS (SELECT n.* FROM public.harness_nets n JOIN public.vehicles v ON v.id = n.vehicle_id
           WHERE NOT n.is_superseded AND v.is_public IS TRUE),
  base AS (SELECT o.vehicle_id, f.* FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
           JOIN public.factory_harness_circuits f ON f.generation = o.factory_generation AND f.year_range @> v.year
           WHERE v.is_public IS TRUE),
  res AS (SELECT * FROM public.v_harness_factory_residual),
  wires AS (SELECT c.id, o.vehicle_id FROM public.vehicle_custom_circuits c
            JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id JOIN public.vehicles v ON v.id = o.vehicle_id
            WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided' AND v.is_public IS TRUE),
  endpts AS (SELECT t.vehicle_id, t.id, n.id AS node_id, n.pos_x_m FROM ends t
             LEFT JOIN public.harness_endpoints e ON e.id = t.endpoint_id
             LEFT JOIN public.harness_topology_nodes n ON n.id = e.topology_node_id AND NOT n.is_superseded)
  SELECT vehicle_id, 'fold' AS layer, 'segments decided' AS measure, count(*) FILTER (WHERE design_status = 'decided') AS numerator, count(*) AS denominator FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'segments with both ends known', count(*) FILTER (WHERE from_termination_id IS NOT NULL AND to_termination_id IS NOT NULL), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'segments keyed to a wire part', count(wire_part_id), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'prediction', 'segments with a planned length', count(planned_length_ft), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'outcome', 'segments measured as cut', count(measured_length_ft), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'key', 'segments carrying an option link', count(DISTINCT l.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.wiring_decision_links l ON l.segment_id = s.id GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'dimension', 'segments routed over topology', count(DISTINCT r.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.harness_routings r ON r.segment_id = s.id AND NOT r.is_superseded GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a cavity', count(cavity_layout_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a terminal part', count(terminal_contact_catalog_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a crimp tool', count(crimp_tool_catalog_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT e.vehicle_id, 'log', 'wire ends with cited evidence', count(DISTINCT h.row_id) FILTER (WHERE h.relation = 'supports'), count(DISTINCT e.id) FROM ends e LEFT JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id = e.id GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'nets with protection', count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL OR protection_fuse_part_id IS NOT NULL), count(*) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'nets with a load model', count(nominal_current_a), count(*) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'baseline', 'factory circuits keyed to a GM circuit number', count(gm_circuit_number), count(*) FROM base GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'factory GM circuits carried by the build', count(*) FILTER (WHERE status = 'carried'), count(*) FILTER (WHERE status <> 'baseline gap') FROM res GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'GM circuits the build cites that the baseline cannot key', count(*) FILTER (WHERE status = 'baseline gap'), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
  UNION ALL SELECT n.vehicle_id, 'residual', 'nets carrying a factory circuit', count(DISTINCT n.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id IN (s.from_termination_id, s.to_termination_id)
             JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
             WHERE s.net_id = n.id AND NOT s.is_superseded AND o.structured_data->>'property_key' = 'factory circuit')), count(DISTINCT n.id) FROM nets n GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'GM circuits the build cites, named in the circuit dictionary', count(*) FILTER (WHERE status <> 'unassessed' AND gm_circuit_name IS NOT NULL), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
  UNION ALL SELECT n.vehicle_id, 'fold', 'nets that join a supply to ground (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
             JOIN public.harness_endpoints e ON e.id = t.endpoint_id
             WHERE s.net_id = n.id AND NOT s.is_superseded
               AND (t.cavity ILIKE '+ post%' OR (e.code ~ '^PDM(15|30)-[AB]$' AND EXISTS (
                     SELECT 1 FROM public.device_pin_maps p WHERE p.device_model = split_part(e.code, '-', 1)
                       AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
                       AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL))))
           AND EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
             WHERE s.net_id = n.id AND NOT s.is_superseded AND t.cavity ILIKE '- post%')), count(*) FROM nets n GROUP BY 1
  UNION ALL SELECT g.vehicle_id, 'dimension', 'segments with both plugs at a standing position', count(*) FILTER (WHERE g.straight_ft IS NOT NULL), count(*) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT g.vehicle_id, 'prediction', 'segments planned shorter than the straight line between their plugs (must be 0)', count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft IS NOT NULL AND g.straight_ft IS NOT NULL) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT w.vehicle_id, 'outcome', 'decided wires with a recorded build step', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.harness_build_events e WHERE e.circuit_id = w.id)), count(*) FROM wires w GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'fold', 'live segments on superseded legacy rows (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.vehicle_custom_circuits c WHERE c.id = s.vehicle_custom_circuit_id AND coalesce(c.is_superseded, false))
           OR EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.id IN (s.from_termination_id, s.to_termination_id) AND coalesce(t.is_superseded, false))),
         count(*) FROM seg s GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'wire ends at a topology node', count(node_id), count(*) FROM endpts GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'wire ends at a node not yet placed', count(*) FILTER (WHERE node_id IS NOT NULL AND pos_x_m IS NULL), count(*) FROM endpts GROUP BY 1
) x
LEFT JOIN (VALUES
    ('segments decided', 'segments'),
    ('segments with both ends known', 'segments'),
    ('segments keyed to a wire part', 'segments'),
    ('segments with a planned length', 'segments'),
    ('segments measured as cut', 'segments'),
    ('segments carrying an option link', 'segments'),
    ('segments routed over topology', 'segments'),
    ('wire ends keyed to a cavity', 'wire ends'),
    ('wire ends keyed to a terminal part', 'wire ends'),
    ('wire ends keyed to a crimp tool', 'wire ends'),
    ('wire ends with cited evidence', 'wire ends'),
    ('nets with protection', 'nets'),
    ('nets with a load model', 'nets'),
    ('factory circuits keyed to a GM circuit number', 'factory circuits'),
    ('factory GM circuits carried by the build', 'GM circuits'),
    ('GM circuits the build cites that the baseline cannot key', 'GM circuits'),
    ('nets carrying a factory circuit', 'nets'),
    ('GM circuits the build cites, named in the circuit dictionary', 'GM circuits'),
    ('nets that join a supply to ground (must be 0)', 'nets'),
    ('segments with both plugs at a standing position', 'segments'),
    ('segments planned shorter than the straight line between their plugs (must be 0)', 'segments'),
    ('decided wires with a recorded build step', 'wires'),
    ('live segments on superseded legacy rows (must be 0)', 'segments'),
    ('wire ends at a topology node', 'wire ends'),
    ('wire ends at a node not yet placed', 'wire ends')) g(measure, grain) ON g.measure = x.measure;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'dimension', 'table', 'harness_topology_nodes', NULL, 'the route graph''s points, each with its standing'),
  ('SH', 1, 'dimension', 'table', 'vehicle_harness_landmarks', NULL, 'the branches between the points, with their polylines'),
  ('SH', 1, 'key', 'column', 'harness_endpoints.topology_node_id', NULL, 'each plug keyed to its live point'),
  ('SH', 1, 'key', 'function', 'key_harness_endpoints_to_topology', NULL, 'plugs re-keyed after every loader run');

DO $check$
DECLARE r jsonb; bad text; n_live int; n_fell int; b_live int; b_fell int;
BEGIN
  SELECT string_agg(landmark_code, ', ') INTO bad
  FROM (SELECT l.landmark_code, l.distance_in,
               (SELECT sum(sqrt(power((p2->>0)::numeric - (p1->>0)::numeric, 2) + power((p2->>1)::numeric - (p1->>1)::numeric, 2)
                                + power((p2->>2)::numeric - (p1->>2)::numeric, 2)))
                FROM generate_series(0, jsonb_array_length(l.polyline_m) - 2) i,
                     LATERAL (SELECT l.polyline_m -> i AS p1, l.polyline_m -> (i + 1) AS p2) q) / 0.0254 AS poly_in
        FROM public.vehicle_harness_landmarks l WHERE l.polyline_m IS NOT NULL) x
  WHERE abs(poly_in - distance_in) > 0.06;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'branches whose polyline does not reproduce their length: %', bad; END IF;

  r := public.key_harness_endpoints_to_topology('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  SELECT count(*) FILTER (WHERE NOT is_superseded), count(*) FILTER (WHERE is_superseded) INTO n_live, n_fell
  FROM public.harness_topology_nodes WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  SELECT count(*) FILTER (WHERE NOT is_superseded), count(*) FILTER (WHERE is_superseded) INTO b_live, b_fell
  FROM public.vehicle_harness_landmarks WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  RAISE NOTICE 'RSI pass 12 on the K5: points % live, % fallen; branches % standing, % fallen; plugs %', n_live, n_fell, b_live, b_fell, r;
END $check$;

COMMIT;

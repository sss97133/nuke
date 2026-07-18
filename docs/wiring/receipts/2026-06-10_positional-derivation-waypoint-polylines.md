# Receipt — Positional derivation: exact Blender waypoint polylines + gauge/power-spine reflow flags

**Date:** 2026-06-10 · **Change type:** tooling/frontend (engine, data reconstruction) · **Amends:** the positional stub landed earlier this session inside the PlanView2D pass (ratio-reflow, estimated anchors)

## What

`harnessDerivation.ts` + `k5LandmarkPaths.ts` gain the full positional input contract:

- `ComponentPositions` (`{[nodeId]: {x,y,z}}` meters, digital-twin frame: x driver+, y front−, z up+) on `DerivationInput.positions`. When provided, landmark lengths are recomputed from waypoint polylines anchored to moved nodes; everything downstream (lengthFt, gauge via Vdrop, cost, bundle OD) reflows.
- `DEFAULT_POSITIONS` — node anchors now carry the EXACT model coords from the Blender derivation session (previously plan-view estimates), including FWG-MAIN H3 re-anchor (−0.35, −1.46, 0.90) and Gen IV CKP front cover (−0.12, −2.00, 0.65). New fixed anchors: COIL1/COIL2/THROTTLE_BODY/MAP_SENSOR/DOOR_IN_L.
- `LANDMARK_WAYPOINTS` — upgraded from endpoint node lists to full polyline definitions `{points: (nodeId | [x,y,z])[], method, calibrationIn}` covering **all 30 landmarks** (L03–L09, L21 included). Node refs move with positions; fixed `[x,y,z]` waypoints hold — so the segment-wise rule (only segments touching a moved node change) falls out of the data, replacing the prior whole-path ratio scaling.
- **Method per landmark:** all 30 are `waypoint_exact` — the polylines were recovered verbatim from the 2026-06-09 Blender session that PRODUCED the baked values (no `endpoint_calibrated` entries needed). `calibrationIn` (init-computed: baked − polyline(DEFAULT_POSITIONS)) absorbs the 1-decimal rounding residue, max |0.05"| (L29), so **default positions reproduce today's table EXACTLY**.
- `DerivedWire.gaugeChangedFromSpec` — true iff the Vdrop-audited gauge at the derived length ≠ cut-list gauge (UI highlight hook; `effectiveGauge` carries the value).
- `DerivedWire.powerSpineAffected` + a `POWER SPINE` budget warning — battery (BAT node) moves flag every row routed through L14/L15 (15 rows: #6, #21, #22, #52, #59, #60, #63, #80, #82–#84, #85a/b, #86a/b).
- `landmarksAnchoredTo(nodeId)` helper exported; `computeLandmarksIn()` keeps its name/signature but now delegates to the waypoint engine (`landmarkLengthsIn` in k5LandmarkPaths).

Files: `nuke_frontend/src/components/wiring/k5LandmarkPaths.ts`, `harnessDerivation.ts`, `__tests__/harnessDerivation.parity.test.ts`. PlanView2D/HarnessWorkbench (parallel agent) consume the upgraded shape unchanged.

## Sources cited

- **Waypoint polylines L01–L30:** session transcript `~/.claude/projects/-Users-skylar/13a6bb90-eb0f-4664-83d4-65538249aeae.jsonl` — the `execute_blender_code` block that built the `K5H_LM_*` curves (L-dict, anchors M130/FWG/PDM/BAT/… in model coords), plus the L01/L02/L16 FWG re-anchor block and the L10 Gen IV CKP correction block (`K5_harness_workspace_v2.blend`, saved states).
- **Baked values being calibrated against:** `docs/wiring/output/K5_landmarks_blender_derived.yaml` (blender_polyline_derived_v2, 2026-06-09) = `LANDMARKS_IN`.
- **Length/gauge doctrine unchanged:** `scripts/k5_harness_calc.py` wire_len_ft + gauge_check (service loop 12", shielded +6", door +6", bend 1.05/1.1, 3%@12V, ×1.25, ×2 round trip).
- **Numeric verification of recovery:** all 30 polylines reproduce baked values within 0.05" (computed this session before writing the TS; residue = the original `round(x,1)` in the Blender session).

## Verification (2026-06-10, this session)

- `npx vitest --run src/components/wiring/__tests__/harnessDerivation.parity.test.ts` → **21/21 pass**: the original 16 python-parity tests untouched and green, plus 5 new positional tests:
  1. all 30 landmarks have node-anchored waypoint paths, method documented, |calibration| ≤ 0.06";
  2. `computeLandmarksIn(DEFAULT_POSITIONS)` === `LANDMARKS_IN` exactly;
  3. `deriveHarness({positions: DEFAULT_POSITIONS})` deep-equals the no-positions harness;
  4. battery +1 m (x) changes L14 (+36.6") / L15 (+32.6") ONLY — every non-spine wire row bit-identical, 15 spine rows flagged + longer, PDM/cavities/overflow/direct-feed/budget/dropped all structurally identical;
  5. gauge reflow: 12 A on #21 (12 AWG, L16+L14) passes at default 7.54 ft (vdrop 0.3597 V ≤ 0.36 V) and flips to `gaugeChangedFromSpec`/`effectiveGauge: 10` at 10.9 ft after battery +1 m.
- `npx tsc --noEmit` → **0 errors** project-wide (after PlanView2D landed).

## Unknowns

- (none blocking for this change — it is a faithful data reconstruction + pure-function plumbing; no wiring-table writes, no physical routing decisions)

## Limits (honest)

- The polylines are the twin's PROTOTYPE routing (A1–A6 assumptions baked in; battery side OPEN, A4) — moving a node reroutes the polyline linearly through its surviving fixed waypoints; it does NOT re-route around geometry. A battery side-flip (driver→passenger) gives a first-order length update, not a re-derived path; the `POWER SPINE` warning says exactly that (verify lug-to-lug before cutting battery-class cable).
- `gaugeChangedFromSpec` only fires for wires with known device amps (`devices[].power_draw_amps`), same as the python gauge audit.

# Receipt — Connector Inspector: click-to-swap skins (FACE / TABLE / BUILD / PRINT) on the wiring page

**Date:** 2026-06-11 (filed under the 2026-06-10 directive slug) · **Change type:** tooling/frontend + workflow-state write path (build_state) · **Status:** executed

## Directive (Skylar)
> The connector view on the vehicle profile must be EASY TO READ with click-to-swap presentations — "like old mp3 players on windows" (Winamp skins: one data object, instantly swappable skins).

## What
New CONNECTORS tab (key `7`) on `/vehicle/:vehicleId/wiring`. One derived data object (`deriveHarness()` over the 162-wire registry, same `?wb=`/`?mg=` toggle params as the WORKBENCH tab) projected through four instantly-swappable skins — no refetch, no recompute on swap, state in URL params (`?ci=&skin=&sel=`):

- **FACE** — the connector face LARGE: zoom-to-fit + wheel/pinch zoom + drag pan, function-group colors, spares dimmed, gauge-conflict cavities + overflow wires pulsing amber. Click cavity → right detail card (wire #, circuit, color swatch+code, AWG, spec, length, from-pin, to-destination, subsystem, build_state badge).
- **TABLE** — dense sortable/filterable schedule (the print sheet's columns), free-text filter + function-group chips, 14px floor.
- **BUILD** — ordered checklist grouped by function group; per-row 6-step build_state stepper (uncut → cut → terminated_a → terminated_b → routed → verified); click advances, segment click sets state directly; optimistic UI + error toast; progress header "N OF 61 TERMINATED".
- **PRINT** — export door only: points at `npm run wiring:connector-sheets` and the generated sheet artifacts in `docs/wiring/output/connector-sheets/`.

## Files
New (all `nuke_frontend/src/components/wiring/` unless noted):
- `ConnectorInspector.tsx` — orchestrator: connector picker (FIREWALL 61-way / M130-A / M130-B / PDM30) + skin switcher segmented controls, URL-param state, builds all four connector models from one derivation
- `connector-inspector/types.ts` — `ConnectorModel` / `InspectorCavity` / skin contracts
- `connector-inspector/buildConnectorModels.ts` — pure projection `DerivedHarness` → four `ConnectorModel`s (reuses `D38999_CAV_ORDER`/`D38999_CAV_XY` from `harnessDerivation.ts` and `FILL`/`groupOf`/PDM pin maps re-exported from `ConnectorFaces.tsx`)
- `connector-inspector/useBuildState.ts` — overlay lookup + `build_state` map fetch + optimistic advance/set with persistence
- `connector-inspector/FaceSkin.tsx`, `connector-inspector/TableSkin.tsx`, `connector-inspector/BuildSkin.tsx`, `connector-inspector/PrintSkin.tsx`

Edited (minimal, collision-tolerant — parallel agent owns `HarnessWorkbench.tsx`/`PlanView2D.tsx`/`harnessDerivation.ts`, none touched):
- `ConnectorFaces.tsx` — export surface additions: `FILL`, new `groupOf()` (extracted from `groupFill`), `PDM_A_PIN`, `PDM_B_PIN`, `SUPERSEAL_ROWS_34/26`. One classification fix folded in: `h_bridge` added to the drive branch — the cut-list v4 registry tags ETB TAC motors `signal_type=h_bridge_motor`, which the old check (`half_bridge`) missed, mis-coloring them sensor-blue; the python build sheets color actuator drives red.
- `src/pages/WiringPlan.tsx` — additive tab registration only (one lazy import, one `TABS` entry, one camera-ref key, one render block) + `activeTab` now initializes from `?tab=` (deep-linkable tabs; needed so the proof shot and bookmarks land on CONNECTORS instead of FORMBOARD).

Database:
- `database/migrations/2026-06-11_custom_circuits_build_state_client_write.sql` — scopes the browser write path: revokes blanket `UPDATE` from `anon`/`authenticated`, grants column-level `UPDATE (build_state)` only, adds RLS policy `"Build state workflow write"` FOR UPDATE. The CHECK constraint (migration `2026-06-10_wiring_substrate_v2_step1.sql`) bounds values to the 6 enum states. Every other column stays service-role-only.
- One-time ingest: 162 circuit rows (overlay `eafee5c6-c105-4148-be9c-61cca0bc2377`, vehicle `e08bf694-…`) generated from the frontend registry (`k5LandmarkPaths.ts` `WIRE_REGISTRY`, the cut-list v4 port) with `derivation_version='v4-frontend-registry'`, `build_state='uncut'`, `ON CONFLICT (overlay_id, circuit_code) DO NOTHING`. Idempotent; the planned v4.1 file ingest can supersede by `derivation_version`.

## Why the build_state write from the browser is allowed
`WIRING_SUBSTRATE_V2_SPEC.md` §"The model — Circuit": build_state is "Dave's '28 of 61 pins' as live data" — mutable physical-build workflow state, explicitly NOT testimony. The agent-trust invariants govern testimony tables (`vehicle_observations`, `vehicle_events`, …); `vehicle_custom_circuits.build_state` is working state with a defined lifecycle and a CHECK constraint. The write is keyed on the natural key `(overlay_id, circuit_code)` (unique index `vehicle_custom_circuits_overlay_code_uniq`, created in the v2 step-1 migration precisely for this). Column-level grant means the browser can change nothing else.

## Sources cited
- D38999 25-61 cavity coordinates + order: `harnessDerivation.ts` exports (`D38999_CAV_XY`, `D38999_CAV_ORDER`; MILNEC insert-arrangement p. B-22 transcription, mirror-X engine-side view) — consumed, not duplicated
- Superseal grids 9/8/8/9 + 7/6/6/7, PDM30 pin→function maps: `ConnectorFaces.tsx` (PDM30 datasheet Part 14103 via CONNECTOR_DATA_REPORT 2.5) — re-exported, not duplicated
- Wire rows: `k5LandmarkPaths.ts` `WIRE_REGISTRY` (K5_cut_list_v4.txt port) + subsystem map `k5Subsystems.ts` (subsystems.json)
- build_state lifecycle + natural key: `database/migrations/2026-06-10_wiring_substrate_v2_step1.sql`, `docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md`
- Design system: `.claude/rules/frontend.md` (zero radius/shadow/gradient, 2px borders, Arial/Courier) — with Skylar's readability directive overriding the 8-9px label size: **nothing below 14px, cavity labels exempt to 11px at fit**

## Deviations from the directive (honest)
1. **The directive assumed the connector circuits already existed as DB rows.** Reality: the overlay had only 12 rows (PDM15 + trailer), zero K5 cut-list wires, so `update`-keyed persistence had nothing to hit. Filed the one-time registry ingest above (working-state table, not testimony).
2. **RLS blocked all browser writes** (`Service write` = service_role only; the table-level grants existed but RLS no-ops anon updates silently). Without the migration the BUILD skin would "succeed" optimistically and persist nothing. Scoped column-level write is the minimal fix.
3. The frontend registry is the **v4** port (162 wires); cut list has since moved to **v4.1/v4.2** (168+ wires, ECU lifelines #ECU_PWR/#ECU_GND1/2, #PDM_BPOS/#PDM_GND1/2, APS pedal). The inspector shows what the registry derives. Registry uplift to v4.2 is a separate substrate change (belongs with `harnessDerivation.ts`'s owner — not taken here to avoid the collision).

## Unknowns
- None blocking. Physical routing/termination decisions remain the builder's; this view writes only workflow state he clicks.

## Verification
- `npx tsc --noEmit --skipLibCheck` = 0 errors; `npm run build` clean (own lazy chunk)
- Live check on `/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring` → CONNECTORS: FACE skin with cavity selected, screenshot at `docs/wiring/output/connector_inspector_proof.png`
- build_state round-trip verified: click advance → row persisted in `vehicle_custom_circuits` (checked via SQL), reload shows persisted state

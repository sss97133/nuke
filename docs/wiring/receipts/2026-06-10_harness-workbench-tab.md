# Receipt — HarnessWorkbench: live toggle-driven workbench tab in /vehicle/:vehicleId/wiring

**Date:** 2026-06-10 · **Change type:** tooling/frontend (orchestrated contract: LIVE HARNESS WORKBENCH; pairs with parallel `harnessDerivation.ts` module contract)

## What
New WORKBENCH tab (key `6`) on the existing wiring page — no new route, no new edge function. Toggle subsystems → the whole harness re-derives client-side and every panel re-renders: cut-list rows dim/animate out, D38999/M130/PDM30 connector faces re-fill, PDM channels free up, alternator budget re-ladders. Toggles persist in URL params (`?wb=OFF1,OFF2&mg=1`).

Files (all `nuke_frontend/src/components/wiring/` unless noted):
- `HarnessWorkbench.tsx` — orchestrator: URL-param toggle state, FULL + ACTIVE derivations, 3-column layout
- `SubsystemTogglePanel.tsx` — 18 toggleable + 3 fixed subsystems w/ wire-count + nameplate-amps badges; MECHANICAL_GAUGES alternate
- `LiveCutList.tsx` — sortable (id/circuit/from/color/AWG/ft/subsystem); off-subsystem rows dim at 180ms
- `ConnectorFaces.tsx` — React SVG: D38999 25-61 face (mirrored engine-side view), M130 A/B Superseal 9/8/8/9 + 7/6/6/7, PDM30 A/B; orange overflow + direct-feed blocks
- `PdmLoadingPanel.tsx` — 30 channels, load bars vs 20A/8A ratings, freed channels highlighted
- `BudgetBar.tsx` — nameplate amps vs alternator ladder (80/105/145/180/220) + warnings + footage-by-gauge
- `harnessDerivation.ts` — **PLACEHOLDER contract implementation** (header-marked). Wraps `computeOverlay()`; replaced wholesale when the parallel derivation module lands. Workbench imports only the contract surface (`deriveHarness`, `SUBSYSTEMS`, types) so the swap is drop-in.
- `src/pages/WiringPlan.tsx` — tab registration (lazy chunk `HarnessWorkbench-*.js`)

## Sources cited (no invented geometry)
- D38999 25-61 cavity coordinates + CAV order: transcribed values from `scripts/generate_connector_build_sheets.py` (MILNEC insert-arrangement p. B-22, image coords center 520,610 r360, mirror-X for engine-side socket view)
- Superseal grids 9/8/8/9 (34-pos) and 7/6/6/7 (26-pos): same script, TE Superseal 1.0 catalog (Dalroad mirror p.81)
- PDM30 pin→function maps (A1-A34, B1-B26): same script, PDM30 datasheet Part 14103 via CONNECTOR_DATA_REPORT 2.5
- Subsystem membership/amps/toggleable flags: `docs/wiring/calc-data/subsystems.json` (22-subsystem map, 2026-06-09 recalc-engine extraction)
- Alternator ladder + gauge/amps derivation: `overlayCompute.ts` (existing engine)
- MECHANICAL_GAUGES behavior: subsystems.json `MECHANICAL_GAUGES_ALTERNATE` — ECU sensors never come out; gauges ADD second senders
- Design system: `.claude/rules/frontend.md` (Arial / Courier New, ALL-CAPS 8-9px labels, zero radius/shadow/gradient, 2px borders, 180ms cubic-bezier)

## Unknowns
- (none blocking this change — it is a view over derived data; no wiring-table writes, no physical routing decisions)

## Limits (honest)
- The placeholder derivation maps devices→subsystems by name match against subsystems.json lists; manifest names that match nothing default to CORE_ENGINE (always-on). The real `harnessDerivation.ts` module owns the authoritative mapping.
- Bulkhead cavity fill in the placeholder is sequential (CAV_ORDER) per the R2 gauge gate (20-24 AWG passes, thicker = direct feed) — it does NOT reproduce the R1 seed-keep map from the build sheets; that belongs to the real derivation module.
- Cut-list dimming falls back to subsystem-level matching because the placeholder re-numbers wires after filtering.
- Build verified: `npx tsc --noEmit --skipLibCheck` = 0 errors; `vite build` ✓ (own lazy chunk).

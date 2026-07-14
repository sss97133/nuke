# Receipt — Live Harness Workbench: real derivation engine integrated, verified in-browser

**Date:** 2026-06-10 · **Change type:** tooling/frontend (integration) · **Amends:** `2026-06-10_harness-workbench-tab.md` (placeholder limits resolved)

## What
Integration pass joining the two parallel builds: the WORKBENCH tab (`HarnessWorkbench.tsx` + panels) now runs against the **real** pure derivation engine (`harnessDerivation.ts`, 162-wire registry + DOC-05 companion expansion + D38999 R1–R6 cavity rules), not the computeOverlay placeholder. Verified live in a browser, not just in tests.

Files changed in this pass (all `nuke_frontend/src/components/wiring/`):
- `HarnessWorkbench.tsx` — removed the placeholder-era `dimAwareWireIds` subsystem-level dimming fallback. It existed because the placeholder re-numbered wires after filtering; the real engine keeps stable registry ids (`100`, `102g`, …), so exact id-set matching is correct — and the fallback was actively wrong for cross-keep wires (#53/#57 class: a wire kept active while its parent subsystem is off would have been dimmed). Cut list now dims on `activeWireIds` directly. Stale placeholder comments updated.
- No other component changed — the engine replacement was a drop-in on the agreed contract surface (`deriveHarness`, `SUBSYSTEMS`, `MECHANICAL_GAUGES_ID`, `D38999_CAV_ORDER/XY`, types).

## Verification (all run 2026-06-10, this session)
- **Parity suite:** `npx vitest --run src/components/wiring/__tests__/harnessDerivation.parity.test.ts` → **16/16 pass** (162-wire baseline, work-truck −24 wires / 8 freed channels, bulkhead overflow set of 8, 393.9A nameplate matching `scripts/k5_harness_calc.py`).
- **Typecheck:** `npm run type-check` (`tsc --noEmit --skipLibCheck`) → **0 errors** project-wide.
- **Production build:** `npm run build` (vite) → **clean**, workbench in its own lazy chunk.
- **Live browser proof** (vite dev, port 5174, `/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?wb=AUDIO`, WORKBENCH tab):
  - Baseline all-ON: cut list **162/162**, nameplate **393.9A**, overflow block lists the 8 no-cavity wires (#60, #100, #102g/r, #112g/r, #114, #115).
  - AUDIO toggled OFF (click → URL `?wb=AUDIO`): cut list **149/162** (AUDIO's 13 wireIds dropped, matches `subsystems.json`), PDM panel **29/30 CH — 182A, 1 FREED** (OUT20 head unit, cyan), audio rows dimmed in cut list, toggle row at 0.45 opacity.
  - Zero browser console errors.
  - Screenshot: `docs/wiring/output/workbench_proof.png` (1680×1000, AUDIO off).

## Sources cited
- Engine + data files and their provenance: see `2026-06-10_harness-workbench-tab.md` and the source-map header in `harnessDerivation.ts` (k5_harness_calc.py, rules_extracted.md DOC-05, generate_connector_build_sheets.py, subsystems.json, K5_landmarks_blender_derived.yaml, K5_wire_paths.yaml, K5_cut_list_v4.txt).
- Cross-keep behavior (#53/#57): `scripts/k5_harness_calc.py` toggle logic, ported into `harnessDerivation.ts`.

## Unknowns
- (none blocking — view-layer integration over derived data; no wiring-table writes, no physical routing decisions)

## Limits (honest)
- Two parity warnings surfaced by the engine itself in the budget bar (#5/#7/#8 ignition coils: 22 AWG fails vdrop at 4A → needs 18 AWG) are **substrate findings carried from the gauge-audit formula**, not workbench bugs; they reproduce the python engine's audit and belong to a future substrate-correction receipt on the cut list.
- Dev-only verification (vite dev server). Not deployed; no push. `vite.config.ts` pins dev port **5174** — `.claude/launch.json` (project + home) corrected from 5173.

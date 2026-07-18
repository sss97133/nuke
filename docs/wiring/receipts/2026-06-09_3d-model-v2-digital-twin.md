# Receipt — 3D model v2: harness rebuilt in the digital twin

**Date:** 2026-06-09
**Amends:** `2026-06-09_3d-cad-model-and-derived-landmarks.md`
**Trigger:** Skylar rejected the from-primitives model: "that blender file is horrible. i didnt say to build the vehicle raw dog.. it needs to be accurate. we have a partially accurate model already."

## What happened

The first pass built the truck from primitive boxes using only the dimensional atoms — ignoring the existing digital twin. Recon (3-agent sweep: directory inventory, objectTraits extraction, transcript history) recovered the full lineage:

- **The twin:** `~/k5-harness-pull/1978_Chevrolet_Blazer.blend` — TurboSquid #1764639, $99, order 6425842 (Dec 2024). Designated digital twin in `K5_DIMENSIONAL_SUBSTRATE.md`. Real body/dash/doors/interior/lights; placeholder underbody (`Under_Engine_Simple`).
- **Scale VERIFIED this session:** model wheelbase 2,703 mm vs FR-88 cited 2,705 mm (Δ2 mm). Closes the substrate caveat "frame mesh accuracy not yet verified."
- **Prior harness work was LOST:** `docs/wiring/output/formboard/` (incl. `model_analysis.json` and `K5_routed_harness.blend` with routed curves) no longer exists — swept to SSD ~May 3. `build_harness.py` + `devices.json` (141 devices) survive in `~/k5-harness-pull/` but the workspace .blend contains zero harness geometry.

## What was produced (v2)

**`~/k5-harness-pull/K5_harness_workspace_v2.blend`** — the digital twin + new `K5H_*` layer:
- Atom-built LS3/6L80E/MoTeC/radiator/battery/tank insert (67 objects) replacing the placeholder lump (hidden, not deleted)
- L01–L30 landmark polylines anchored to REAL geometry (tail lights, dash, column, door hinges, headliner) and routed per objectTraits channels (driver C-channel rear loom, dash crossbar, A-pillar boots, headliner cavity)
- Color-coded loom trunks; orange = unmeasured-position components; FWG-MAIN at factory hole H3 lateral/height per objectTraits
- 5 technical renders → `docs/wiring/output/blender/` (ghost-body passes) ; beauty rig from the TurboSquid scene preserved

**Re-derived data:** `K5_landmarks_blender_derived.yaml` (v2 values) → `K5_computed_lengths.csv` **(113 wires, 913.8 ft)** → `K5_PROTOTYPE_CUT_PLAN.md` + `K5_MATERIALS_FORMBOARD.md` updated. Notable real-geometry corrections vs v1: L15 85.5→68.7", L23 130.8→153.5", L18 28.2→43.4".

**Deprecated:** `docs/wiring/output/blender/K5_harness_3d.blend` (from-primitives model) — deleted. Renders overwritten by v2.

## New substrate conflicts surfaced (NOT fixed inline)

1. **objectTraits.ts H1–H4 firewall-hole y-coords (~-1.02) sit inside the dash volume** per actual model geometry (firewall plane probes at y≈-1.46). Traits hole positions are best-estimate; need re-anchoring against the model.
2. **Battery side is contested:** state file §4 + Skylar image = driver-front; objectTraits `STAR_BAT_CHASSIS` (x=-0.60) + `harness_spec_latest.txt` (2026-04-13) = passenger. L14/L15 mirror-flip if passenger wins. Needs Skylar's call (it's his truck — one photo of the tray settles it).
3. **ECU side is contested in older docs:** harness_spec_latest.txt says driver kick panel; state file says passenger firewall; 2026-05-23 AC receipt flags conflict with the factory evap housing. Still §4 open unknown.
4. `harness_spec_latest.txt` carries a **power-budget warning (299 A continuous vs 250 A alternator)** and a D38999 54/61-pin bulkhead concept from the pre-Tefzel generation — needs revalidation against the current PDM30 channel plan before the bulkhead decision (§3.1/§3.2) closes.
5. The TurboSquid **K20 Silverado model (product 1799009) was paid for and never downloaded** — recoverable from TurboSquid My Downloads; relevant to Doug's K20 build (K5 is its template).

## Sources

TurboSquid origin: Gmail order 6425842 via session 4078eae4 (2026-04-30). Conventions: `objectTraits.ts` (x driver+, y front−, z up+, meters) — confirmed against model geometry (speedo at x=+0.334). Envelopes: LS3-Marine p3, Holley mid-mount p2, 6L80E vendor dims, FR-88 (wheelbase check). Allowances: `scripts/compute_wire_lengths.py`.

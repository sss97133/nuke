# Receipt — 3D CAD model, derived landmarks, prototype cut plan

**Date:** 2026-06-09
**Change type:** research + tooling (evidence-producing; no testimony-table writes)
**Directed by:** Skylar, verbatim ask: build the harness "in cad, in a 3d accurate render of the truck," schematic + materials, "ready so i can start laying out the harness real world prototype."

## Decision supersession (recorded, not assumed)

The 2026-05-11 rule "2D done right, Skylar does NOT want 3D rendering" (`K5_WIRING_STATE.md` §2, also §5 failed-approaches) is **reopened by Skylar's direct instruction 2026-06-09**. The 3D model exists to serve Dave's method — it derives landmark max-lengths for the one-color prototype loom and gives the formboard transfer views. On-vehicle verification before final cuts is unchanged.

## What was produced

| Artifact | Path |
|---|---|
| Blender model (frame, body, LS3 drivetrain, 60+ components, routed looms, L01–L30 polylines) | `output/blender/K5_harness_3d.blend` |
| Renders: ISO, engine-bay top, underbody, cab/dash, formboard ortho top | `output/blender/K5_harness_*.png` |
| Derived landmark distances (30/30, polyline-measured) | `output/K5_landmarks_blender_derived.yaml` |
| Computed wire lengths via existing compute engine — 113 wires, 0 blocked, 887.6 ft | `output/K5_computed_lengths.csv` |
| Prototype cut plan (Dave method ①–②) | `output/K5_PROTOTYPE_CUT_PLAN.md` |
| Materials list (prototype wire + formboard; zero connector PNs) | `output/K5_MATERIALS_FORMBOARD.md` |

## Sources

Geometry from `K5_dimensions_atoms.yaml` (FR-88 frame/bay/body openings, KLM-Blz cross-check, LS3-Marine envelope, LS3 bore pitch, Holley mid-mount fitment p2, 6L80E vendor dims, iBooster community dims ±2mm, Champion radiator typicals). Wire data from `K5_cut_list_v3.txt`, paths from `K5_wire_paths.yaml`, allowances from `scripts/compute_wire_lengths.py` (12" loop, +6" shielded, +6" door, ×1.05/×1.10 bend).

## Assumption ledger (A1–A8, all flagged ORANGE in the .blend)

A1 M130 passenger firewall · A2 PDM30 under dash passenger · A3 FWG-MAIN grommet position (open question §3.1) · A4 battery driver-front (Skylar image) · A5 engine bellhousing X from frame point E + typical LS mount-boss offset ±50mm · A6 frame station datum at rail tip · A7 crank CL height estimate · A8 FLOOR-RR grommet placement. Full coordinates in the derived-landmarks YAML header. **Every landmark value inherits these; tape verification on the truck is the gate to final cuts.**

## Substrate inconsistencies surfaced (NOT fixed inline)

1. **`K5_cut_list_v3.txt` is missing the 13+4 wires accepted 2026-05-14** (#114–#124 Dakota, #125 TCU CAN, #126 E-Stopp, #85a/b/#86a/b high-beam). State file §1 says "added to cut list"; the file stops at 145 wires (123 + 22 companions). Needs an append amendment + paths in `K5_wire_paths.yaml`.
2. **`K5_landmarks.yaml` header still carries the WRONG VIN** (`K5_1977_CCL187Z210370`) — vehicle ID was corrected 2026-05-17 to CKR187F127263. Same stale VIN in `K5_dimensions_atoms.yaml` line 15. Needs amendment receipts.
3. **FR-88 side-view "height" atoms look mis-extracted** (frame front_rail_tip_height 706mm duplicates point-A station 706mm; pattern repeats). Model used KLM-Blz heights instead. Atoms file needs a re-read of FR-88 p1 side view.
4. **Old cut-list zone estimates were badly short on 15+ wires** (#79 license plate 3.5 ft vs 17.2 ft routed; #67, #49, #87/#88, #90/#91, #21/#22, #52, #6, #63). Documented in the cut plan §1.

## Dave-gate self-check

Would Dave shred this? The lengths are derived-not-measured and say so on every page; the deliverable is the 1:1 formboard feed, not more paper for its own sake; no connector PNs anywhere; the variance table is exactly the scrap-prevention his method exists for. Ship it to the board.

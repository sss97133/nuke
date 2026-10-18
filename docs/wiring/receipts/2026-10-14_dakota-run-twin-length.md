---
id: 2026-10-14_dakota-run-twin-length
change_type: substrate_correction
scope: planned length of wires #119, #120, #71, #39 (PDM30 -> Dakota VHX) in the registry generator, k5_registry.json and the harness model's segments
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015001000_k5_dakota_segments_twin_length.sql
contract: supabase/sql/test_k5_dakota_segments_twin_length.sql (db-contracts)
---

# PDM30 → Dakota VHX: lengths from the twin's route

**Found by the harness model's geometry check** (`v_harness_segment_geometry`, read-only 2026-10-14). Four wires were
planned shorter than the straight line between their plugs in the digital twin, 3.59 ft:
- #119 and #120 (turn signal inputs): 1.5 ft.
- #71 (ACC power) and #39 (DIM +): 3.5 ft.

All four were cut list v4.2 zone estimates, a basis the 2026-06-09 receipt already found running short.

**Sources:**
- **Route.** The twin routes this run as landmark L18, PDM30 → DASH_CLUSTER, the headlight-switch dash region where the
  Dakota VHX box is anchored. It measures 43.4 in = 3.62 ft along the routed polyline
  (`output/K5_landmarks_blender_derived.yaml`; `k5LandmarkPaths.ts` L18).
- **Pad.** The owner's cut pad is 15 % in the body (K5_WIRING_STATE row 33). It is applied downstream, as for every
  planned length (`kits_v5.py` BOM feet).
- **PDM30 position.** This is the twin's assertion A2, "under dash passenger" (state section 4, a measurement unknown).

**Change:**
- Planned length 3.7 ft (3.62 rounded up) for all four wires, set in three places:
  - the generator, `reconcile_v5.py` (`DECISIONS`, with the basis);
  - `k5_registry.json`: the four rows, plus BOM wire feet moved by exactly their padded delta: 22 AWG red +5.1 ft,
    22 AWG gray +0.2 ft, 18 AWG red +0.2 ft;
  - the harness model's four live segments.
- The legacy `vehicle_custom_circuits` rows keep the zone estimate until the registry loader next supersedes them.

**Not done, and why:**
- The registry could not be rebuilt end to end from main. `reconcile_v5.py` imports
  `output/lego-book/build_ch1.py`, which exists only on another branch's checkout. Rebuilding with the local copy also
  rewrote endpoints, splices, dossiers and the cart diff (drift unrelated to these wires), so only the minimal patch
  ships.
- #21's `length_ft` (2.2 ft) already includes a ×1.2 pad, which the BOM applies again. It is named here, not changed.

**Unknowns:** the PDM30's mount position and the run length on the truck. Both are taped at the formboard, per Dave's
method.

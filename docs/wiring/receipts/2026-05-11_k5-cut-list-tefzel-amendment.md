---
id: 2026-05-11_k5-cut-list-tefzel-amendment
date: 2026-05-11
change_type: amendment
scope: docs/wiring/output/
amends: K5_cut_list_v2 (the cut list itself, plus derived/dependent docs)
---

# Cut list v2 amendment — purge TXL, lock in Tefzel-only

## Decision

Skylar confirmed 2026-05-11: **Tefzel only.** No TXL, no marine cable substitution for 4 AWG. The build is Pro tier across all gauges.

## Per-gauge spec

| AWG | Spec |
|---|---|
| 4 | M22759/16 Tefzel |
| 8 | M22759/16 Tefzel |
| 10 | M22759/16 Tefzel |
| 12 | M22759/32 Tefzel |
| 14 | M22759/32 Tefzel |
| 16 | M22759/32 Tefzel |
| 18 | M22759/32 Tefzel |
| 20 | M22759/32 Tefzel |
| 22 | M22759/32 Tefzel |
| 22 shielded 2C | M27500-series (e.g. M27500-22-SB-2-T23) |
| 22 twisted pair (CAN) | M27500-series twisted, or equivalent shielded TP |

Rationale: M22759/32 is the cross-linked thin-wall variant available 28-12 AWG. M22759/16 is the standard-wall variant covering 4-22 AWG (used here for 4, 8, 10 AWG since /32 does not exist >12 AWG). Both are Tefzel (ETFE) insulation, 150°C, tin-plated copper. Per `K5_wire_spec_and_costs.md` Appendix A/B.

Skylar explicitly rejected the marine-grade 4 AWG substitution that the spec doc had recommended on cost grounds.

## Files changed

**Active spec (replaced TXL with correct gauge spec):**
- `docs/wiring/output/K5_cut_list_v2.txt` — header amended; all `NN AWG TXL` → `NN AWG M22759/32` or `M22759/16`; wire purchase summary updated
- `docs/wiring/output/K5_cut_list.txt` (v1) — same substitutions (118 changes)
- `docs/wiring/output/K5_coil_mapping.md` — coil bus and per-wire spec updates
- `docs/wiring/output/K5_harness_build_sheets.md` and `_v2.md` — build sheet rows
- `docs/wiring/output/K5_S2_engine_schematic_v2_p2.svg`, `K5_S2_P1_ignition_coils.svg`, `K5_S2_P2_fuel_injectors.svg`, `K5_S2_P3_engine_sensors.svg`, `K5_engine_bay_ls3_overlay.svg`, `K5_engine_bay_ls3_standalone.svg` — wire spec annotations
- `docs/wiring/output/K5_EE_AUDIT.md` — ampacity check now references Tefzel @ 150°C / 70% derate (was TXL @ 105°C)
- `docs/wiring/output/K5_wire_routing_guide.md` — door flex point note now references Tefzel flex life
- `docs/wiring/output/K5_wire_spec_and_costs.md` — "Wire Specification Correction" section rewritten to reflect amendment (no longer says cut list header is wrong)
- `docs/wiring/output/K5_wire_formboard_cuts.csv` and `_ENGINE.csv` — regenerated from amended cut list
- `docs/wiring/output/K5_wire_neighbor_inventory_request.md` and `_ENGINE.md` — regenerated

**Preserved with banner (TXL kept as historical comparison only):**
- `docs/wiring/output/K5_wire_cost_analysis.md` — TXL-vs-Tefzel cost rationale doc. Build-decision banner added at top. TXL references in comparison columns left intact so the comparison still reads.
- `docs/wiring/output/K5_shopping_list.md` — wire section superseded by Tefzel pricing in spec_and_costs.md; banner added. Connector/terminal sections still valid.

**Not touched (frozen historical artifacts):**
- `docs/wiring/output/k5-build/2026-04-25T*/ee_audit.md` — dated snapshot reports from prior agent runs. Left as-is — they reflect what was current on their date.
- Base64-embedded image data in SVGs that contains the substring "TXL" coincidentally — false-positive matches, not text content.

## Citations

1. **K5_wire_spec_and_costs.md** — Appendix A/B (M22759/32 and /16 technical specs), Job 3 (ProWire pricing $336–$2,017 depending on color order strategy), and the explicit "Wire Spec Correction" section that had already flagged the TXL placeholder as wrong.
2. **K5_wire_cost_analysis.md** — TXL vs Tefzel cost delta (~$172 vs ~$336 baseline, up to ~$2,017 with stripes).
3. Skylar verbal confirmation 2026-05-11 in session — "Tefzel" then "ONLY TEFZEL" after I asked about the marine cable exception for 4 AWG.

## Unknowns / follow-ups

1. **22 AWG SHIELDED 2C SKU** — these come from the M27500 series, not /32 or /16. Specific part number (e.g. M27500-22SB2T23 for 22 AWG, 2-conductor, tin-plated, 105°C) needs supplier-side confirmation before ordering.
2. **22 AWG TWISTED PAIR (CAN)** — same question as #1. M27500 twisted-shielded-pair variant or a dedicated CAN cable like Belden.
3. **3-color stripe wires** — 8 wires in the cut list use 3-color stripe codes (ORN/BLK/RED etc.). Already remapped to 2-color equivalents in the form board CSV per spec_and_costs.md §"Three-Color Stripe Problem." Validate the remap at mockup time.
4. **The k5-build/*/ee_audit.md historical snapshots** still reference TXL @ 105°C. If those reports are ever regenerated, the new run should use the amended ampacity criteria (Tefzel @ 150°C / 70% derate).

---
id: 2026-09-26_registry-v5-phase0-reconcile
date: 2026-09-26
change_type: substrate_reconciliation
scope: docs/wiring/calc-data/{k5_registry.json, reconcile_v5.py, RECONCILE_REPORT.md}, docs/wiring/build-plan/SUPERSEDED.md
status: APPLIED (Phase 0, step 1 of the approved plan ~/.claude/plans/replicated-hatching-sutherland.md)
---

# Registry v5.0-draft — one master list from four overlapping layouts

## Why
Owner, 2026-09-26: "really try full build out on paper before orders… ensure weve establish a full layout of the vehicle wiring"; "super important… theres not parallel methods in development." Exploration found four harness layouts, never reconciled:
- `build-plan/` (Apr 17): 332 wires, whole vehicle, terminals per end. Orphaned.
- Cut list v4.2 (Jun 10): 174 wires, newest decisions.
- The recalc engine: still reads the v3 registry, 145 wires.
- The app's `k5Subsystems.ts`: a hand port of `subsystems.json`.

## What was done
- `calc-data/reconcile_v5.py` is deterministic. It reuses `lego-book/build_ch1.parse_cut_list`, and re-aligns April's CSV on its insulation column (fixes ENG-W025, where an unquoted comma shifted the columns).
- It builds `k5_registry.json` with these counts:
  - **174 active** (v4.2, with the Chapter 1 Dave-convention colors and printed labels)
  - **243 candidate** (April-only circuits)
  - **19 implied** (wires later decisions require that no list carried; each cited): G1/G2/G3 grounds, M130 Ethernet ×4, the PDM UTC/XLR port ×3, the isolator-to-M130 shutdown wire, Dakota CONST power, and PCS power/ignition/TPS/RPM/brake/neutral-safety/reverse
  - Plus the PDM30 20 A pigtail note: 16 conductors
- Matching v4.2 to April:
  - Label containment with synonyms (KNK, OILP, FPRESS, CLT, IAT, DBW…).
  - Role guard: signal / 5V / ground / power must agree.
  - Side and index guards (TPS1 vs TPS2, coil numbers, bank numbers).
  - M130 pins are only a tie-breaker, because April's pins are unreliable: B08/B10 for 5V/ground, "or similar", fuel PSI on A14.
  - Rails are never matched to a single branch.
  - Result: 89 pairs. Every April/v4.2 pin disagreement is recorded, and v4.2 wins.
- April assumptions superseded, as counts across the 243 candidates:

  | April assumption | Candidates |
  |---|---|
  | TXL/GXL insulation | 185 |
  | Bulkhead/grommet scheme | 26 |
  | Fuse block / rear junction box | 23 |
  | EV6 injector terminals | 8 |
  | Aeromotive pump | 6 |
  | Holley T43 | 1 |
  | Neutral-safety switch | 1 |

- `build-plan/SUPERSEDED.md` marks the April plan as evidence only. Nothing was deleted.

## Not done yet (next steps of Phase 0)
- Switch `scripts/k5_harness_calc.py` from the v3 registry to `k5_registry.json`.
- Generate `k5Subsystems.ts` from it.
- Point `build_ch1.py` at it.
- Only then mark cut lists v1–v4.2 superseded. v4.2 stays the live Chapter 1 input until the switch.

## Open unknowns
- The machine pairs are suggestions. Each is confirmed in its chapter review (Phase 2).
- The devices section is the 141-device manifest from `/Users/skylar/k5-harness-pull/devices.json`. The 225 April device names are not yet reconciled to it.

---
id: 2026-09-26_one-list-readers-switched
date: 2026-09-26
change_type: substrate_reconciliation
amends: 2026-09-26_registry-v5-phase0-reconcile
scope: docs/wiring/calc-data/{reconcile_v5.py, kits_v5.py, k5_registry.json}; scripts/k5_harness_calc.py; nuke_frontend/src/components/wiring/{k5Subsystems.ts, k5LandmarkPaths.ts} (header notes only); K5_WIRING_STATE §7 item 13 + row 0q
status: APPLIED (step 2 of the owner-approved pick-up plan ~/.claude/plans/vivid-hugging-globe.md)
owner surface: build book main tab rev 129–130 (M130 pinout regenerated from the master; Sep 25 "what the pages found" list re-statused)
---

# One list: the readers now read the master

## Why
The owner said "super important… that there's not parallel methods in development" (2026-09-26). Phase 0 built the registry, but the readers stayed on older lists:
- the recalc engine read cut list v3 (145 wires);
- Chapter 1 read v4.2;
- the workbench app used hand ports of v3/v4.

The build book's M130 pinout (from Chapter 1) was stale against the registry:
- TPS 1 on A14 and the retired TPS 2 on A17;
- crank on the 5 V at A2;
- B19 marked unused;
- Ethernet "NOT WIRED".

## What changed
- **Subsystem on every live wire.** `SUBSYSTEM_RULES` (reconcile_v5.py) assigns the 29 v4.x wires and 52 implied wires by the section or decision that added them. 221 live wires, none unassigned.
  - Dakota VHX + DAK_CONST → DASH_CLUSTER_DAKOTA
  - #125 + PCS_* → TRANS_6L80E (key keeps its name; the trans is a 6L90)
  - #126 → EPARKING_BRAKE
  - #85a/b, #86a/b → LIGHTING_EXTERIOR
  - ECU lifelines, pedal, Ethernet, coil/injector branches → CORE_ENGINE
  - PDM feed, UTC port, G1–G3 → HARNESS_INFRA
  - ISO_KILL → CHARGING_STARTING
  - PUMP_GND → FUEL
- **Recalc engine.** `scripts/k5_harness_calc.py` `load_data()` reads the registry: live wires plus implied, with retired wires skipped. Subsystem membership comes from each wire's own field; the v3 `wire_ids` lists are no longer read. It exits if any wire has an unknown subsystem.
  - Footage is keyed by the wire's own spec. A 0 AWG /32 misclassification (from `gauge or 18`) is fixed.
  - Specs with no price in the May snapshot are named in the output rather than silently costed at $0.
- **M130 pinout.** `kits_v5.py` `m130_pinout()` builds the Dave-format table from the registry's M130 terminations. CAN comes from the CAN-BUS endpoint, and function names from the build_ch1 M130 table (carried in `reg['ecu_pins']`, source CONNECTOR_DATA_REPORT.md:231-295).
  - The #99r/#101r labels were corrected to "6.3V Supply" through a label decision; `apply_decisions` now accepts `label`.
- **App.** `k5Subsystems.ts` and `k5LandmarkPaths.ts` got a SUPERSEDED DATA header. The workbench still runs on them (nothing deleted). They get regenerated from the registry when the clickable plug map is built.
- **Cut lists v1–v4.2.** State §7 item 13 marks them as parse seed only.

## Verification (measured)
| Config | Wires | Footage | PDM channels |
|---|---|---|---|
| Baseline, before (v3) | 145 | 892.0 ft | 30/30 |
| Baseline, after (master) | 221 | 1,392.3 ft | 29/30 |
| k5_engine_start_minimum | 136 | 606.6 ft | 4 (freed list deduped) |
| k5_no_audio | 208 | — | — |
| k5_work_truck | 197 | — | — |
| k20_74_lwb_lsx454 | 195 | — | — |

- **Wire delta, before → after:** 145 → 221 = +29 v4.x wires + 52 implied − 5 retired (#4d, #25, #94, #60, #61). That is exactly the documented reconcile.
- **Other configs:** k5_no_audio, k5_work_truck and k20_74_lwb_lsx454 all run.
- **Pinout vs the Sep 25 v4.2 table:** every pin difference traces to a cited decision:
  - TPS → B9 (SENT);
  - A14/A17 free;
  - crank/cam 6.3 V B19 with 0 V B15;
  - MAP → A2;
  - B16 = the other 12 sensor 0 V;
  - PCS on A33/B21;
  - CAN B17/B18;
  - Ethernet B23–B26.

## Not done (why)
- **Chapter 1 drawings (pages 1–2)** are still v4.2. `build_ch1.py` is upstream of the registry: its v4.2 parse and Dave colour assignment seed `reconcile_v5.py`. Redrawing the pages from the registry means splitting its seed outputs from its page outputs to avoid a circular overwrite of decision history. The build book flags the drawings as Sep 25.
- **Workbench app regeneration:** deferred to the clickable-map build (see App above).
- **Calc engine gauge audit:** it still charges each coil's 4 A to the M130 trigger wire. The current flows through the coil's PDM feed (pin d), so the 22 AWG trigger flags are false positives. This is pre-existing, and the fix is in the audit model.

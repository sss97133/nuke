---
id: 2026-10-15_k5-pdm-load-citations
change_type: substrate_correction
scope: docs/wiring/calc-data/reconcile_v5.py PDM_LOADS (six cited currents, OUT26's stale source); k5_registry.json pdm_settings regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 23: six PDM outputs get their maker's current

**Gap.** 18 of the 40 PDM outputs had no cited running current, so the model could not set or check their limits
(RSI pass 15: "PDM outputs still waiting on a cited load current" 18/40). Each named what it needed.

**Evidence** (each quote checked against its source on 2026-10-15; web snapshots are in the local library):

| Output | Load | Current | Source |
|---|---|---|---|
| PDM15 OUT11 | Sanden SD7B10 clutch | 4.2 A | Sanden SD7 service manual p.14 §10.4: "Normal current should be 3.6 - 4.2A at 12VDC" |
| PDM30 OUT7 | E-Stopp ESK001 | 8 A operating | estopp.com standard kit: "12V/10A constant power", "Draws 3-8A when operating" |
| PDM30 OUT11 | RetroSound Motor 2B constant | 15 A max | Motor 2B manual printed p.21: "Current Consumption (during operation) ... Max. 15A" |
| PDM30 OUT23 | RVS mirror monitor | 0.67 A | rearviewsafety.com RVS-7180355-IR specs: "Power Consumption 8W" |
| PDM30 OUT24 | MoTeC M130 | 0.34 A no-load | motec.com.au M130: "Typical no-load supply current: 0.34 A at 13.8 V supply" |
| PDM30 OUT29 | Dakota VHX + GSS-3000 | 1.02 A | VHX manual p.7: "the system draws less than 1 amp"; GSS-3000 manual p.10: "≈ 20 mA" |

PDM30 OUT26's source named the Hella pump, which was retired on 2026-09-29. #50 now feeds the factory washer ratchet
solenoid. The source now says so, and still needs a bench figure.

**Result (regenerated; the limit rule is unchanged):** outputs set go from 20 to 24, open from 18 to 12, and in
conflict from 1 to 3.
- PDM30 OUT7 is set at 10 A, OUT23 at 1 A, OUT24 at 1 A and OUT29 at 2 A.
- **PDM15 OUT11** is a conflict. The 4.2 A clutch needs 6 A, but #23 is 20 AWG in the engine bay, which allows 5 A
  (0.85 × 6 A, PDM manual p.48, 100 °C column). An 18 AWG #23 would close it.
- **PDM30 OUT11** is a conflict. On RetroSound's 15 A maximum it needs 19 A, against an 8 A output on 20 AWG. That
  maximum is the radio driving its own speakers, but this build runs them off the external amp. Only a bench figure
  closes it.
- PDM30 OUT21 (door locks) is unchanged.

**Unknowns:**
- The 12 outputs still open, each named in its status: the coil packs, starter solenoid, PCS ignition, blower (two
  outputs), E-Stopp ignition sense, iBooster wake, radio ACC, horn, camera, washer solenoid and USB charger input.
  Most have no published figure, so each status names the bench measurement that closes it.
- The research is at `~/nuke-logs/k5-rsi-20261014/` (pdm_load_currents.md).

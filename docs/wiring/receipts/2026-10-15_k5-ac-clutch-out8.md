---
id: 2026-10-15_k5-ac-clutch-out8
change_type: substrate_correction
scope: docs/wiring/calc-data/reconcile_v5.py (wire #23 decision; PDM_LOADS key), catalog/endpoints.yaml (SPL-PDM15-OUT8); k5_registry.json, WIRE_CHECKS.json, OPTIONS.md regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3
amends: 2026-10-15_k5-pdm-load-citations
---

# RSI pass 24: the A/C clutch moves to a 20 A output so its feed can be heavy enough

**Gap.** RSI pass 23 cited the Sanden SD7 clutch at up to 4.2 A (SD7 service manual p.14). The design's limit rule
puts PDM15 OUT11 at ceil(1.25 x 4.2) = 6 A. #23 is 20 AWG in the engine bay: 6 A at 100 °C (MoTeC PDM manual p.48),
and 0.85 x 6 = 5.1 A, so the output was in conflict.

**Options weighed:**
- **18 AWG on OUT11.** This carries the current (9 A, 0.85 x 9 = 7.6 A), but MoTeC gives 24#–20# for 8 A outputs
  (PDM manual p.6, p.48).
- **Two paralleled 8 A outputs.** MoTeC allows this on a common condition (p.6, p.22), but how paralleled outputs trip
  is not documented (an open vendor question).
- **PDM15's free 20 A output OUT8** (pins B7 + B13, p.43), with two 20 AWG pigtails into an in-line M81824/1-2 and an
  18 AWG run. This uses MoTeC's 20#–16# for 20 A outputs, and it is the treatment #64 got in round 4. Chosen.

**Change:**
- Wire #23 now runs from PDM15:OUT8, 18 AWG. The generator adds pigtails 23_PT1 and 23_PT2 on PDM15-B B7 and B13.
- The new splice node SPL-PDM15-OUT8 is in the endpoint catalog.
- The cited 4.2 A moves with the clutch, from OUT11 to OUT8. OUT11 is free again.

**Result (regenerated; a second rebuild is byte-identical):**
- PDM15 OUT8 is set at 6 A, under its 7 A ceiling (0.85 x 9 A for the 18 AWG run).
- The wire-end check (R8) passes on all three new ends.
- PDM settings: 25 set, 12 open and 2 in conflict. The two left are PDM30 OUT11 (the radio's 15 A maximum, waiting
  on a bench figure) and OUT21 (door locks).
- PDM15 has no free 20 A output left; five 8 A outputs stay free (OUT10, 11, 12, 14 and 15).

**Unknowns:** none for this change. The clutch lead's terminal is still open (AC-CLUTCH, "connector not picked").

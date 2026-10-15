---
id: 2026-10-15_pdm15-pin-map-protection-fold
change_type: substrate_correction
scope: device_pin_maps PDM15 rows (pinout per the MoTeC PDM user manual p.43); pdm_channels PDM15 notes; fold_harness_net_protection(); v_harness_pdm_protection_check; scoreboard measure "PDM-fed wires not protected by the output the design names (must be 0)"; load_map_rows.py calls the fold after every run
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015023000_pdm15_pin_map_protection_fold.sql
contract: supabase/sql/test_k5_pdm15_pin_map_protection_fold.sql (db-contracts)
---

# RSI pass 13: the PDM15 pinout comes from MoTeC's manual, and protection checks itself against the design

**Gap.** `device_pin_maps` held a PDM15 pinout that was never MoTeC's: 37 rows reading "A1..A15 = Output 1..15", A16
"Battery +12V Supply", A17 "Ground A (0V)" and B1..B16 "Switch Input 1..16". The MoTeC PDM user manual, printed
p.43 (`reference_documents/component_drawings/motec_pdm_user_manual.pdf`), gives a different layout:
- Connector A is 34-pin; connector B is 26-pin.
- Each 20 A output is a pin pair: OUT1 A1+A10, OUT2 A3+A12, OUT3 A5+A14, OUT4 A7+A16, OUT5 A9+A17, OUT6 B3+B9,
  OUT7 B5+B11, OUT8 B7+B13.
- The 8 A outputs sit between the pairs: OUT9 A2, OUT10 A4, OUT11 A6, OUT12 A8, OUT13 A11, OUT14 A13, OUT15 A15.
- Battery negative is A26 and B18; 0 V is A28 and B22; CAN is B25/B26; the inputs are spread across A19-A34 and
  B15-B24.

21 of the 37 rows named the wrong function, and 24 pins had no row. The PDM30 rows agree with p.44. The registry
(`reconcile_v5.py` PDM20_PINS, citing the same page) already had it right.

RSI pass 1 pointed each net at the output its wire end lands on, through this map. Measured read-only on 2026-10-15
on the K5, over the 63 decided wires whose design names a PDM output (`vehicle_custom_circuits.from_component`):
- 50 agreed with their net's protection.
- 9 PDM15 wires were "protected" by another output. INJ_PWR, the injector rail feed on PDM15 OUT2, read as OUT3;
  ALT_L (OUT9, pin A2) read as OUT2; wire 23 (OUT11, A6) read as OUT6.
- 4 had no protection at all, because their segments have no wire ends and so no pin to read: wires 49 and 50, and
  the SPL-PDM30-OUT5 splice net.

**Change:**
- The PDM15 pinout follows p.43. 36 rows are corrected or renamed, and each row's note keeps what it said before.
  24 rows are added. The naming is the PDM30's (OUTn, OUTn_A/_B for a pair, DIGn, VBATT_NEG_A/B, GND_0V_A/B,
  CAN_LO/HI, NC). The PDM15 channel notes now name their real pins.
- `fold_harness_net_protection(vehicle)` sets each live net's PDM output from three rules, in order:
  - a wire end on an output pin;
  - else the one output its wires' design names (the basis is written into the net's method);
  - else none, clearing a stale pointer.
  The fold is idempotent, runs as service role only, and the loader calls it after every run.
- `v_harness_pdm_protection_check` puts the design's output beside the folded one for every decided PDM-fed wire. The
  scoreboard measure "PDM-fed wires not protected by the output the design names (must be 0)" counts the
  disagreements. It would have read 13 of 63 before this pass.

**Expected on deploy**, predicted read-only from production data:
- 59 nets protected from a pin and 3 from the design: 62 of 400, up from 57. That is 5 nets gaining protection,
  7 re-pointed to their real output and 0 cleared.
- 0 nets join a supply to ground.
- 0 of 63 PDM-fed wires are off their output.

**Not done:**
- The programmed limit and the load per output. The registry's `pdm_settings` holds 39 outputs: 20 set, 18 open,
  1 conflict. That is the next pass; this one corrects the pointer they hang on.
- The 180 segments with no wire ends. The loader writes them without ends. That gap is the one that leaves 4 wires
  depending on the design's word alone.

**Unknowns:** none.

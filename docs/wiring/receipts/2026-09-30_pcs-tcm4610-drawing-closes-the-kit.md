---
id: 2026-09-30_pcs-tcm4610-drawing-closes-the-kit
change_type: substrate_correction
scope: calc-data/catalog/endpoints.yaml (PCS-TCM, PCS-HARNESS-4610, PCS-HARNESS-4610-CASE, TRANS-CASE, PDM30-STUD, SPL-PDM30-OUT5), calc-data/reconcile_v5.py (PCS_* wires, IMPLIED_RETIRED, INLINE_FUSES, SPLICE_TAPS), catalog/mounts.yaml, catalog/part_media.yaml, catalog/part_models.yaml, cad/fab/fam_power.py, calc-data/load_map_rows.py (REPLACED_NODES)
found_by: owner, 2026-09-30 — forwarded Zero Gravity Performance's reply to his 2026-09-28 questions, with the PCS harness drawing attached
---

# The TCM-4610 drawing closes the transmission kit's open leads

The owner received PCS drawing **A-TCM4610 rev 009**, "GM 6L50,80,90 to TCM-2600 harness" (2 pages, dated 1/30/25), from
Zero Gravity Performance on 2026-09-30 (kept locally as
`reference_documents/component_drawings/PCS_A-TCM4610_rev009_6L50-80-90_to_TCM-2600_harness.pdf`). The reply also says:
the 4-low input isn't needed; the 6L90's internal TCM sends its GMLAN messages "just like a factory vehicle"; and the kit
carries the 6L80E case plug. Every lead this registry marked "OPEN until the TCM-4610 drawing" now has an answer.

## What the drawing says (pin-level truth: page 1's TCM C-1 cavity list; page 2's connector tables)

- **One +12V BATTERY lead**, 18 AWG RED, 60 in: splice S1 feeds TCM cavity 20, case cavities 1 + 4 and OBD2 16.
- **One SWITCHED +12V lead**, 16 AWG YEL, 60 in: splice S3 feeds TCM cavity 19 and case 9 + 12 (the case wake).
- **One CHASSIS GND lead**, 16 AWG BLK, 60 in: splice S2 joins TCM cavity 9, case 2 + 5 and OBD2 4 + 5.
- **Case plug:** 1/4 battery, 2/5 ground, 7 single-wire tap shift (to the C7 paddle plug), 9/12 ignition, 10/14 CAN2 high,
  11/13 CAN2 low (10/11 to TCM 43/44, 14/13 on to OBD2 6/14); **3, 6, 8, 15, 16 empty** (blocking plugs).
- **Flying leads:** TACHOMETER ORN\BLK (TCM 24, SPEED 3), TACHOMETER GND BLK\WHT (23), BRAKE INPUT GRY\BLK (2, DIG IN 1),
  PARK\NEUTRAL PNK\BLK (53, PWM 7), REVERSE VIO\BLK (11, PWM1), SPEEDO ORN\WHT (17), SPEED OUTPUT VIO\WHT (41), DIG IN 2-5,
  PWM 9, ANA IN 6.
- **TPS** comes in on the C6 plug: B = TPS SIG (TCM 45, ANA IN 1), A = SIG GND (56), C = +5V SENSOR (21). There is no analog
  1 flying lead.
- **Case lead 72 in** from the TCM. Notes: 20 AWG TXL unless stated; lengths ± 1/2 in.

## What changes here

- **Retired:** `TRANS_BATT` (case 1 + 4 ride PCS_BATT through S1), `TRANS_GND` (case 2 + 5 return through the cab-side
  CHASSIS GND lead, PCS_GND), `TRANS_BRK` (case 6 is empty), and `TRANS_BATT_FH` with its fuse `FUSE-TRANS_BATT` (the fuse
  node points at FUSE-PCS_BATT when it leaves the map). Endpoint `PCS-HARNESS-4610-CASE` retired: the kit brings out no
  case-side lead.
- **PCS_BATT's fuse: 5 A provisional → 7.5 A** (Blue Sea 5240): the one lead now carries the case solenoid supply
  (Holley 558-499 p.3: 5 A; 1.25 × 5 A = 6.25 A → 7.5 A, under 18 AWG's 11 A at 80 °C). The TCM's own draw is still not on
  file.
- **PCS_GND** now returns the solenoid current too: 18 AWG (11 A at 80 °C) is over the 7.5 A fuse.
- **PCS_IGN** carries the case wake current (PDM15 OUT13) and steps down from 14 AWG to the 16 AWG kit lead.
- **Each PCS wire's far end** now names the kit lead by its drawn label and colour; PCS_TPS lands in the C6 mating plug,
  cavity B.
- **SPL-PDM30-OUT5** holds four conductors (3,700 CM, still in the yellow band).
- **TRANS-CASE** cavities describe what the kit fills; its open list loses the three "OPEN until the drawing" items.
- **Reach:** the twin puts the PDM30 0.92 m axis-by-axis from the transmission centre (twin_centers.json); the case lead
  is 1.83 m.

## The drawing disagrees with itself (recorded, not fixed)

- Page 2's unterminated-wire table gives DIGITAL IN 2-5 as TCU-2 to TCU-5; page 1 puts them at cavities 3-6, with the
  same colours. Page 1 is the cavity list, so this registry follows it.
- Page 2's C1 and C2 tables cross-reference the CAN2 pair's pins swapped (C1-14 CAN2 HIGH "C2-6" vs C2-6 "C1-13"); the
  colours agree (YEL high, GREEN low), so OBD2 6 = high and 14 = low, as the OBD2 standard has it.
- Page 2's C6 table lists "+5V SENSOR ... TCU-21, S3", and S3 is the switched +12 V splice. Meter C6 C before anything
  mates it (expect 5 V).
- The flying leads: page 2 dimensions them at 60 in; page 1 says "unterminated pigtail to a length of 10 feet". Measure
  the kit.

## Unknowns

None for this change. Still open, and listed on the endpoints: the TCM's own current draw; the kit's floor
pass-through; the flying-lead length; the C6 C meter check; the PCS_IGN step-down splice part (14 + 16 AWG = 6,690 CM,
over the D-609 yellow band's 6,530).

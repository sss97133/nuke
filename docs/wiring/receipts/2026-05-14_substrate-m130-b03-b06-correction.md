---
id: 2026-05-14_substrate-m130-b03-b06-correction
date: 2026-05-14
change_type: substrate_correction
scope: docs/wiring/output/K5_connector_schedule.txt
amends: none
---

# K5_connector_schedule.txt — M130 Connector B B03-B06 stale UNUSED → AT inputs

## What was wrong

`K5_connector_schedule.txt` lines 33-50 (pre-amendment) listed M130 Connector B pins B03, B04, B05, B06 in the "UNUSED" line at the bottom, despite every other doc in the substrate agreeing these pins are assigned:

- B03 = AT1 / IAT (per `K5_cut_list_v2.txt:39` wire #109)
- B04 = AT2 / CLT (per `K5_cut_list_v2.txt:40` wire #110)
- B05 = AT3 / OTS (per `K5_cut_list_v2.txt:42` wire #113)
- B06 = AT4 (spare AT input, function reserved)

The stale "UNUSED" caused `K5_cross_reference_check.md:173` to flag the contradiction without resolving it. Caught during wire closure receipts 2026-05-13_wire-110-clt-closure.json and 2026-05-14_wire-109-iat-closure.json.

## Authoritative source

`reference_documents/component_drawings/motec_m1_hardware_techspec.pdf` p17 — M130 Connector B pinout table. Direct quotes:

| Pin | Designation | Full Name | Function |
|---|---|---|---|
| B03 | AT1 | Analogue Temperature Input 1 | 1k Pull up to SEN_5V_A |
| B04 | AT2 | Analogue Temperature Input 2 | 1k Pull up to SEN_5V_B |
| B05 | AT3 | Analogue Temperature Input 3 | 1k Pull up to SEN_5V_A |
| B06 | AT4 | Analogue Temperature Input 4 | 1k Pull up to SEN_5V_B |

Also confirmed:

- `chapters/appendix-g-diagram-requirements-spec.md:889` — "M130 Connector B pin map: CKP B01, CMP B02, knock B07/B13, IAT B03, CLT B04, OTS B05 (HAVE)"
- `chapters/12-build-sheet.md:32` — "Analog sensors (22 AWG TXL): MAP (AV1), IAT (AT1), CLT (AT3), oil pressure (AV2), fuel pressure (AV3), oil temp (AT2)" — note this assignment of AT1/AT3 differs from current build; cut list is canonical for AT assignments.

## Additional facts unlocked from MoTeC PDF p16-17

- M130 Connector A mating: **Tyco Superseal 34 Position Keying 1 — MoTeC #65044** (already in shopping list)
- **M130 Connector B mating: Tyco Superseal 26 Position Keying 1 — MoTeC #65045** — this PN was previously unknown (shopping list said "ask Motec dealer for PN"). Now cited.
- AT pullup pairing:
  - B03 (AT1) + B05 (AT3) → pull up to SEN_5V_A → conventionally ground via SEN_0V_A (B15)
  - B04 (AT2) + B06 (AT4) → pull up to SEN_5V_B → conventionally ground via SEN_0V_B (B16)

## Changes applied

`docs/wiring/output/K5_connector_schedule.txt`:
- Header amended with date stamp and mating connector PN (MoTeC #65045)
- B03 row added: AT1 / Intake Air Temp Sensor / Wire #109 / 1k pull-up to SEN_5V_A
- B04 row added: AT2 / Coolant Temp Sensor (ECU) / Wire #110 / 1k pull-up to SEN_5V_B
- B05 row added: AT3 / Oil Temperature Sensor / Wire #113 / 1k pull-up to SEN_5V_A
- B06 row added: AT4 / spare / 1k pull-up to SEN_5V_B
- SEN_0V_A / SEN_0V_B notes amended to identify the companion AT inputs by pullup pairing
- UNUSED line shortened from 12 to 8 pins (B03/B04/B05/B06 removed; B06 noted as "spare-but-functional")

## Downstream effects

These wire closures can now cite `K5_connector_schedule.txt` instead of `chapters/appendix-g`:
- Wire #109 IAT (B03) — `2026-05-14_wire-109-iat-closure.json` substrate_inconsistencies[0] is resolved
- Wire #110 CLT (B04) — `2026-05-13_wire-110-clt-closure.json` substrate_inconsistencies[0] is resolved
- Wire #113 OTS (B05) — closure receipt not yet written; will inherit corrected substrate

`K5_cross_reference_check.md:173` should be updated to remove the "B04 = UNUSED" flag (separate paper update, low priority).

## Unknowns not closed

- Individual Superseal **terminal PN** (the metal contact crimped onto each wire) is not listed in the M130 pinout pages. Standard Tyco Superseal terminals are likely included in MoTeC #65044 / #65045 connector kits, but explicit terminal PN remains UNKNOWN. Page 16-23 of the PDF contains pinouts only — terminal datasheet is a separate Tyco/TE doc.

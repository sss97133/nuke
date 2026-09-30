---
id: 2026-09-29_part-models-devices-batch-4
change_type: research
scope: docs/wiring/calc-data/cad/fab/ (dev_switches.py, 24 end scripts), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist-2 lane, session ebc425ad)
follows: 2026-09-29_part-models-devices-batch-3
---

# Part models, devices batch 4: the 24 switch, control and module ends

## What changed
- `cad/fab/dev_switches.py`: `switch_part()` takes the pins straight from the registry (one pin per distinct terminal
  text; wires that share a terminal share its pin) and lays them on the part's terminal face; builders for the factory
  dash, column, pedal, jamb and tailgate switches, the Nu-Relics chrome rocker panels, the Torque King switch, the DBW
  pedal and the Dakota and PCS boxes.
- Ends: HL-SW, FLOOR-DIMMER, WIPER-SW, BLOWER-SW, IGN-SWITCH, TURN-SW, HORN-SW, BRAKE-SW, TG-CUTOUT, DOOR-JAMB-L / R,
  TG-SW-KEY, TG-SW-KEY-REV, TG-SW-DASH, TG-SW-MASTER, WIN-SW-L / R, LOCK-SW-L / R, TCASE-4WD-SW, APS, GSS-3000,
  DAKOTA-VHX, PCS-TCM.

## Sources
- Nu-Relics #201 page: bezel 2-7/8 x 1-3/4 in, cut-out 2-1/4 x 1-1/4 in (WIN-SW-L / R).
- Torque King QU30048 page: 15/16 in hex, 16 lb-ft (TCASE-4WD-SW); the rest sized off its photos.
- Dakota VHX control box 5.5 x 3.5 x 1 in: Dakota's own image as relayed by research/2026-06-09_design-inputs-recon.md
  (dakotadigital.com refused a scripted read on 2026-09-29).
- Everything else has no size on file (the OER 1990096 listing gives only its package; USA1, Motor City K5, Dakota's
  GSS-3000 manual and PCS's TCM-2650 guide give none; the factory switches have no part number on file): envelopes
  assumed, marked red.

## Unknowns
- 91 of the 109 dimensions are assumed (margins up to 30 mm). The factory switches want their GM part numbers read on
  the truck; the Nu-Relics depth, the OER switch, the PCS TCM-2650 and the GSS-3000 decoder want a tape.
- TG-SW-KEY-REV, TG-SW-MASTER and LOCK-SW-L / R are not picked (registry): they are drawn at the envelope of the part
  they would replace (the factory key switch, a Nu-Relics chrome switch).

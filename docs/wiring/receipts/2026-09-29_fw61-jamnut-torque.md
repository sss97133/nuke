---
id: 2026-09-29_fw61-jamnut-torque
change_type: research
amends: 2026-09-29_fw61-plate-stamp
scope: docs/wiring/calc-data/cad/fab/fw61_adapter_plate.py and its tracked outputs in fab/fw61_adapter_plate/ (restamped)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "the 61 pin connector should be placed at the original fuse box hole with a cnc'd adapater plate" (2026-09-29)
---

# The adapter plate drawing gets the receptacle's jam nut torque

## What changed
- The plate drawing now states the jam nut torque: 120–130 in-lb (13.6–14.7 N·m).
- The torque is added to the stamped parameters (JAM_NUT_TORQUE).
- The STEP, DXF and SVG outputs are regenerated in place, stamped with blob 51be27732d8d. `--check` passes.
- The plate's geometry is unchanged.

## Source
- MILNEC D38999 Series III catalog, p.B-15 (PDF p.35), "Accessory & Jam Nut Torque", aluminium and stainless steel,
  shell 25: jam nut torque min 120 (13.6), max 130 (14.7) in-lb (N·m).
- The same page says the insert arrangements are drawn with the master key at 12 o'clock, and "Inserts maintain a fixed
  position regardless of keying".
- Whether the receptacle body's flat sits on the master keyway's side is not printed. It stays a builder's check on the
  part.

## Unknowns
Unchanged from 2026-09-29_fw61-plate-stamp: the opening's size, the stock screw holes' positions, and the firewall
thickness.

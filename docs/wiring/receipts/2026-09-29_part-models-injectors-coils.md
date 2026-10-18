---
id: 2026-09-29_part-models-injectors-coils
change_type: research
amends: 2026-09-29_part-models-delphi-sensors
scope: docs/wiring/calc-data/cad/fab/ (fam_ignition.py new; fam_delphi.py corrected), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "i need the 3d pieces all of them if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 3: injectors and coils (16 ends), and the Metri-Pack 150 terminal correction

## What changed
- **`cad/fab/fam_ignition.py`** makes four pieces and 16 mated assemblies:
  - Siemens Deka FI114961 injector, with its EV1 socket and 14 mm O-rings.
  - The EV1 plug, EV1-JPT-2: TE Junior Power Timer 2-way housing with its locking spring, the kit's 90° boot and two
    68102 terminals.
  - GM 12611424 (ACDelco D510C) coil.
  - The LS2/LS7 4-way coil plug, COIL-CONN-LS2-7 (ProWire COIL-CONN-LS2/7): housing, blue seal, grey TPA, four
    terminals and yellow cable seals.
  - One assembly per end, INJ-1..8 and COIL-1..8, each with its own registry wires in pins.json. They were checked
    on INJ-1, COIL-1 and COIL-8.
- **Correction to batch 2 (`fam_delphi.py`)**, from the Delphi Metri-Pack 150 catalog:
  - The Metri-Pack 150 terminal is corrected from 12048074 to 12084200. p.12 "150 FEMALE TERMINALS SEALED" gives
    12084200 as 0.50-0.35 mm² (22 AWG, which every CKP / CMP / MAP wire is) and 12048074 as 1.0-0.80 mm².
  - The registry's 12110847 is a Metri-Pack 280 tangless terminal (catalog p.30). The registry swap is the registry
    pass's.
  - The cable seal is 15324974 (blue): the catalog's 12048087, 1.70-1.29 mm (p.66), which fits the 22 AWG M22759/16
    jacket (1.27-1.37 mm). The white 15324976, the catalog's 12089678, is 1.60-2.15 and does not fit.

## Sources
- **Injector** (maker): Continental's FI114961 data sheet, the image on the Siemens Deka product page. It gives
  "Body: 15.00 mm", "Fuel Inlet Cup Diameter 13.5 mm", "Intake Manifold Pocket Diameter 14.0 mm" and "60.44 mm"
  between the O-ring ends. The product page gives "Connector: Minitimer EV1", 14 mm upper and lower O-rings and
  "Identification Shell Color: Black". The solenoid body ends are scaled off the data sheet figure; the EV1 socket is
  photo-sized (±20 %).
- **EV1 plug** (maker): TE / Tyco Junior Power Timer catalog page (p.35, "For Junior Power Timer, 2 Positions", 828657):
  28.0 × 22.0, 23.4 over the locking spring, 17.0 body, 11.2 inside, and contacts 5.0 apart. The boot is photo-sized
  from ProWire's 8CYLK-90 kit photo (±20 %).
- **Coil**: docs/wiring/calc-data/cad/delstributor_geometry.yaml coil_shape (the DEL-Stributor lane's measurements off
  Delmo's photos, with the 73.0 mm coil bolt spread as the ruler):
  - body 64.7 tall, 16 / 21 either side of the axis, 36 across;
  - tower Ø17.4, standing 31.9 above the upper ear;
  - plug tip 92.8 below the upper ear;
  - axis 34 out from the ear line.
- **Coil plug**: photo-sized off ProWire's kit photo against the coil (±25 %).

## Unknowns
- **Coil plug:** the kit's housing part number is not on file. Its cavity order a-d across the plug is assumed
  (GM's a / b / c / d are named in pins.json). DEL-Stributor lists the latch's facing as unknown.
- **EV1 plug:** ProWire does not name the kit housing's maker, so it is drawn to TE's Junior Power Timer 2-way.
- **Injector:** EV1 cavity numbers 1 and 2 are drawn at -Y / +Y (not marked on the photos).

## Result
- The index now has 84 models, and 45 of 178 ends have a model, 42 of them complete.
- Every build-time check passes, and a secret scan of the 109 new files is clean.

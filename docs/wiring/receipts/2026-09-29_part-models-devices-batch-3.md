---
id: 2026-09-29_part-models-devices-batch-3
change_type: research
scope: docs/wiring/calc-data/cad/fab/ (dev_lamps.py factory lamps, 14 end scripts), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist-2 lane, session ebc425ad)
follows: 2026-09-29_part-models-devices-batch-2
---

# Part models, devices batch 3: the 16 factory lamp ends

## What changed
- `cad/fab/dev_lamps.py` `factory_lamp()`: a housing, bezel, lens (one or two), bulb socket(s) and the socket's leads,
  with the pins from the registry; right-hand lamps are mirrored from the left.
- Ends: PARK-TURN-LF / RF, MARKER-LF / RF / LR / RR, Tail_Light_Left / Right (each also carries Backup_Light_Left /
  Right: one housing, two ends), LICENSE-LAMP, DOME-LAMP, CLEARANCE-L / C / R, UNDERHOOD-LAMP.

## Sources
- No GM drawing of any of these lamps is on file. The envelopes of the park/turn, side marker, tail and dome lamps are
  the body model's own lamp meshes (the sizes layout-ui read off the twin lane's Blazer model; the body model holds
  about ±30 mm on the body). The rear side markers are drawn at the front marker's size (no rear mesh read). The license,
  underhood and roof marker lamps have no mesh or size on file and are assumed.
- Lens colours: the owner's photos of the truck (vehicle_images 640fc598 amber front marker, 34e05023 red tail lens with
  the clear back-up lens in its lower inboard corner); LMC's roof marker parts list (36-4481 amber lens).
- Sockets from the registry (8911486 1157 park/turn, 6294015 168 markers, 8911029 1157 tail, 8911027 1156 back-up).

## Unknowns
- Every lamp dimension is assumed or taken from the body model's mesh (98 dimensions, all marked assumed; margins 20 to
  30 mm). Tape the lamps on the truck, or find the GM part numbers, before any bracket or cut-out depends on them.
- The 1977 grille park/turn lens colour is not read (drawn amber).
- Factory socket in the harness vs a new pigtail socket + splice: owner/builder call (registry).

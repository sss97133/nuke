---
id: 2026-09-29_part-media-and-iat-map-picks
change_type: research
scope: docs/wiring/calc-data/catalog/part_media.yaml, PART_MEDIA_REPORT.md, nuke_frontend/public/wiring/k5-part-photos.json
author: claude-opus-5-5 (pieces lane, session ebc425ad)
owner_words: "need to start really seeing the pieces" / "needs to look another step more real" / "you should be able to figure out the ones that are best for the build. you have the parts order of the parts that are on the engine and have the info on what exact ls3 we have" (2026-09-29)
---

# Part media for every piece, and the IAT and MAP picked from the engine as bought

## What changed
- `calc-data/catalog/part_media.yaml` has one entry per `parts.yaml` code and per registry endpoint (337). Each entry has
  a photo, drawing and 3D-model link where one exists. Each photo is graded exact_pn, same_family_photo or unknown. The
  file holds URLs only; no image, PDF or CAD file is committed.
- `nuke_frontend/public/wiring/k5-part-photos.json` is regenerated from it with exact_pn photos only.
- `PART_MEDIA_REPORT.md` has the counts, the makers that give free 3D models, and the registry corrections.

## Picks (recorded in part_media.yaml; the registry is not edited)
- **MAP: Holley 538-24, 1 bar.** The engine is a Chevrolet Performance 19435106 LS3 long block, naturally aspirated.
  Holley's instructions for both of its LS intake families say "Holley 1bar MAP sensor P/N 538-24 is recommended"
  (199R10689 for the 300-129/130, 199R10690 for the 300-131/132/136/137). The sensor is the GM/Delphi rectangular body.
  Its plug is ProWire 1B-MAP-CONN-KIT (Delphi 12020403, Weather Pack pins 12089307, seals 15324985). MoTeC's Delco MAP
  drawing (X18) gives the pins: A 0 V, B signal, C +5 V.
- **IAT: GM 12160244 (ACDelco 213-243).** It fits the plug the registry already lists, ProWire GT150-AIR-TEMP-KIT
  (Delphi 15449027). PT Motorsport sells 15449027 as the "LS1 IAT Sensor Connector". The sensor mounts in a
  GM 24504388 grommet.

## Findings for the registry owner (PART_MEDIA_REPORT.md, corrections 1-8)
- The MAP plug, per-end parts and crimper change: the kit, Weather Pack pins, and a Weather Pack crimper that is not
  in tools.yaml.
- Chapter 08 names GM 25036751 for the IAT and GM 55573248 for the MAP. Neither fits the plug the registry lists.
- 12110847 is a Metri-Pack 280 terminal. The FUELP text describes AEM's stainless kit, not the brass 30-2131-100.
- The Holley intake's identity is unresolved: the receipt says 300-129, the state doc says 300-131, and the photos
  show a single-plane with injector bosses. Only the MAP hose fitting depends on it.

## Unknowns (stated in the entries, not guessed)
- Which intake is on the engine, which sets the MAP port (1/8 NPT on the 300-129).
- The oil-temperature sensor: it follows the oil cooler's port, and the build log does not name that part.
- 67 of the 337 pieces have no exact photo: 27 show a sibling part and 40 have none. Most are factory switches and
  lamps with no recorded part number; the report lists the rest.

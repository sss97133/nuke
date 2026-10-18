---
id: 2026-09-29_part-models-delphi-sensors
change_type: research
amends: 2026-09-29_part-models-deutsch-contacts
scope: docs/wiring/calc-data/cad/fab/fam_delphi.py (new), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "i need the 3d pieces all of them if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 2: Metri-Pack 150 / GT 150 plugs with their terminals, seals and locks, and the GM sensors they plug into

## What changed
- `cad/fab/fam_delphi.py`, the second family generator, makes 17 models:
  - **2 plugs:**
    - Delphi 12129946, Metri-Pack 150 3-way female, type 102: grey, purple connector seal 12052842, natural TPA
      12052845.
    - Delphi 15449028, GT 150 2-way female, type 102: black, blue seal 12040750, magenta PLR 15336006.
  - **2 terminals:** 12048074 (MP150, tin) and 12191818 (GT150, tin).
  - **2 cable seals:** 15324976 and 15366021 (white).
  - **5 sensors, keyed by part number:**
    - ACDelco 213-4573 (CKP) and 213-3826 (CMP);
    - Holley 538-24 (MAP);
    - ACDelco 213-4514 (ECT: CLT-ECU, and OILT as its family sibling);
    - ACDelco 213-243 (IAT).
  - **6 mated end assemblies:** CKP, CMP, MAP, CLT-ECU, OILT and IAT.
- Each plug carries a terminal and a cable seal in every cavity. The seal, TPA/PLR and lock arm are separate solids.

## Sources
- **Delphi drawing 12129958** (maker):
  - (26) length, (17.5), (7.2) nose, (6.5) rear body, (7.4) / (5.5) lock arm, (22) with the arm flexed, (18.6) /
    (15) widths, and 6 mm pitch;
  - the part-number table: 12129946 is type 102, body 12129945 GRA, seal 12052842 PPL;
  - MATING CONNECTOR INFORMATION: the sensor shroud is 22.9 ±0.15 wide with 1.5 walls, 18.9 deep and 10.8 inside;
    blades 10.05 long.
- **Delphi drawing 15449030** (maker): (30.65) long, 17.04 wide, 14.6 high, cavities 3.5 apart, and the type 102 row
  (connector 15449024, PLR 15336006, seal 12040750).
- **Delphi Metri-Pack and GT catalogs** (maker): terminal material and plating; the cable seal 15366021's 1.20-1.85
  range, white silicone.
- **Photos:**
  - customconnectorkits product photos, for the colours and the terminals (reel photos: ±20 %).
  - The maker's product photo of each sensor (part_media.yaml). The bodies are scaled off these, ±25 %:
    - CKP, CMP and MAP from the Metri-Pack shroud's 22.9 width;
    - the ECT from its M12 × 1.5 thread;
    - the IAT from its GT 150 shroud (design: the plug's 17.04 + walls).

## Findings
- **The registry names terminal 12110847 for the CKP, CMP and MAP wires, but the kit (ProWire LS-CRANK-CONN-KIT) ships
  12048074.** 12048074 is the Metri-Pack 150 sealed female terminal, and it is the one modelled. part_media already
  flags 12110847 as a Metri-Pack 280 tangless terminal.
- **The registry numbers the sensor cavities 1-3 and keeps their order OPEN** "until a GM end view". The housings
  mould letters A-C. pins.json maps 1→A, 2→B, 3→C and says in every row that this is assumed.
- **The CMP and IAT plugs are drawn as family siblings.** The kits (LS-CAM-CONN-KIT, GT150-AIR-TEMP-KIT) have no
  housing part number on file: the CMP is drawn as the MP150 3-way, the IAT as the GT150 2-way.

## Unknowns
- The sensor bodies are photo-scaled (±25 %); no GM dimensioned drawings are on file.
- The terminals are photo-scaled (±20 %).
- **OILP-ECU and KNOCK-1/2 are not in this batch.** Their plugs' housing part numbers and a sourced dimension on the
  sensors are still to find.

## Result
- The index now has 64 models, and 29 of 178 ends have a model, 26 of them complete.
- Every build-time check passes.

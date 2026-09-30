---
id: 2026-09-29_part-models-devices-batch-6-blower-res
change_type: research
scope: docs/wiring/calc-data/cad/fab/dev_engine.py, docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist-2 lane, session ebc425ad)
follows: 2026-09-29_part-models-devices-batch-5-upgrades
---

# Part models, devices batch 6: the blower resistor scaled from photo; three long shots tried

## What changed
- BLOWER-RES (GM 336403) is now **scaled from photo**.
  - Wells' 3A1044 photo on RockAuto shows the plate face-on, with its four blades end-on. Each blade's width lies in the
    plate's plane. Taking that width as the 0.250 in Packard 56 tab (the registry's gm_blade family, 125 px) gives
    0.0508 mm/px (±8%).
  - Sizes from the photo: hole pitch 56.8, plate 72.4 along the holes and 46.0 across (19.2 above the hole line, 26.8
    below), holes Ø4.6, rivets Ø4.1, and the four blades and rivets where the photo shows them.
  - The steel strips and coils behind the plate are not in that photo. They keep Four Seasons' 20083 proportions at an
    assumed length (red).
  - The frame now runs +X through the two holes, as Wells' photo shows it.
- Which printed blade (1-4) carries BAT, M1, M2 or BLO is not known. They are drawn in the registry's order, and the
  part says so.

## Long shots tried (none gave a usable size)
- WASHER-PUMP: RockAuto's 1977 K5 Blazer washer pump listing gave WAI 172212, ACDelco 86712 ("Pump Assembly"),
  ACDelco 86713 and Dorman 88119.
  - The spec table for ACDelco 86712 lists Length 189.31 mm, Width 4.2 in, Height 2.6 in and Weight 4.8 lb.
  - The table doesn't say whether those are the part or its box, and 4.8 lb is far heavier than a washer pump.
  - Not used; WASHER-PUMP stays red.
- APS: RockAuto's part search for 15751307 gave SMP APS130, Dorman 699207, Wells 5S11467, Holstein 2PPS0026 and
  Ultra-Power 699140. APS130's spec table (interchange 15751307 / 15974034 / 15984422; "Pedal Assembly Included: Yes";
  bolt-on) gives no size. APS stays red.
- PCS-TCM: Zero Gravity's own search page, then its TCM-2650 controller page. The description has no size. PCS-TCM
  stays red.
- Each RockAuto try was one listing or search page plus one spec table, 10 s apart. Zero Gravity was one search page
  plus one product page.
- Dakota Digital's GSS-3000 page was skipped: a blank answer to a direct fetch may be a block, and blocks aren't worked
  around.

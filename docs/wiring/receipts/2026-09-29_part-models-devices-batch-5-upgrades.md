---
id: 2026-09-29_part-models-devices-batch-5-upgrades
change_type: research
scope: docs/wiring/calc-data/cad/fab/ (dev_switches.py, dev_engine.py, k5dev.py, render_part.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist-2 lane, session ebc425ad)
follows: 2026-09-29_part-models-devices-merge-main
owner_words: "i need the 3d pieces all of them if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29)
---

# Part models, devices batch 5: the not-sourced ends, upgraded where a source exists

## What changed
- Three factory switches are now **scaled from photo**. Each photo is sized against a sourced dimension: the 0.250 in
  Packard 56 tab (`catalog/families.yaml` gm_blade), measured face-on (±8%).
  - FLOOR-DIMMER: SMP DS72 photo; GM 1997037 / 12338706.
  - BRAKE-SW: SMP SLS66 side-on photo, scaled from the kit's flat male tab. SMP's instruction sheet GF8592B gives the
    barrel's flat and the 1/16 in free plunger travel.
  - IGN-SWITCH: the face-on OER 1990096 listing photo. All nine blades are drawn, and the bracket slots are 61 mm apart.
- Six more parts are redrawn to their maker's photo at an assumed size (still **not sourced**, every size red), each
  with its photo and a side-by-side:
  - DOOR-JAMB-L / -R: SMP DS173.
  - BLOWER-SW: Four Seasons 37566.
  - BLOWER-RES: Four Seasons 20083.
  - TURN-SW: SMP TW45. Its 17.00 in harness is Wells 1S1074's number (vendor).
  - HORN: SMP HN16. The registry names no horn.
- `dev_switches.switch_part()` draws every physical blade (`blade_pos`). The registry pins take the blades in order.
- `k5dev.write_pins()` writes `mating_half` into pins.json: the harness half that plugs onto the part, from the end's
  pin table `mate`. Examples: FLOOR-DIMMER GM 8900855, BRAKE-SW 2984235, IGN-SWITCH 6294642 / 6294641, HORN 12004267.
- `render_part.py` takes `--photo-az`, so the photo-match render can take a maker's 3/4 view. The default (0) is
  unchanged.
- LOCK-SW-L / -R and TG-SW-MASTER gain their side-by-side with the Nu-Relics 201 photo.
- The distributor-page numbers move from `maker` to the `vendor` basis (teal): JBL Club 102SL (Crutchfield's spec table), the iBooster (EVcreate and openinverter) and the blower motor (MPParts' listing of Four Seasons 35587), 19 dimensions in all.

## Sources tried for the ends that stay not sourced
- Where nothing gave a size:
  - RockAuto's 1977 K5 Blazer 350 catalogue answers direct fetches. Its spec tables give terminal counts, materials and
    GM interchange numbers, but no sizes, with two exceptions: SMP HS435 "Overall Width 34.8 mm" (no axis) and Wells
    1S1074's 17.00 in harness.
  - LMC's catalogue, `ccComplete.pdf`, is in Nuke storage and its text is in `catalog_text_chunks`. Its pages show line
    drawings and photos, with no sizes:
    - p.196: dimmer, headlight, fan, courtesy and door lock switches;
    - p.197: ignition, wiper, turn and stop lamp switches;
    - p.201: wiper motor and washer pump;
    - p.212: underhood lamp;
    - p.218: license lamp parts;
    - p.223: roof marker.
  - These sites answer a direct fetch with a bot check (Cloudflare, ShieldSquare or Imperva): lmctruck.com, dormanproducts.com,
    4s.com, standardbrand.com, classicindustries.com and Summit's search.
  - PCS's site is a JavaScript app with no text to read.
  - 1977 LTSM electrical section, p.777-850: adjustment gauges only (p.796, the column neutral-start switch's .080 / .096 in
    gauge pins, 3/8 in deep), no switch size.
- HL-SW (USA1 16603): USA1 gives no size. SMP DS177 (7 blades) and GM Genuine D1588 (GM 1995179, 8 terminals, "Mounted on
  Dash, Left of Steering Column") give no size either.
- WIPER-SW: RockAuto has no wiper switch for the 1977 K5. LMC 36-0668 (1975-77, without cruise) is on p.197, no size.
- HORN-SW: LMC 34-0778 horn contact kit and 34-0422 horn button (1973-77) are on p.139, no size.
- DOOR-JAMB-L / -R: SMP DS173 has 1 bullet terminal, bronze. Wells 1S1016 is a screw mount with 1 pin terminal. Rostra 650024
  lists 1 terminal. None gives a size.
- BLOWER-SW: SMP HS435 gives 34.8 mm with no axis. Taking it as the case across its ears makes the photo's blades 4.0 mm
  wide, a 3/16 in tab, and not the 0.250 in Packard 56 that families.yaml names for the blower switch. Checking this at the bench is open.
- TURN-SW: SMP TW45 and Wells 1S1074 list 8 blades and 8 wires. Only the harness length is published.
- TG-SW-KEY, TG-SW-KEY-REV and TG-CUTOUT: RockAuto doesn't list them for the 1977 K5, and LMC's catalogue has no tailgate
  window switches.
- LOCK-SW-L / -R and TG-SW-MASTER: Nu-Relics publishes no size. LMC 36-0740 is the factory 1977-78 door lock switch (p.196),
  an option if the factory look is wanted.
- CLEARANCE-C / -L / -R, LICENSE-LAMP and UNDERHOOD-LAMP: LMC's catalogue pages (above) give no size, and RockAuto sells only
  the bulbs for these lamps.
- BLOWER-RES: GM 336403 (Four Seasons 20083, SMP RU67, Wells 3A1044 with "2 bolt holes, 4 blades"; LMC 32-2406). None gives a size.
- HORN: RockAuto lists SMP HN15 / HN16, ACDelco E1905E and Wells 1H1001, and LMC lists 36-2150 / 36-2152. None gives a size,
  and the registry doesn't say which horn is on the truck.
- GSS-3000: Dakota Digital's manual on file gives no decoder size.
- PCS-TCM: PCS's site has no readable text.
- APS: unchanged from batch 4.
- The regulators, rear_window_motor, WIPER-MOTOR, AMP-STEP-CTRL and STARTER-S are as in the batch-2 receipt.

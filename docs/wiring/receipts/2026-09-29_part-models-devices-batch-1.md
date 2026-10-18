---
id: 2026-09-29_part-models-devices-batch-1
change_type: research
scope: docs/wiring/calc-data/cad/fab/ (k5dev.py, dev_audio.py, dev_lamps.py, dev_video.py, 21 end scripts; one-line fix in k5cad.py auto_drawing), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json
author: claude-opus-5-5 (parts-artist-2 lane, session ebc425ad)
follows: 2026-09-29_part-models-cad-m130-sample (the standard: k5cad.py, render_part.py, index_v5.py, PR #431)
owner_words: "i need the 3d pieces all of them if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29)
---

# Part models, devices batch 1: 21 ends drawn true-size (boxes, panel parts, audio, LED lamps, camera kit)

## What changed
- `cad/fab/k5dev.py`: helpers the device families share, on top of `k5cad.py`.
  - `run()` is `k5cad.run` plus the registry record of each end (device text, family, wires with label, colour and gauge),
    the part's overall margin, a pins file for flying leads, blades and studs, and a check for the strings `blendermcp` and
    `api_key` in the GLB.
  - The device text is copied without prices, order numbers, order dates or record ids (`scrub()`): the repo is public.
  - Round parts mesh at a 0.2 rad angular step (k5cad's default is 0.45), so they stay round; every GLB is under 0.5 MB.
- Family modules: `dev_audio.py` (speaker builder; JL C2-650X, JBL Club 102SL), `dev_lamps.py` (Truck-Lite 27270C and
  80251C, ORACLE 4514-003, Lumitec Mini Rail2), `dev_video.py` (Rear View Safety camera and mirror monitor).
- One script per end, named by its id: ISOLATOR, ISO-SWITCH, OUTLET-12V, USB-PORT, WIDEBAND, AMP, RADIO, SPK-FL, SPK-FR,
  SPK-RL, SPK-RR, SUB, SUB-2, HEADLIGHT-L, HEADLIGHT-R, CARGO-LAMP, CHMSL, UNDERDASH-LAMPS, FOOTWELL-LAMPS, MIRROR-MON,
  Backup_Camera.
- `k5cad.py` `auto_drawing`: the top view's placement now uses its own lowest point, so a part whose mounting face is at
  z = 0 (every wall part) no longer draws its top view over its front view. Centred parts move by at most a few mm.
- `index_v5.py` regenerated `part_models.yaml` and `part-models/index.json`: 27 parts, the lint passes.
- No STEP, GLB, image or PDF is committed. They build to `~/k5-harness-pull/parts/samples/<id>/`.

## Sources, per part (every dimension's own source is in its script and in part_models.yaml)
- ISOLATOR, Blue Sea 7700: Blue Sea instruction sheet 990180170-006 p.2 dimension drawing; stud 3/8-16 x 0.875 in and the
  1.18 in ring clearance from Blue Sea's product page. Maker drawing.
- ISO-SWITCH, Blue Sea 2145: the same page's control-switch drawing (face, depth, cut-out) and the 2145-2146 pin-out.
- OUTLET-12V, Blue Sea 1011: Blue Sea's dimensioned drawing (Socket.jpg).
- USB-PORT, Blue Sea 1045: Blue Sea drawing 980021560-1 (drawn 1:1).
- WIDEBAND, MoTeC LTCD 61301: MoTeC's dimension drawing and the LTC user manual p.31-32; the two Bosch LSU 4.9 sensors
  from Bosch's offer drawing B 261 209 358-03 and Bosch Motorsport data sheet 69034379.
- AMP, JL Audio VX700/5i: JL's connection guide p.1 (top view and connection panel).
- RADIO, RetroSound Motor-2B: user manual p.21 specifications (motor and face envelopes); brackets and knobs off Retro
  Manufacturing's photo of the 1973-87 C/K kit.
- SPK-FL/FR/RL/RR, JL C2-650X: owner's manual p.2 Woofer Physical Dimensions (A-G).
- SUB, SUB-2, JBL Club 102SL: Crutchfield's spec table (frame width, cut-out, top-mount depth, mounting height).
- HEADLIGHT-L/R, Truck-Lite 27270C: Truck-Lite's brochure (7 in round, H4) and its own side photo for the depth.
- CARGO-LAMP, Truck-Lite 80251C: Truck-Lite's page, 462.03 x 146.05 x 27.43 mm, "8 Screw Bracket Mount".
- CHMSL, ORACLE 4514-003: ORACLE's page gives only "Length: 7 inches"; the section is sized off ORACLE's photo.
- UNDERDASH-LAMPS, FOOTWELL-LAMPS, Lumitec Mini Rail2: Lumitec's page, 5.90 x 1.11 x 0.60 in.
- MIRROR-MON, Backup_Camera, Rear View Safety RVS-7180355-IR: the kit page's Product Dimensions.

## Findings
- MoTeC's LTCD drawing shows the case 23.5 deep; the LTC manual p.31 prints 38 x 26 x 14. The model keeps the drawing's
  23.5 (the larger) and gives the part a 9.5 mm margin until it is measured.
- The Blue Sea 7700's terminal housing ends at the stud seat (116.7 below the top edge, = 138.94 - 22.23): the studs stand
  the full 22.23 clear of the housing, and the mounting ears reach 133.6.
- The JL VX700/5i's connection panel view is drawn at a different scale from its top view on the same page (6.3 vs 5.87
  px/mm at 300 dpi); each view is read at its own printed number.
- USB-PORT polarity: seen from the back, Blue Sea's sheet 1 puts - on the left and + on the right, so + is at -X in the
  part frame.

## Unknowns (in the parts, not guessed)
- LTCD case depth (23.5 drawing vs 14 manual); 27270C depth (Truck-Lite prints only 7 in; sized off its own photo, ±4).
- CHMSL section and connector; RetroSound face option and knob-shaft spacing (photo); 7700 control-lead length; JBL frame
  section and screw circle (photo); camera hole spacing (photo, 172 vs a plate's 7 in).
- Blade polarity on the 1011 socket; which H4 blade is LOW / HIGH / GND on the 27270C (registry opens).
- Basis mix over the 21 ends: 6 drawn from a maker drawing, 12 from datasheet dimensions, 3 scaled from photos. Of their
  367 dimensions, 140 are printed by the maker, 69 scaled off a maker drawing, 128 sized off a photo, 3 our choice and 27
  assumed (each marked red on its sheet). Margins run 1 to 5 mm, and 9.5 mm on the LTCD's depth.
